import { contexteDepuisAuth, parametresJournal } from '@/lib/journal/contexte'
import { NextRequest } from 'next/server'
import { AuthError, requireAuth, requireOrgRole, type AuthContext } from '@/lib/auth-guard'
import { activeEcosystemId } from '@/lib/ecosystem-scope'
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

/** D'où l'on peut clôturer. La RPC reçoit cette liste : elle ne porte aucun littéral de statut. */
const CLOSABLE_FROM = ['published'] as const

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
  // LA PIÈCE, À L'ENTRÉE DU GESTE (§D.26).
  const journal = contexteDepuisAuth(auth)

  // ── Id de route ─────────────────────────────────────────────────────────
  const { id } = await ctx.params
  if (!id || !UUID_REGEX.test(id)) {
    return json({ error: 'Invalid id', code: 'not_found' }, 404)
  }

  // ── Pré-check ownership + statut clôturable ─────────────────────────────
  const { data: pub, error: fetchErr } = await auth.supabaseAdmin
    .from('publications')
    .select('id, organization_id, status')
    // CLOISONNEMENT — ÉCRITURE : clôturer une annonce d'un autre écosystème
    // depuis celui-ci doit être impossible, pas seulement invisible.
    .eq('id', id)
    .eq('domain_id', activeEcosystemId(auth))
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
  if (!(CLOSABLE_FROM as readonly string[]).includes(currentStatus)) {
    return json(
      { error: 'Cannot close', code: 'wrong_status', current_status: currentStatus },
      409,
    )
  }

  // ── LA CLÔTURE ET SA LIGNE DE GRAND LIVRE, EN UN SEUL APPEL (§D.26) ──────
  //  `cloturer_annonce` rejoue la transition (`published` → `archived`), le
  //  cloisonnement et la propriété DANS l'UPDATE, puis journalise
  //  `annonce_depubliee` dans la même transaction. Zéro ligne touchée rend
  //  false : la route répond 409 au lieu d'un 200 muet (§E.27).
  const { data: cloturee, error: updateErr } = await auth.supabaseAdmin.rpc('cloturer_annonce', {
    ...parametresJournal(journal),
    p_publication_id: id,
    p_domain_id: activeEcosystemId(auth),
    p_organization_id: orgId,
    p_statuts_admis: [...CLOSABLE_FROM],
  })

  if (updateErr) {
    console.error('[publications:close] update failed', updateErr.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }
  if (cloturee !== true) {
    return json({ error: 'Cannot close', code: 'wrong_status' }, 409)
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

  return json({ id, status: 'archived' }, 200)
}
