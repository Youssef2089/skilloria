import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { activeEcosystemId } from '@/lib/ecosystem-scope'
import {
  deriveLifecycleByCandidature,
  loadLifecyclePublicationWindows,
} from '@/lib/candidatures/lifecycle-batch'
import {
  buildExpertMissionsSelect,
  expertMissionsQuery,
  loadExpertFeedContext,
  EXPERT_FEED_LIMIT,
  type ExpertFeedContext,
} from '@/lib/missions/feed'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/me/badges — source UNIQUE pour les badges nav (Lot bascule
 * "badge = items NOUVEAUX non consultés par item").
 *
 * Modèle :
 *   - missions             = matches ÉLIGIBLES AU FEED (lib/missions/feed.ts,
 *                            le MÊME helper que /api/me/missions) dont le
 *                            status ∈ ('pending','notified').
 *                            (Le flip 'viewed' se fait à l'ouverture du
 *                            détail mission, cf. /api/me/missions/[id].)
 *                            Le compteur est donc un SOUS-ENSEMBLE de la liste
 *                            PAR CONSTRUCTION : annonce expirée (30 j read-time),
 *                            clôturée, ou expert en « Ne pas déranger » →
 *                            l'item n'est ni affiché ni compté. Aucune règle de
 *                            filtrage n'est recopiée ici — si tu es tenté d'en
 *                            écrire une, c'est le helper qu'il faut corriger.
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

  // ── Contexte d'éligibilité expert (helper PARTAGÉ avec /api/me/missions) ─
  //  Peut être absent côté membres d'org pur → sections expert à 0.
  //  Best-effort : une lecture ratée laisse les compteurs expert à 0 plutôt que
  //  de propager une 500 (le badge nav doit rester silencieux).
  let feedContext: ExpertFeedContext | null = null
  const feedCtxResult = await loadExpertFeedContext(auth.supabaseAdmin, auth.user.id)
  if (!feedCtxResult.ok) {
    console.error('[me/badges:GET] profile lookup failed', feedCtxResult.message)
  } else {
    feedContext = feedCtxResult.context
  }
  const expertProfile = feedContext?.profile ?? null

  // ── missions (expert) ───────────────────────────────────────────────────
  // = matches "à voir" : status ∈ ('pending','notified'). Le flip 'viewed'
  // arrive à l'ouverture du détail (/api/me/missions/[id]) → décrément.
  //
  // `isOpen` (profil approuvé ET hors « Ne pas déranger ») et les filtres
  // publication viennent de lib/missions/feed.ts — même contexte, même requête
  // que le feed. Un expert dont le feed est vide ne peut plus porter de badge.
  if (expertProfile && feedContext?.isOpen) {
    const { count, error } = await expertMissionsQuery(auth.supabaseAdmin, expertProfile.id, {
      select: buildExpertMissionsSelect(),
      count: 'exact',
      head: true,
    }).in('status', ['pending', 'notified'])
    if (error) {
      console.error('[me/badges:GET] missions count failed', error.message)
    } else {
      // Borné au plafond du feed : le badge n'annonce jamais plus d'items que
      // la page ne peut en afficher.
      counts.missions = Math.min(count ?? 0, EXPERT_FEED_LIMIT)
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
      // CLOISONNEMENT — un badge qui compte les deux écosystèmes afficherait un
      // nombre ne correspondant à rien de ce que l'écran montre.
      .eq('organization_id', scope.orgId)
      .eq('domain_id', activeEcosystemId(auth))
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

  // 1bis. Fenêtres annonce + fenêtres échange, puis dérivation — assemblage
  //       PARTAGÉ (lib/candidatures/lifecycle-batch), le même que celui qui
  //       alimente les compteurs par annonce de /api/publications.
  const pubIdsRef = Array.from(new Set(candRowsAll.map((c) => c.publication_id)))
  const pubWindows = await loadLifecyclePublicationWindows(auth.supabaseAdmin, pubIdsRef)

  // 1ter. ARCHIVÉES ÉCARTÉES avant tout comptage (cf. en-tête).
  const now = new Date()
  const lifecycleByCand = await deriveLifecycleByCandidature(
    auth.supabaseAdmin,
    candRowsAll,
    pubWindows,
    now,
  )
  const candRows = candRowsAll.filter((c) => lifecycleByCand.get(c.id)?.bucket === 'active')
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
