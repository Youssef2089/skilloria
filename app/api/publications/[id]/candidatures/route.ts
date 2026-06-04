import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { loadTranslations } from '@/lib/translations'
import { routing, type Locale } from '@/i18n/routing'
import { buildOrgCandidatureDTOs } from '@/lib/candidature-org-dto'

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
  const { data: pub, error: pubErr } = await auth.supabaseAdmin
    .from('publications')
    .select('id, organization_id, type, title, confidential, status')
    .eq('id', publicationId)
    .maybeSingle()
  if (pubErr) {
    console.error('[publications/[id]/candidatures:GET] pub lookup failed', pubErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!pub) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }
  const pubRow = pub as { id: string; organization_id: string; type: string; title: string; confidential: boolean; status: string }
  if (pubRow.organization_id !== orgId) {
    // 404 plutôt que 403 — ne pas leak l'existence d'une publi d'une autre org.
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }

  // ── Délégation au helper partagé (SC6) ─────────────────────────────────
  //    Le même builder DTO est utilisé par /api/me/candidatures-org pour la
  //    vue globale org. Tout invariant masquage/unlock vit dans le helper —
  //    aucune divergence possible entre vue per-publication et vue globale.
  const locale = normalizeLocale(new URL(request.url).searchParams.get('locale'))
  const translations = await loadTranslations(locale)
  let candidatures: Awaited<ReturnType<typeof buildOrgCandidatureDTOs>>
  try {
    candidatures = await buildOrgCandidatureDTOs(auth, [publicationId], translations)
  } catch {
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  return json(
    {
      publication: {
        id: pubRow.id,
        type: pubRow.type,
        title: pubRow.title,
        status: pubRow.status,
      },
      candidatures,
    },
    200,
  )
}
