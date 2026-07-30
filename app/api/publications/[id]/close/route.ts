import { NextRequest } from 'next/server'
import { AuthError, requireAuth, requireOrgRole, type AuthContext } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/publications/[id]/close — CLÔTURE d'une publication publiée
 * (transition `published` → `archived`).
 *
 * Motivation (Collaboration / Sous-traitance) : le package collaboration impose
 * `active_publications_max = 1`. Le plafond compte les publications en statut
 * 'published' (cf. publish/route.ts). Sans transition hors de 'published',
 * l'expert publiant reste bloqué à vie après son premier besoin. Cette route
 * libère le quota. Elle sert AUSSI aux vraies organisations (même mécanique).
 *
 * Garde : appartenance org active + OWNERSHIP stricte
 * (publication.organization_id == auth.organization.id).
 *
 * Ne touche QUE `status` (verification_*, published_at, etc. INCHANGÉS).
 * Transition autorisée UNIQUEMENT depuis 'published' → 409 sinon.
 *
 * INVARIANTS PRÉSERVÉS (arbitrage A1) :
 *   - Les CANDIDATURES REÇUES restent consultables (aucune ligne candidatures
 *     modifiée ; la vue candidatures ne filtre pas sur le statut de la publi).
 *   - Les CONVERSATIONS EN COURS ne sont PAS coupées : la messagerie a sa
 *     propre fenêtre de 15 jours (conversations.expires_at), indépendante du
 *     statut de la publication. On ne touche AUCUNE ligne conversations ici,
 *     et aucun trigger DB ne cascade sur ce changement de statut.
 *   - 'archived' est déjà hors-funnel (cf. /api/publications GET) et hors du
 *     compte 'published' → le quota est libéré immédiatement.
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
  // ── Auth + appartenance org active ──────────────────────────────────────
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
  // D2 : clôturer = gestion des annonces → editor+ (viewer refusé).
  try { requireOrgRole(auth, 'editor') } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  // ── Id de route ─────────────────────────────────────────────────────────
  const { id } = await ctx.params
  if (!id || !UUID_REGEX.test(id)) {
    return json({ error: 'Invalid id', code: 'not_found' }, 404)
  }

  // ── Pré-check ownership + statut clôturable ─────────────────────────────
  const { data: pub, error: fetchErr } = await auth.supabaseAdmin
    .from('publications')
    .select('id, organization_id, status')
    .eq('id', id)
    .maybeSingle()

  if (fetchErr) {
    console.error('[publications:close] fetch failed', fetchErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!pub) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }
  if ((pub.organization_id as string) !== orgId) {
    // 403 forbidden (le caller est membre d'une org, mais pas propriétaire).
    return json({ error: 'Forbidden', code: 'forbidden' }, 403)
  }
  const currentStatus = pub.status as string
  if (currentStatus !== 'published') {
    return json(
      { error: 'Cannot close', code: 'wrong_status', current_status: currentStatus },
      409,
    )
  }

  // ── UPDATE : status uniquement ──────────────────────────────────────────
  const { data: updated, error: updateErr } = await auth.supabaseAdmin
    .from('publications')
    .update({ status: 'archived' })
    .eq('id', id)
    .select('id, status')
    .single()

  if (updateErr || !updated) {
    console.error('[publications:close] update failed', updateErr?.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'publication_closed',
    entity_type: 'publication',
    entity_id: id,
    detail: { from: 'published', to: 'archived' },
  })

  return json({ id: updated.id, status: updated.status }, 200)
}
