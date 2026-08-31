import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { loadTranslations } from '@/lib/translations'
import { routing, type Locale } from '@/i18n/routing'
import { buildOrgCandidatureDTOs, countByBucket } from '@/lib/candidature-org-dto'
import { parseBucketFilter } from '@/lib/candidatures/lifecycle'
import {
  assertFacetPartition,
  countFacets,
  facetForLifecycle,
  parseFacetFilter,
} from '@/lib/candidatures/facets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/publications/[id]/candidatures — liste des candidatures sur une
 * publication, côté ORG.
 *
 * Garde (service_role) :
 *  - requireAuth + auth.organization?.id présent (membre actif d'une org)
 *  - publication.organization_id == auth.organization.id  (ownership stricte)
 *
 * Masquage stricte (cf. décision Lot 2c, point 3) :
 *  - PROFILE COMPLET NON LISIBLE : on ne fait AUCUNE jointure sur `profiles`.
 *    Tant que candidature.status != 'unlocked', l'UI ne voit que la
 *    `preview` (whitelist safe-fields posée à l'INSERT par Lot 2b) +
 *    cover_message + ai_match_score + status.
 *  - `profile_id` est exposé en référence opaque (uuid), pour permettre à
 *    l'UI post-unlock d'appeler la route /api/profiles/[id] (à venir) qui
 *    projettera le profil complet (RLS profiles_org_unlocked_read s'active
 *    alors automatiquement côté authenticated).
 *
 * ?filter=active|archived|all — ACTIVES PAR DÉFAUT (parité stricte avec la
 * vue globale org et avec les deux menus expert). Le bucket est dérivé
 * serveur par le helper partagé ; le DTO porte `lifecycle`.
 *
 * Tri : ai_match_score DESC NULLS LAST, created_at DESC.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

function normalizeLocale(raw: string | null): Locale {
  return (routing.locales as readonly string[]).includes(raw ?? '')
    ? (raw as Locale)
    : routing.defaultLocale
}

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: RouteContext): Promise<Response> {
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

  const { id: publicationId } = await ctx.params
  if (!publicationId || !UUID_REGEX.test(publicationId)) {
    return json({ error: 'Invalid id', code: 'invalid_id' }, 400)
  }

  // ── Ownership : la publication appartient à cette org ──────────────────
  // Lot grille photo-forward : on charge aussi `skills_required` pour le
  // client (surlignage compétences matchées). 1 entrée par pub.
  const { data: pub, error: pubErr } = await auth.supabaseAdmin
    .from('publications')
    .select('id, organization_id, type, title, confidential, status, skills_required')
    .eq('id', publicationId)
    .maybeSingle()
  if (pubErr) {
    console.error('[publications/[id]/candidatures:GET] pub lookup failed', pubErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!pub) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }
  const pubRow = pub as {
    id: string
    organization_id: string
    type: string
    title: string
    confidential: boolean
    status: string
    skills_required: string[] | null
  }
  if (pubRow.organization_id !== orgId) {
    // 404 plutôt que 403 — ne pas leak l'existence d'une publi d'une autre org.
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }

  // ── Délégation au helper partagé (SC6) ─────────────────────────────────
  //    Le même builder DTO est utilisé par /api/me/candidatures-org pour la
  //    vue globale org. Tout invariant masquage/unlock vit dans le helper —
  //    aucune divergence possible entre vue per-publication et vue globale.
  const url = new URL(request.url)
  const locale = normalizeLocale(url.searchParams.get('locale'))
  const bucketFilter = parseBucketFilter(url.searchParams.get('filter'))
  const facetFilter = parseFacetFilter(url.searchParams.get('facet'), bucketFilter)
  const translations = await loadTranslations(locale)
  let all: Awaited<ReturnType<typeof buildOrgCandidatureDTOs>>
  try {
    all = await buildOrgCandidatureDTOs(auth, [publicationId], translations, null, locale)
  } catch {
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  // Compteurs sur la totalité, liste filtrée : cf. /api/me/candidatures-org.
  // `facets` alimente les chips ET les quatre compteurs d'<AnnonceCard>, qui
  // pointent vers cette même route : même tableau, même prédicat.
  const counts = countByBucket(all)
  const facets = countFacets(all)
  assertFacetPartition(facets, counts, `publications/${publicationId}/candidatures`)
  const candidatures = all.filter((c) => {
    if (bucketFilter && c.lifecycle.bucket !== bucketFilter) return false
    if (facetFilter && facetForLifecycle(c.lifecycle) !== facetFilter) return false
    return true
  })

  return json(
    {
      publication: {
        id: pubRow.id,
        type: pubRow.type,
        title: pubRow.title,
        status: pubRow.status,
        skills_required: pubRow.skills_required ?? [],
      },
      candidatures,
      counts,
      facets,
      filter: bucketFilter ?? 'all',
      facet: facetFilter,
    },
    200,
  )
}
