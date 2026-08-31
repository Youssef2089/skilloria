import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { loadTranslations } from '@/lib/translations'
import { routing, type Locale } from '@/i18n/routing'
import { buildOrgCandidatureDTOs, countByBucket } from '@/lib/candidature-org-dto'
import { parseBucketFilter } from '@/lib/candidatures/lifecycle'
import {
  assertFacetPartition,
  countFacets,
  emptyFacetCounts,
  facetForLifecycle,
  parseFacetFilter,
} from '@/lib/candidatures/facets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/me/candidatures-org — vue GLOBALE des candidatures reçues par
 * l'organisation courante, toutes annonces confondues (SC6 Lot UX Finitions 2).
 *
 * Garde (service_role) :
 *  - requireAuth + auth.organization?.id présent (membre actif d'une org).
 *  - Le SELECT publications est filtré sur organization_id == auth.org.id —
 *    ownership stricte côté code, en plus de la RLS.
 *
 * Masquage / unlock : RIGOUREUSEMENT identiques à
 * /api/publications/[id]/candidatures (les deux routes appellent
 * buildOrgCandidatureDTOs). Un set de invariants vit dans le helper, pas
 * dans la route — pas de divergence possible.
 *
 * ?filter=active|archived|all — ACTIVES PAR DÉFAUT, exactement comme côté
 * expert. Le bucket vient de la dérivation serveur portée par le helper ; le
 * client reçoit `lifecycle` et se contente d'en rendre la raison.
 *
 * ?facet=<facette> — découpage FIN du bucket (lib/candidatures/facets.ts).
 * Dérivé de `lifecycle.reason`, comme les compteurs `facets` servis dans la
 * MÊME réponse et sur le MÊME tableau : « à consulter » compte exactement ce
 * que « à consulter » liste. C'est aussi la source des tuiles de l'accueil
 * entreprise, qui appellent cette route — pas un second agrégat.
 *
 * Tri : ai_match_score DESC NULLS LAST, created_at DESC (héritage helper).
 * Le DTO inclut publication_id pour permettre le regroupement côté UI.
 *
 * On joint un mini-DTO publication { id, type, title, status } pour chaque
 * publication référencée par les candidatures retournées.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function normalizeLocale(raw: string | null): Locale {
  return (routing.locales as readonly string[]).includes(raw ?? '')
    ? (raw as Locale)
    : routing.defaultLocale
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

  // ── Charger TOUTES les publications de l'org (ownership stricte) ────────
  //    On filtre côté code par organization_id — RLS publications applique
  //    déjà la contrainte, on re-vérifie pour defense-in-depth.
  //    Lot grille photo-forward : on charge aussi `skills_required` pour
  //    permettre au client de surligner les compétences matchées
  //    (intersection avec preview.skills de chaque candidature).
  const { data: pubsRaw, error: pErr } = await auth.supabaseAdmin
    .from('publications')
    .select('id, type, title, status, organization_id, skills_required')
    .eq('organization_id', orgId)
  if (pErr) {
    console.error('[me/candidatures-org:GET] pubs lookup failed', pErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const pubs = (pubsRaw ?? []) as { id: string; type: string; title: string; status: string; organization_id: string; skills_required: string[] | null }[]
  // Filtre defense-in-depth : on garde uniquement les publications dont l'org
  // correspond à celle du user courant (au cas où RLS échouerait silencieusement).
  const ownedPubs = pubs.filter((p) => p.organization_id === orgId)
  const publicationIds = ownedPubs.map((p) => p.id)

  if (publicationIds.length === 0) {
    return json(
      {
        candidatures: [],
        publications: [],
        counts: { active: 0, archived: 0 },
        facets: emptyFacetCounts(),
        filter: 'active',
        facet: null,
      },
      200,
    )
  }

  // ── Délégation au helper partagé (même masquage que vue per-pub) ────────
  const url = new URL(request.url)
  const locale = normalizeLocale(url.searchParams.get('locale'))
  const bucketFilter = parseBucketFilter(url.searchParams.get('filter'))
  const facetFilter = parseFacetFilter(url.searchParams.get('facet'), bucketFilter)
  const translations = await loadTranslations(locale)
  // Deux passes sur le MÊME helper : la totalité alimente les compteurs des
  // deux onglets, la vue filtrée alimente la liste. Une seule source de
  // dérivation, donc jamais de compteur qui contredit la liste.
  let all: Awaited<ReturnType<typeof buildOrgCandidatureDTOs>>
  try {
    all = await buildOrgCandidatureDTOs(auth, publicationIds, translations, null, locale)
  } catch {
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const counts = countByBucket(all)
  const facets = countFacets(all)
  assertFacetPartition(facets, counts, 'me/candidatures-org')
  const candidatures = all.filter((c) => {
    if (bucketFilter && c.lifecycle.bucket !== bucketFilter) return false
    if (facetFilter && facetForLifecycle(c.lifecycle) !== facetFilter) return false
    return true
  })

  // Mini-DTO publication pour permettre le regroupement / labels côté UI.
  // On ne renvoie QUE les publications qui ont au moins une candidature, pour
  // alléger la payload.
  // Lot grille photo-forward : on expose aussi `skills_required` au niveau
  // publication (1 entrée par pub) plutôt que dupliqué sur chaque candidature.
  // Le client calcule l'intersection avec preview.skills pour surligner les
  // compétences matchées sur la card.
  const refPubIds = new Set(candidatures.map((c) => c.publication_id))
  const publications = ownedPubs
    .filter((p) => refPubIds.has(p.id))
    .map((p) => ({
      id: p.id,
      type: p.type,
      title: p.title,
      status: p.status,
      skills_required: p.skills_required ?? [],
    }))

  return json(
    { candidatures, publications, counts, facets, filter: bucketFilter ?? 'all', facet: facetFilter },
    200,
  )
}
