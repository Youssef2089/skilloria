import { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'
import { dashboardUrlForUserType } from '@/lib/auth-routing'
import { markCandidatureViewedServerSide } from '@/lib/candidature-views'
import { getOrgEntitlements, consumeQuota, monthlyPeriodStart } from '@/lib/entitlements'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/candidatures/[id]/unlock — l'ORG accepte l'échange (unlock MANUEL).
 *
 * Garde (service_role) :
 *  - requireAuth + auth.organization?.id présent
 *  - ownership : candidature → publication.organization_id == auth.org.id
 *
 * Garde de transition (cf. décision Lot 2c, point 1) :
 *  - unlock autorisé SEULEMENT depuis 'received' | 'in_review' | 'shortlisted'
 *  - idempotent sur 'unlocked' (re-run réconcilie la conversation, renvoie 200)
 *  - refusé depuis 'rejected' | 'withdrawn' | 'archived'  → 409 invalid_transition
 *
 * GATE COMMERCE (Lot 2) : l'unlock manuel consomme manual_unlocks_per_month.
 *  - vérifiée UNIQUEMENT quand un vrai flip va avoir lieu (pas sur un re-run
 *    idempotent d'une candidature déjà 'unlocked' → on ne recharge pas le quota).
 *  - refus → 402 'unlock_limit_reached'.
 *  - limite null (business/elite) → pas de consommation, illimité.
 *  - L'AUTO-dévoilement top-1 (route de création de candidature) NE passe PAS
 *    par ce quota : c'est le dévoilement inclus, il appelle performUnlock direct.
 *
 * Le cœur mécanique (conversation + flip + notif + audit) est factorisé dans
 * performUnlock() ci-dessous, réutilisé par l'auto-dévoilement (Lot 2, étape 4).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

const ALLOWED_PREVIOUS_STATUSES: readonly string[] = ['received', 'in_review', 'shortlisted']

// Convention notifications (cf. Lot 2a/2b) :
//   channel : 'inapp' (CHECK : email | inapp | both)
//   status  : 'pending' (CHECK : pending | sent | failed | read)
const NOTIF_TYPE = 'candidature_unlocked'
const NOTIF_CHANNEL = 'inapp'
const NOTIF_STATUS = 'pending'

// Titres/bodies par locale expert.
const NOTIF_LOCALES = ['fr', 'en', 'es', 'de'] as const
type NotifLocale = (typeof NOTIF_LOCALES)[number]
function normalizeNotifLocale(raw: string | null | undefined): NotifLocale {
  if (raw && (NOTIF_LOCALES as readonly string[]).includes(raw)) return raw as NotifLocale
  return 'fr'
}
const NOTIF_TITLE: Record<NotifLocale, string> = {
  fr: 'Votre candidature a été acceptée',
  en: 'Your application has been accepted',
  es: 'Tu candidatura ha sido aceptada',
  de: 'Ihre Bewerbung wurde angenommen',
}
const NOTIF_BODY: Record<NotifLocale, (args: { title: string }) => string> = {
  fr: ({ title }) => `L'entreprise souhaite échanger avec vous concernant l'opportunité « ${title} ».`,
  en: ({ title }) => `The company would like to discuss the opportunity "${title}" with you.`,
  es: ({ title }) => `La empresa quiere conversar contigo sobre la oportunidad «${title}».`,
  de: ({ title }) => `Das Unternehmen möchte mit Ihnen über die Möglichkeit „${title}" sprechen.`,
}

// ─────────────────────────────────────────────────────────────────────────────
// performUnlock — cœur mécanique du dévoilement, PARTAGÉ entre l'unlock manuel
// (cette route) et l'auto-dévoilement top-1 (route de création de candidature).
//
// NE gère NI l'auth NI l'ownership NI le quota : c'est la responsabilité de
// l'appelant. Idempotent et sûr en cas d'échec partiel (cf. ordre ci-dessous).
//
// ORDRE : (1) INSERT conversation (idempotent 23505) → (2) UPDATE status
// 'unlocked' (garde anti-race .in(status)) → (3) notif expert (best-effort) →
// (4) audit (detail.auto reflète l'origine). Étapes 3-4 seulement au flip réel.
// ─────────────────────────────────────────────────────────────────────────────

type UnlockJoined = {
  id: string
  publication_id: string
  profile_id: string
  domain_id: string
  status: string
  unlocked_at: string | null
  publications:
    | { id: string; organization_id: string; title: string }
    | { id: string; organization_id: string; title: string }[]
}

export type PerformUnlockResult =
  | {
      ok: true
      alreadyUnlocked: boolean
      didFlip: boolean
      conversationId: string | null
      unlockedAt: string | null
    }
  | { ok: false; code: 'not_found' | 'invalid_transition' | 'db_error'; current?: string }

export async function performUnlock(
  admin: SupabaseClient,
  candidatureId: string,
  opts: { auto: boolean; actorUserId: string },
): Promise<PerformUnlockResult> {
  // Charge candidature + publication (self-contained pour la réutilisation).
  const { data: cand, error: candErr } = await admin
    .from('candidatures')
    .select(
      'id, publication_id, profile_id, domain_id, status, unlocked_at, ' +
        'publications!inner(id, organization_id, title)',
    )
    .eq('id', candidatureId)
    .maybeSingle()
  if (candErr) {
    console.error('[performUnlock] candidature lookup failed', candErr.message)
    return { ok: false, code: 'db_error' }
  }
  if (!cand) return { ok: false, code: 'not_found' }
  const candRow = cand as unknown as UnlockJoined
  const pub = Array.isArray(candRow.publications) ? candRow.publications[0] : candRow.publications
  if (!pub) return { ok: false, code: 'not_found' }

  // Garde de transition.
  const isAlreadyUnlocked = candRow.status === 'unlocked'
  if (!isAlreadyUnlocked && !ALLOWED_PREVIOUS_STATUSES.includes(candRow.status)) {
    return { ok: false, code: 'invalid_transition', current: candRow.status }
  }

  // (1) INSERT conversation — idempotent via UNIQUE candidature_id.
  //  Fenêtre de validité 15 j : expires_at posé à la création.
  const fifteenDaysMs = 15 * 24 * 60 * 60 * 1000
  const expiresAtIso = new Date(Date.now() + fifteenDaysMs).toISOString()
  const { data: convInserted, error: convInsertErr } = await admin
    .from('conversations')
    .insert({
      candidature_id: candidatureId,
      domain_id: candRow.domain_id,
      status: 'open',
      expires_at: expiresAtIso,
    })
    .select('id')
    .single()

  let conversationId: string | null = null
  if (convInsertErr) {
    if ((convInsertErr as { code?: string }).code === '23505') {
      const { data: existingConv } = await admin
        .from('conversations')
        .select('id')
        .eq('candidature_id', candidatureId)
        .maybeSingle()
      conversationId = (existingConv as { id: string } | null)?.id ?? null
    } else {
      console.error('[performUnlock] conv insert failed', convInsertErr.message)
      return { ok: false, code: 'db_error' }
    }
  } else {
    conversationId = (convInserted as { id: string }).id
  }

  // (2) UPDATE candidature → unlocked (idempotent si déjà unlocked).
  let unlockedAtIso: string | null = candRow.unlocked_at
  let didFlip = false
  if (!isAlreadyUnlocked) {
    const nowIso = new Date().toISOString()
    const { error: updErr } = await admin
      .from('candidatures')
      .update({ status: 'unlocked', unlocked_at: nowIso })
      .eq('id', candidatureId)
      .in('status', ALLOWED_PREVIOUS_STATUSES) // anti-race : re-check transition
    if (updErr) {
      console.error('[performUnlock] candidature flip failed', updErr.message)
      return { ok: false, code: 'db_error' }
    }
    unlockedAtIso = nowIso
    didFlip = true
  }

  // (3) Notif expert (best-effort) — uniquement au flip réel.
  if (didFlip) {
    const { data: profileWithUser } = await admin
      .from('profiles')
      .select('id, user_id, users!profiles_user_id_fkey!inner(id, locale, user_type)')
      .eq('id', candRow.profile_id)
      .maybeSingle()
    type ProfUser = {
      id: string
      user_id: string
      users:
        | { id: string; locale: string | null; user_type: string | null }
        | { id: string; locale: string | null; user_type: string | null }[]
    }
    const pwu = profileWithUser as unknown as ProfUser | null
    if (pwu) {
      const u = Array.isArray(pwu.users) ? pwu.users[0] : pwu.users
      const loc = normalizeNotifLocale(u?.locale ?? null)
      const linkUrl = `${dashboardUrlForUserType(u?.user_type ?? null)}/missions/${candRow.publication_id}`
      const { error: notifErr } = await admin.from('notifications').insert({
        user_id: pwu.user_id,
        domain_id: candRow.domain_id,
        type: NOTIF_TYPE,
        channel: NOTIF_CHANNEL,
        title: NOTIF_TITLE[loc],
        body: NOTIF_BODY[loc]({ title: pub.title }),
        link_url: linkUrl,
        status: NOTIF_STATUS,
        entity_id: candidatureId,
      })
      if (notifErr) {
        console.error('[performUnlock] notif insert failed', notifErr.message)
      }
    }
  }

  // (4) Audit best-effort — detail.auto distingue l'auto-dévoilement de l'unlock manuel.
  if (didFlip) {
    await logAudit({
      supabaseAdmin: admin,
      user_id: opts.actorUserId,
      domain_id: candRow.domain_id,
      action: 'candidature_unlocked',
      entity_type: 'candidature',
      entity_id: candidatureId,
      detail: {
        publication_id: candRow.publication_id,
        profile_id: candRow.profile_id,
        conversation_id: conversationId,
        auto: opts.auto,
      },
    })
  }

  return { ok: true, alreadyUnlocked: isAlreadyUnlocked, didFlip, conversationId, unlockedAt: unlockedAtIso }
}

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: RouteContext): Promise<Response> {
  // ── Auth + org ──────────────────────────────────────────────────────────
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const orgId = auth.organization?.id
  if (!orgId) {
    return json({ error: 'No organization', code: 'org_required' }, 403)
  }

  const { id: candidatureId } = await ctx.params
  if (!candidatureId || !UUID_REGEX.test(candidatureId)) {
    return json({ error: 'Invalid id', code: 'invalid_id' }, 400)
  }

  // ── Ownership + statut courant (pour la garde de transition + décision quota) ─
  const { data: cand, error: candErr } = await auth.supabaseAdmin
    .from('candidatures')
    .select('id, domain_id, status, publications!inner(organization_id)')
    .eq('id', candidatureId)
    .maybeSingle()
  if (candErr) {
    console.error('[candidatures/[id]/unlock:POST] lookup failed', candErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!cand) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }
  type OwnershipRow = {
    domain_id: string
    status: string
    publications: { organization_id: string } | { organization_id: string }[]
  }
  const ownRow = cand as unknown as OwnershipRow
  const ownPub = Array.isArray(ownRow.publications) ? ownRow.publications[0] : ownRow.publications
  if (!ownPub || ownPub.organization_id !== orgId) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }

  // ── Garde de transition (early 409 + on ne consomme le quota qu'au flip réel) ─
  const isAlreadyUnlocked = ownRow.status === 'unlocked'
  if (!isAlreadyUnlocked && !ALLOWED_PREVIOUS_STATUSES.includes(ownRow.status)) {
    return json(
      { error: 'Invalid status transition', code: 'invalid_transition', current: ownRow.status },
      409,
    )
  }

  // ── GATE COMMERCE : quota d'unlocks manuels (seulement si un flip va avoir lieu) ─
  if (!isAlreadyUnlocked) {
    const ents = await getOrgEntitlements(auth.supabaseAdmin, orgId, ownRow.domain_id)
    if (ents.limits.manualUnlocksPerMonth !== null) {
      const allowed = await consumeQuota(
        auth.supabaseAdmin,
        orgId,
        'manual_unlocks',
        ents.limits.manualUnlocksPerMonth,
        monthlyPeriodStart(),
      )
      if (!allowed) {
        return json({ error: 'Manual unlock quota reached', code: 'unlock_limit_reached' }, 402)
      }
    }
  }

  // ── Exécution du dévoilement (chemin partagé) ──────────────────────────────
  const result = await performUnlock(auth.supabaseAdmin, candidatureId, {
    auto: false,
    actorUserId: auth.user.id,
  })
  if (!result.ok) {
    if (result.code === 'invalid_transition') {
      return json(
        { error: 'Invalid status transition', code: 'invalid_transition', current: result.current },
        409,
      )
    }
    if (result.code === 'not_found') {
      return json({ error: 'Not found', code: 'not_found' }, 404)
    }
    return json({ error: 'Unlock failed', code: 'db_error' }, 500)
  }

  // Lot badges par item : agir sur une candidature = l'avoir vue (best-effort).
  await markCandidatureViewedServerSide(auth.supabaseAdmin, auth.user.id, candidatureId)

  return json(
    {
      ok: true,
      already_unlocked: result.alreadyUnlocked,
      candidature: {
        id: candidatureId,
        status: 'unlocked',
        unlocked_at: result.unlockedAt,
      },
      conversation_id: result.conversationId,
    },
    200,
  )
}
