import { NextRequest } from 'next/server'
import { AuthError, requireAuth, requireOrgRole, type AuthContext } from '@/lib/auth-guard'
import { markCandidatureViewedServerSide } from '@/lib/candidature-views'
import { getOrgEntitlements, consumeQuota, monthlyPeriodStart } from '@/lib/entitlements'
import { performUnlock, ALLOWED_PREVIOUS_STATUSES } from '@/lib/unlock'
import { deriveLifecycleByCandidature } from '@/lib/candidatures/lifecycle-batch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/candidatures/[id]/unlock — l'ORG accepte l'échange (unlock MANUEL).
 *
 * Garde (service_role) :
 *  - requireAuth + auth.organization?.id présent
 *  - ownership : candidature → publication.organization_id == auth.org.id
 *
 * Garde d'ÉTAT DE VIE (lot re-masquage) :
 *  - candidature dans le bucket 'archived' → 409 'candidature_archived',
 *    AVANT toute consommation de quota. Le dévoilement est temporaire et ne se
 *    reprend pas : annonce expirée, clôturée, retirée, ou fenêtre d'échange
 *    close ⇒ plus aucun déverrouillage possible sur cette candidature.
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
 * Le cœur mécanique (conversation + flip + notif + audit) vit dans
 * lib/unlock.ts (performUnlock), partagé avec l'auto-dévoilement (Lot 2/3).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

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
  // D2 : dévoiler un candidat = gestion des candidatures → editor+ (viewer refusé).
  try { requireOrgRole(auth, 'editor') } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { id: candidatureId } = await ctx.params
  if (!candidatureId || !UUID_REGEX.test(candidatureId)) {
    return json({ error: 'Invalid id', code: 'invalid_id' }, 400)
  }

  // ── Ownership + statut courant (pour la garde de transition + décision quota) ─
  //  On charge aussi la fenêtre de l'annonce et `unlocked_at` : ils alimentent
  //  la garde d'état de vie ci-dessous.
  const { data: cand, error: candErr } = await auth.supabaseAdmin
    .from('candidatures')
    .select(
      'id, domain_id, status, unlocked_at, publication_id, ' +
        'publications!inner(organization_id, status, published_at, expires_at)',
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
  type OwnershipPub = {
    organization_id: string
    status: string | null
    published_at: string | null
    expires_at: string | null
  }
  type OwnershipRow = {
    domain_id: string
    status: string
    unlocked_at: string | null
    publication_id: string
    publications: OwnershipPub | OwnershipPub[]
  }
  const ownRow = cand as unknown as OwnershipRow
  const ownPub = Array.isArray(ownRow.publications) ? ownRow.publications[0] : ownRow.publications
  if (!ownPub || ownPub.organization_id !== orgId) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }

  // ── GARDE D'ÉTAT DE VIE — LE DÉVOILEMENT NE SE REPREND PAS ──────────────
  //  L'UI retire déjà le bouton sur une candidature archivée, mais l'UI n'est
  //  pas une sécurité (point 20). Sans cette garde, une requête forgée — ou
  //  simplement un clic pendant que les 30 jours s'écoulent, la page étant
  //  restée ouverte — rouvrait un profil que le lot re-masquage vient de
  //  refermer : unlock ⇒ nouvelle fenêtre de 15 j ⇒ bucket 'active' ⇒ identité
  //  à nouveau servie. Le contournement aurait annulé tout le lot.
  //
  //  Décision produit : le re-dévoilement n'existe pas. Une organisation qui
  //  laisse expirer assume. Refus AVANT toute consommation de quota — on ne
  //  fait pas payer une action qu'on refuse.
  //
  //  Dérivation par le helper partagé, jamais réécrite ici (le bucket doit
  //  être EXACTEMENT celui qui range la candidature dans « Archivées »).
  const lifecycleByCand = await deriveLifecycleByCandidature(
    auth.supabaseAdmin,
    [{
      id: candidatureId,
      status: ownRow.status,
      unlocked_at: ownRow.unlocked_at,
      publication_id: ownRow.publication_id,
    }],
    new Map([[ownRow.publication_id, {
      status: ownPub.status,
      published_at: ownPub.published_at,
      expires_at: ownPub.expires_at,
    }]]),
  )
  const lifecycle = lifecycleByCand.get(candidatureId)
  if (lifecycle?.bucket === 'archived') {
    return json(
      { error: 'Candidature archived', code: 'candidature_archived', reason: lifecycle.reason },
      409,
    )
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
