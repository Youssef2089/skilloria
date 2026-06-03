import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/candidatures/[id]/unlock — l'ORG accepte l'échange.
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
 * ORDRE D'OPÉRATIONS (cf. décision Lot 2c, point 1) :
 *  (1) INSERT conversation (idempotent sur UNIQUE candidature_id : 23505 = déjà
 *      créée → on continue normalement).
 *  (2) PUIS UPDATE candidature.status='unlocked' + unlocked_at=now().
 *  (3) PUIS notif expert (best-effort, n'invalide pas le succès).
 *
 *  Échec partiel sûr :
 *    - si (1) échoue (hors 23505) → on bail AVANT le flip status.
 *    - si (2) échoue après (1) → conv créée mais candidature reste en l'état.
 *      Un re-run trouvera la conv déjà créée (23505 OK) et flippera le status.
 *
 * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
 * ░ HOOK QUOTA FUTUR (commerce différé, cf. décision Lot 2c, point 6) ░░░░░░
 * ░ V1 : aucun quota imposé. L'unlock est gratuit et illimité.       ░░░░░░
 * ░ V2 : brancher ICI un check `await checkOrgUnlockQuota(supabaseAdmin, ░░
 * ░ orgId)` AVANT l'étape (1), retournant 402 payment_required si le ░░░░░░
 * ░ quota est dépassé. La structure packages (scope/max_seats) existe ░░░░░
 * ░ déjà ; il manque une table organization_subscriptions (V2).      ░░░░░░
 * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
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

  // ── Charger candidature + publication (ownership) ──────────────────────
  const { data: cand, error: candErr } = await auth.supabaseAdmin
    .from('candidatures')
    .select(
      'id, publication_id, profile_id, domain_id, status, unlocked_at, ' +
        'publications!inner(id, organization_id, title)',
    )
    .eq('id', candidatureId)
    .maybeSingle()
  if (candErr) {
    console.error('[candidatures/[id]/unlock:POST] lookup failed', candErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!cand) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }
  type Joined = {
    id: string
    publication_id: string
    profile_id: string
    domain_id: string
    status: string
    unlocked_at: string | null
    publications: { id: string; organization_id: string; title: string }
      | { id: string; organization_id: string; title: string }[]
  }
  const candRow = cand as unknown as Joined
  const pub = Array.isArray(candRow.publications) ? candRow.publications[0] : candRow.publications
  if (!pub || pub.organization_id !== orgId) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }

  // ── Garde de transition ────────────────────────────────────────────────
  const isAlreadyUnlocked = candRow.status === 'unlocked'
  if (!isAlreadyUnlocked && !ALLOWED_PREVIOUS_STATUSES.includes(candRow.status)) {
    return json(
      { error: 'Invalid status transition', code: 'invalid_transition', current: candRow.status },
      409,
    )
  }

  // ── (1) INSERT conversation — idempotent via UNIQUE candidature_id ─────
  //  Fenêtre de validité 15 j (Lot 3) : expires_at posé à la création.
  //  NULL = "non expirée" (compat conv legacy Lot 2c) ; après 15j, la route
  //  d'envoi de message renvoie 409 expired et l'UI passe en lecture seule.
  const fifteenDaysMs = 15 * 24 * 60 * 60 * 1000
  const expiresAtIso = new Date(Date.now() + fifteenDaysMs).toISOString()
  const { data: convInserted, error: convInsertErr } = await auth.supabaseAdmin
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
      // Conv déjà créée — récupère son id pour la réponse
      const { data: existingConv } = await auth.supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('candidature_id', candidatureId)
        .maybeSingle()
      conversationId = (existingConv as { id: string } | null)?.id ?? null
    } else {
      console.error('[candidatures/[id]/unlock:POST] conv insert failed', convInsertErr.message)
      return json({ error: 'Conversation creation failed', code: 'db_error' }, 500)
    }
  } else {
    conversationId = (convInserted as { id: string }).id
  }

  // ── (2) UPDATE candidature → unlocked (idempotent si déjà unlocked) ────
  let unlockedAtIso: string | null = candRow.unlocked_at
  let didFlip = false
  if (!isAlreadyUnlocked) {
    const nowIso = new Date().toISOString()
    const { error: updErr } = await auth.supabaseAdmin
      .from('candidatures')
      .update({ status: 'unlocked', unlocked_at: nowIso })
      .eq('id', candidatureId)
      .in('status', ALLOWED_PREVIOUS_STATUSES)   // anti-race : re-check transition
    if (updErr) {
      console.error('[candidatures/[id]/unlock:POST] candidature flip failed', updErr.message)
      return json({ error: 'Candidature update failed', code: 'db_error' }, 500)
    }
    unlockedAtIso = nowIso
    didFlip = true
  }

  // ── (3) Notif expert (best-effort) ─────────────────────────────────────
  //  On notifie UNIQUEMENT au flip (didFlip). Re-run sur unlocked ne renotifie pas.
  if (didFlip) {
    const { data: profileWithUser } = await auth.supabaseAdmin
      .from('profiles')
      .select('id, user_id, users!inner(id, locale)')
      .eq('id', candRow.profile_id)
      .maybeSingle()
    type ProfUser = { id: string; user_id: string; users: { id: string; locale: string | null } | { id: string; locale: string | null }[] }
    const pwu = profileWithUser as unknown as ProfUser | null
    if (pwu) {
      const u = Array.isArray(pwu.users) ? pwu.users[0] : pwu.users
      const loc = normalizeNotifLocale(u?.locale ?? null)
      const linkUrl = `/dashboard/freelance/missions/${candRow.publication_id}`
      const { error: notifErr } = await auth.supabaseAdmin.from('notifications').insert({
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
        console.error('[candidatures/[id]/unlock:POST] notif insert failed', notifErr.message)
      }
    }
  }

  // ── Audit best-effort ──────────────────────────────────────────────────
  if (didFlip) {
    await logAudit({
      supabaseAdmin: auth.supabaseAdmin,
      user_id: auth.user.id,
      domain_id: candRow.domain_id,
      action: 'candidature_unlocked',
      entity_type: 'candidature',
      entity_id: candidatureId,
      detail: {
        publication_id: candRow.publication_id,
        profile_id: candRow.profile_id,
        conversation_id: conversationId,
      },
    })
  }

  return json(
    {
      ok: true,
      already_unlocked: isAlreadyUnlocked,
      candidature: {
        id: candidatureId,
        status: 'unlocked',
        unlocked_at: unlockedAtIso,
      },
      conversation_id: conversationId,
    },
    200,
  )
}
