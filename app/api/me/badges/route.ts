import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { deriveCandidatureLifecycle } from '@/lib/candidatures/lifecycle'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/me/badges — source UNIQUE pour les badges nav (Lot bascule
 * "badge = items NOUVEAUX non consultés par item").
 *
 * Modèle :
 *   - missions             = matches dont status ∈ ('pending','notified')
 *                            pour le profil expert courant.
 *                            (Le flip 'viewed' se fait à l'ouverture du
 *                            détail mission, cf. /api/me/missions/[id].)
 *   - candidatures_expert  = candidatures de l'expert NON consultées par lui
 *                            (NOT EXISTS candidature_views.viewed_at >= updated_at).
 *   - candidatures_org     = candidatures sur les pubs de l'org NON
 *                            consultées par l'user org courant.
 *   - annonces_org         = ALIAS V1 de candidatures_org (la home org n'a
 *                            pas de notion "annonce non vue" — l'org est
 *                            créatrice de ses annonces ; le badge signale
 *                            les candidatures fraîches à traiter).
 *
 * Surfaces NON gérées ici (modèles propres déjà par-item) :
 *   - messages : /api/me/conversations → unread_count par conv.
 *   - cloche   : /api/me/notifications → unread_count.
 *
 * Sécurité : requireAuth + service_role. Ne fuite aucun count d'autres orgs
 * (le filtrage org passe par auth.organization?.id, idem expert via son
 * profile_id). Section inactive pour le user courant → 0 (pas d'erreur).
 *
 * Polling 30s côté useNavBadges. Décrément INSTANTANÉ après une action via
 * dispatch 'skilloria:notif-bump' côté client → useNavBadges.mutate().
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type BadgeCounts = {
  missions: number
  candidatures_expert: number
  candidatures_org: number
  annonces_org: number
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const counts: BadgeCounts = {
    missions: 0,
    candidatures_expert: 0,
    candidatures_org: 0,
    annonces_org: 0,
  }

  // ── Profile expert (peut être absent côté membres d'org pur) ────────────
  const { data: profile } = await auth.supabaseAdmin
    .from('profiles')
    .select('id, verification_status')
    .eq('user_id', auth.user.id)
    .maybeSingle()
  const expertProfile = profile as { id: string; verification_status?: string | null } | null

  // ── missions (expert) ───────────────────────────────────────────────────
  // = matches "à voir" : status ∈ ('pending','notified'). Le flip 'viewed'
  // arrive à l'ouverture du détail (/api/me/missions/[id]) → décrément.
  if (expertProfile && expertProfile.verification_status === 'approved') {
    const { count, error } = await auth.supabaseAdmin
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', expertProfile.id)
      .in('status', ['pending', 'notified'])
    if (error) {
      console.error('[me/badges:GET] missions count failed', error.message)
    } else {
      counts.missions = count ?? 0
    }
  }

  // ── candidatures_expert ─────────────────────────────────────────────────
  // Candidatures du profil NON consultées par l'user (la vue "consultée"
  // expire dès que candidatures.updated_at avance, ex. après un unlock/select
  // /reject côté org → la candidature redevient "à reconsulter").
  //
  // Supabase JS ne sait pas exprimer "NOT EXISTS join LATERAL" trivialement.
  // Pattern : 2 SELECT batch + diff client-side. O(N + M) où N=candidatures
  // du profile, M=views du user. Volumes faibles (centaines max V1).
  if (expertProfile) {
    counts.candidatures_expert = await countUnviewedCandidaturesForUser(
      auth,
      { kind: 'expert', profileId: expertProfile.id },
    )
  }

  // ── candidatures_org + annonces_org (org members) ───────────────────────
  const orgId = auth.organization?.id ?? null
  if (orgId) {
    const orgUnviewed = await countUnviewedCandidaturesForUser(auth, {
      kind: 'org',
      orgId,
    })
    counts.candidatures_org = orgUnviewed
    counts.annonces_org = orgUnviewed  // alias V1 (cf. en-tête)
  }

  return json({ badges: counts }, 200)
}

/**
 * Compte les candidatures NON consultées par le user courant pour le scope
 * demandé (expert = ses propres candidatures, org = candidatures sur les
 * pubs de l'org).
 *
 * Sémantique "non consultée" :
 *   - aucune ligne dans candidature_views (user_id, candidature_id), OU
 *   - candidature_views.viewed_at < candidatures.updated_at (statut a
 *     bougé depuis la dernière consultation → la candidature revient
 *     dans le compteur).
 *
 * ARCHIVÉES EXCLUES (lot état de vie) : une candidature morte ne ping plus.
 * Un échange dont la fenêtre 15 j est passée, une candidature dont l'annonce
 * a expiré, un refus — plus rien n'en sortira, donc plus rien à traiter. Le
 * bucket vient du MÊME helper de dérivation que les listes : le badge ne peut
 * pas compter ce que l'onglet « Actives » n'affiche pas.
 *
 * Best-effort : si le sous-SELECT scope échoue, on retourne 0 plutôt que
 * de propager une 500 (le badge nav doit rester silencieux en cas de pépin
 * non-bloquant).
 */
async function countUnviewedCandidaturesForUser(
  auth: AuthContext,
  scope:
    | { kind: 'expert'; profileId: string }
    | { kind: 'org'; orgId: string },
): Promise<number> {
  // 1. Liste des candidatures du scope (+ entrées de dérivation d'état de vie)
  let candQuery = auth.supabaseAdmin
    .from('candidatures')
    .select('id, updated_at, status, unlocked_at, publication_id')
    .limit(2000)

  if (scope.kind === 'expert') {
    candQuery = candQuery.eq('profile_id', scope.profileId)
  } else {
    const { data: pubsRaw } = await auth.supabaseAdmin
      .from('publications')
      .select('id')
      .eq('organization_id', scope.orgId)
    const pubIds = ((pubsRaw ?? []) as { id: string }[]).map((p) => p.id)
    if (pubIds.length === 0) return 0
    candQuery = candQuery.in('publication_id', pubIds)
  }

  const { data: candRowsRaw, error: cErr } = await candQuery
  if (cErr) {
    console.error('[me/badges] candidatures scope query failed', cErr.message)
    return 0
  }
  const candRowsAll = (candRowsRaw ?? []) as {
    id: string; updated_at: string; status: string
    unlocked_at: string | null; publication_id: string
  }[]
  if (candRowsAll.length === 0) return 0

  // 1bis. Fenêtres annonce + fenêtres échange, pour dériver le bucket.
  const pubIdsRef = Array.from(new Set(candRowsAll.map((c) => c.publication_id)))
  const pubById = new Map<string, { status: string | null; published_at: string | null; expires_at: string | null }>()
  if (pubIdsRef.length > 0) {
    const { data: pubRows } = await auth.supabaseAdmin
      .from('publications')
      .select('id, status, published_at, expires_at')
      .in('id', pubIdsRef)
    for (const p of (pubRows ?? []) as { id: string; status: string | null; published_at: string | null; expires_at: string | null }[]) {
      pubById.set(p.id, { status: p.status, published_at: p.published_at, expires_at: p.expires_at })
    }
  }
  const convExpiryByCand = new Map<string, string | null>()
  const conversableIds = candRowsAll
    .filter((c) => c.status === 'unlocked' || c.status === 'selected')
    .map((c) => c.id)
  if (conversableIds.length > 0) {
    const { data: convRows } = await auth.supabaseAdmin
      .from('conversations')
      .select('candidature_id, expires_at')
      .in('candidature_id', conversableIds)
    for (const c of (convRows ?? []) as { candidature_id: string; expires_at: string | null }[]) {
      convExpiryByCand.set(c.candidature_id, c.expires_at)
    }
  }

  // 1ter. ARCHIVÉES ÉCARTÉES avant tout comptage (cf. en-tête).
  const now = new Date()
  const candRows = candRowsAll.filter((c) => {
    const lifecycle = deriveCandidatureLifecycle(
      {
        status: c.status,
        unlocked_at: c.unlocked_at,
        publication: pubById.get(c.publication_id) ?? null,
        conversation: convExpiryByCand.has(c.id) ? { expires_at: convExpiryByCand.get(c.id) ?? null } : null,
      },
      now,
    )
    return lifecycle.bucket === 'active'
  })
  if (candRows.length === 0) return 0

  // 2. Vues de l'user courant pour ces candidatures
  const candIds = candRows.map((c) => c.id)
  const { data: viewsRaw, error: vErr } = await auth.supabaseAdmin
    .from('candidature_views')
    .select('candidature_id, viewed_at')
    .eq('user_id', auth.user.id)
    .in('candidature_id', candIds)
  if (vErr) {
    console.error('[me/badges] candidature_views query failed', vErr.message)
    return 0
  }
  const viewedAtByCand = new Map<string, string>()
  for (const v of (viewsRaw ?? []) as { candidature_id: string; viewed_at: string }[]) {
    viewedAtByCand.set(v.candidature_id, v.viewed_at)
  }

  // 3. Diff : "non consultée" si pas de view, OU viewed_at < updated_at
  let unviewed = 0
  for (const c of candRows) {
    const v = viewedAtByCand.get(c.id)
    if (!v) {
      unviewed++
      continue
    }
    if (new Date(v).getTime() < new Date(c.updated_at).getTime()) {
      unviewed++
    }
  }
  return unviewed
}
