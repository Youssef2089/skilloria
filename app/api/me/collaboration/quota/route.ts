import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { getOrgEntitlements } from '@/lib/entitlements'
import { activePublishedOrClause } from '@/lib/publications/expiry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/me/collaboration/quota — SNAPSHOT des droits de collaboration de
 * l'organisation active du user (org personnelle de l'expert en pratique).
 *
 * Alimente les trois écrans de sous-traitance :
 *   - « Mes besoins »  → bouton Publier activé/désactivé + message de plafond ;
 *   - formulaire       → phrases « N publications par mois, N profils dévoilés » ;
 *   - détail d'un besoin → mur de dévoilement OU bouton « Débloquer ».
 *
 * ┌─ AUCUNE VALEUR COMMERCIALE N'EST CODÉE ICI ─────────────────────────────┐
 * │ Les quatre limites viennent du catalogue (getOrgEntitlements). Avant ce │
 * │ lot, l'écran de détail décidait d'afficher un mur de dévoilement via un │
 * │ littéral `conversionMode="wall"` : porter manual_unlocks_per_month de 0 │
 * │ à 3 dans le back-office ne changeait RIEN pour l'expert. La règle était │
 * │ écrite deux fois et c'est le code qui gagnait. Désormais l'UI ne fait   │
 * │ que lire `canUnlockManually`.                                          │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ CE N'EST PAS UNE GARDE. `canPublish` / `canUnlockManually` sont de
 *   l'AFFICHAGE. Les refus font autorité côté serveur, aux gates :
 *   publish/route.ts (402 quota_publications_reached /
 *   active_publications_limit_reached) et candidatures/[id]/unlock/route.ts
 *   (402 unlock_limit_reached). Un appel direct ne contourne rien.
 *
 * `activePublishedCount` est compté À LA LECTURE (règle 30 j, aucun batch,
 * aucun cron) : une annonce expirée ou clôturée libère son slot d'elle-même.
 *
 * COMPATIBILITÉ : les trois champs de la V1 (`activePublicationsMax`,
 * `activePublishedCount`, `canPublish`) sont conservés à l'identique.
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
  const limits = {
    publicationsPerMonth: ents.limits.publicationsPerMonth,
    activePublicationsMax: ents.limits.activePublicationsMax,
    revealedCandidatesPerPublication: ents.limits.revealedCandidatesPerPublication,
    manualUnlocksPerMonth: ents.limits.manualUnlocksPerMonth,
  }

  // Le dévoilement manuel est proposé dès que l'offre en accorde au moins un.
  // null = illimité → proposé. 0 → mur de conversion.
  const canUnlockManually = limits.manualUnlocksPerMonth !== 0

  // Miroir du plafond d'actives (publish) : mêmes « actives » = published NON
  // expirées (règle 30j read-time, lib/publications/expiry). Une expirée libère un slot.
  const { count, error: countErr } = await auth.supabaseAdmin
    .from('publications')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('status', 'published')
    .or(activePublishedOrClause())
  if (countErr) {
    console.error('[collaboration/quota:GET] count failed', countErr.message)
    // Fail-open : on n'empêche pas l'accès à l'écran sur une erreur de comptage.
    return json(
      {
        limits,
        activePublicationsMax: limits.activePublicationsMax,
        activePublishedCount: 0,
        canPublish: true,
        canUnlockManually,
      },
      200,
    )
  }

  const activePublishedCount = count ?? 0
  const canPublish =
    limits.activePublicationsMax === null || activePublishedCount < limits.activePublicationsMax

  return json(
    {
      limits,
      // Champs V1 conservés (appelants existants).
      activePublicationsMax: limits.activePublicationsMax,
      activePublishedCount,
      canPublish,
      canUnlockManually,
    },
    200,
  )
}
