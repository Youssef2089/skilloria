import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { getOrgEntitlements } from '@/lib/entitlements'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/me/collaboration/quota — état du plafond de publications ACTIVES
 * pour l'organisation active du user (org personnelle de l'expert en pratique).
 *
 * Alimente l'écran « Mes besoins » (bouton « Publier un besoin » activé /
 * désactivé + message « clôturez le besoin en cours »). Aucune valeur de quota
 * n'est codée ici : `activePublicationsMax` est lu depuis les entitlements
 * (package collaboration = 1). Le compteur = publications en statut 'published'
 * de l'org (même définition que le gate publish/route.ts).
 *
 * `canPublish` reflète UNIQUEMENT le plafond d'actives (le blocage structurel
 * décrit par l'arbitrage A1). Le quota MENSUEL (publications_per_month) reste,
 * lui, appliqué au moment du publish (mur « Bientôt disponible ») — on ne le
 * ré-évalue pas ici pour ne pas dupliquer la logique de consommation.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function GET(request: NextRequest): Promise<Response> {
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

  const ents = await getOrgEntitlements(auth.supabaseAdmin, orgId, auth.domain.id)
  const activePublicationsMax = ents.limits.activePublicationsMax

  const { count, error: countErr } = await auth.supabaseAdmin
    .from('publications')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('status', 'published')
  if (countErr) {
    console.error('[collaboration/quota:GET] count failed', countErr.message)
    // Fail-open : on n'empêche pas l'accès à l'écran sur une erreur de comptage.
    return json({ activePublicationsMax, activePublishedCount: 0, canPublish: true }, 200)
  }

  const activePublishedCount = count ?? 0
  const canPublish =
    activePublicationsMax === null || activePublishedCount < activePublicationsMax

  return json({ activePublicationsMax, activePublishedCount, canPublish }, 200)
}
