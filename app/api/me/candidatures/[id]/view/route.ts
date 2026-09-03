import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext, type AuthOrganization } from '@/lib/auth-guard'
import { activeEcosystemId } from '@/lib/ecosystem-scope'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/me/candidatures/[id]/view — marque une candidature comme
 * "consultée" par l'utilisateur courant (Lot global C2 bis : modèle badge
 * "par item consulté").
 *
 * Upsert dans `public.candidature_views (user_id, candidature_id, viewed_at)`.
 *
 *  Garde (service_role) :
 *   1. requireAuth — sinon 401.
 *   2. **GARDE D'ACCÈS STRICTE** (sécurité #20, non contournable) :
 *      - EXPERT (candidatures.profile_id = profile.id de l'user courant)
 *      - OU ORG (publication.organization_id = auth.organization.id)
 *      → sinon 404 not_found (silencieux, même semantic qu'une candidature
 *        inexistante — pas de leak d'existence).
 *
 *  user_id écrit = `auth.user.id`. Jamais d'override possible.
 *
 *  Sémantique "fresh" (cf. /api/me/badges) :
 *    consulté = EXISTS candidature_views.viewed_at >= candidatures.updated_at.
 *    Comme updated_at se bump à chaque transition (unlocked/selected/rejected),
 *    la candidature redevient automatiquement "non consultée" après une
 *    action côté org → le badge expert/org se rallume → l'user re-consulte → 0.
 *
 *  Idempotent : 2 POST consécutifs sont autorisés et écrasent viewed_at avec
 *  now() (PRIMARY KEY (user_id, candidature_id) + ON CONFLICT DO UPDATE).
 *
 *  Au succès, le client dispatch `skilloria:notif-bump` → useNavBadges
 *  revalide /api/me/badges → décrément INSTANTANÉ du badge nav.
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
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { id: candidatureId } = await ctx.params
  if (!candidatureId || !UUID_REGEX.test(candidatureId)) {
    return json({ error: 'Invalid id', code: 'invalid_id' }, 400)
  }

  // ── Garde d'accès ──────────────────────────────────────────────────────
  // Une candidature est consultable par :
  //   (a) l'EXPERT qui en est l'auteur (candidatures.profile_id == profile
  //       du user courant)
  //   (b) un MEMBRE de l'org qui possède la publication
  //       (publications.organization_id == auth.organization.id)
  //
  // On n'expose pas de différence entre "candidature inexistante" et
  // "candidature non accessible" → toujours 404 silencieux (anti-énumération).
  const orgId: string | null = (auth.organization as AuthOrganization | null)?.id ?? null

  const { data: candRow, error: candErr } = await auth.supabaseAdmin
    .from('candidatures')
    .select(
      'id, profile_id, publication_id, ' +
        'profiles!inner(user_id), ' +
        'publications!inner(organization_id)',
    )
    // CLOISONNEMENT — marquage « vu » : il ne doit pas être possible depuis
    // un écosystème où la candidature n'apparaît pas.
    .eq('id', candidatureId)
    .eq('domain_id', activeEcosystemId(auth))
    .maybeSingle()
  if (candErr) {
    console.error('[me/candidatures/[id]/view:POST] lookup failed', candErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!candRow) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }

  type Joined = {
    id: string
    profile_id: string
    publication_id: string
    profiles: { user_id: string } | { user_id: string }[]
    publications: { organization_id: string } | { organization_id: string }[]
  }
  const c = candRow as unknown as Joined
  const candProfile = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles
  const candPub = Array.isArray(c.publications) ? c.publications[0] : c.publications

  const isExpertOwner = candProfile?.user_id === auth.user.id
  const isOrgOwner = !!orgId && candPub?.organization_id === orgId
  if (!isExpertOwner && !isOrgOwner) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }

  // ── Upsert candidature_views ───────────────────────────────────────────
  const nowIso = new Date().toISOString()
  const { error: upErr } = await auth.supabaseAdmin
    .from('candidature_views')
    .upsert(
      { user_id: auth.user.id, candidature_id: candidatureId, viewed_at: nowIso },
      { onConflict: 'user_id,candidature_id' },
    )
  if (upErr) {
    console.error('[me/candidatures/[id]/view:POST] upsert failed', upErr.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  return json({ ok: true, viewed_at: nowIso }, 200)
}
