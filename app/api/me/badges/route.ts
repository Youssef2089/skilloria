import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { activeEcosystemId } from '@/lib/ecosystem-scope'
import { chargerDurees, DUREES_ILLISIBLES_CODE } from '@/lib/durees'
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

  // ── LES DURÉES SONT LUES ICI, PAR LA ROUTE ───────────────────────────────
  //  Aucun défaut dans le code (cf. lib/durees.ts) : illisibles, on REFUSE en
  //  le nommant plutôt que de servir une durée inventée. Même parti pris que
  //  `matching_settings` — un repli codé en dur devient une seconde source de
  //  vérité, et elle prend la main le jour où l'on comprend le moins.
  const lectureDurees = await chargerDurees(auth.supabaseAdmin)
  if (!lectureDurees.ok) {
    console.error('[me/badges:GET] durées de la place illisibles', lectureDurees.raison)
    return json({ error: 'Durations unavailable', code: DUREES_ILLISIBLES_CODE }, 503)
  }
  const durees = lectureDurees.durees

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
      vieAnnonceJours: durees.vieAnnonceJours,
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
  // EXACTITUDE RENDUE AVEC LE COMPTE. Un badge tronqué doit s'afficher
  // « 2 000+ » et non un chiffre inventé : c'est la différence entre un
  // compteur qui se tait sur ce qu'il ignore et un compteur qui ment.
  const approximatifs: string[] = []
  if (expertProfile) {
    const c = await countUnviewedCandidaturesForUser(auth, durees, {
      kind: 'expert',
      profileId: expertProfile.id,
    })
    counts.candidatures_expert = c.valeur
    if (!c.exact) approximatifs.push('candidatures_expert')
  }

  // ── candidatures_org + annonces_org (org members) ───────────────────────
  const orgId = auth.organization?.id ?? null
  if (orgId) {
    const orgUnviewed = await countUnviewedCandidaturesForUser(auth, durees, {
      kind: 'org',
      orgId,
    })
    counts.candidatures_org = orgUnviewed.valeur
    counts.annonces_org = orgUnviewed.valeur  // alias V1 (cf. en-tête)
    if (!orgUnviewed.exact) approximatifs.push('candidatures_org', 'annonces_org')
  }

  // `approximatifs` est vide dans l'immense majorité des cas. Le rendre TOUJOURS
  // — plutôt que seulement quand il est non vide — évite à l'écran d'avoir à
  // distinguer « absent » de « aucun », distinction dont il ne peut rien faire.
  return json({ badges: counts, approximatifs }, 200)
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
/**
 * Nombre de candidatures chargées pour dériver le compteur.
 *
 * INCHANGÉ EN VALEUR — ce n'est pas un relèvement de plafond, c'est la fin d'un
 * mensonge. Le tri par `updated_at` décroissant est nouveau : tronquer une
 * liste NON TRIÉE retenait des lignes arbitraires, ce qui rendait le chiffre
 * faux ET instable d'un appel à l'autre.
 */
const PLAFOND_CANDIDATURES = 2000

type CompteBadge = { valeur: number; exact: boolean }

async function countUnviewedCandidaturesForUser(
  auth: AuthContext,
  /** Les deux durées, EXIGÉES — lues par la route (cf. lib/durees.ts). */
  durees: { vieAnnonceJours: number; fenetreEchangeJours: number },
  scope:
    | { kind: 'expert'; profileId: string }
    | { kind: 'org'; orgId: string },
): Promise<CompteBadge> {
  // 1. Liste des candidatures du scope (+ entrées de dérivation d'état de vie)
  //
  //  ⚠️ CE PLAFOND EXISTE, ET IL NE MENT PLUS.
  //    L'état de vie d'une candidature se dérive en mémoire, par le MÊME
  //    assemblage que les compteurs par annonce — le réécrire en SQL en ferait
  //    une seconde copie, et deux copies dérivent. On charge donc des lignes,
  //    et il faut bien s'arrêter quelque part.
  //
  //    Ce qui était faux, c'est le SILENCE : au-delà de 2 000 candidatures, le
  //    chiffre affiché était simplement inexact, et rien ne le disait. Un
  //    compteur qui ment est pire qu'un compteur absent — on lui fait
  //    confiance.
  //
  //    Le plafond est désormais RENDU avec le compte : l'appelant sait si le
  //    nombre est exact, et l'écran peut afficher « 2 000+ » plutôt qu'un
  //    chiffre inventé. Une lecture de plus, tronquée elle aussi, dirait la
  //    même chose en coûtant davantage.
  let candQuery = auth.supabaseAdmin
    .from('candidatures')
    .select('id, updated_at, status, unlocked_at, publication_id')
    .order('updated_at', { ascending: false })
    .limit(PLAFOND_CANDIDATURES)

  if (scope.kind === 'expert') {
    candQuery = candQuery.eq('profile_id', scope.profileId)
  } else {
    const { data: pubsRaw, error: pubsErr } = await auth.supabaseAdmin
      .from('publications')
      .select('id')
      // CLOISONNEMENT — un badge qui compte les deux écosystèmes afficherait un
      // nombre ne correspondant à rien de ce que l'écran montre.
      .eq('organization_id', scope.orgId)
      .eq('domain_id', activeEcosystemId(auth))
    // ⚠️ « ZÉRO, EXACTEMENT » DIT SUR UNE PANNE — ET LA PARADE ÉTAIT DÉJÀ
    //    LÀ, À DOUZE LIGNES. Ce DTO porte `exact`, et deux retours plus bas
    //    s'en servent (`pubWindows === null`, `lifecycleByCand === null`).
    //    Ici la liste des annonces tombait à `[]` sans que l’erreur soit même
    //    récupérée, et le badge affirmait un zéro EXACT. La bonne pratique
    //    était écrite dans le fichier ; elle n’était pas gardée (§E.22 ⑨).
    if (pubsErr) {
      console.error('[me/badges] annonces de l’organisation ILLISIBLES — compte inconnu', {
        organizationId: scope.orgId,
        message: pubsErr.message,
      })
      return { valeur: 0, exact: false }
    }
    const pubIds = ((pubsRaw ?? []) as { id: string }[]).map((p) => p.id)
    // Zéro annonce est un FAIT, lui : il reste exact.
    if (pubIds.length === 0) return { valeur: 0, exact: true }
    candQuery = candQuery.in('publication_id', pubIds)
  }

  const { data: candRowsRaw, error: cErr } = await candQuery
  if (cErr) {
    console.error('[me/badges] candidatures scope query failed', cErr.message)
    // ⚠️ MÊME FAUTE, DEUX LIGNES PLUS BAS, ET LE RECENSEMENT NE LA VOIT PAS :
    //    la valeur rendue est un OBJET, pas `null` / `[]` / `0`, donc le
    //    motif de `diag-erreurs-avalees` ne mord pas dessus (§E.38). Elle a
    //    été trouvée en lisant sa voisine — et c’est exactement pourquoi on
    //    cherche toujours le jumeau (§E.28 ③).
    return { valeur: 0, exact: false }
  }
  const candRowsAll = (candRowsRaw ?? []) as {
    id: string; updated_at: string; status: string
    unlocked_at: string | null; publication_id: string
  }[]
  if (candRowsAll.length === 0) return { valeur: 0, exact: true }

  // Le plafond a-t-il mordu ? Si oui, le compte qui suit porte sur un
  // sous-ensemble : il est MINORANT, jamais exact. L'appelant doit le savoir.
  const tronque = candRowsAll.length >= PLAFOND_CANDIDATURES
  if (tronque) {
    console.warn('[me/badges] plafond atteint — le compte est minorant, pas exact', {
      scope: scope.kind,
      plafond: PLAFOND_CANDIDATURES,
    })
  }

  // 1bis. Fenêtres annonce + fenêtres échange, puis dérivation — assemblage
  //       PARTAGÉ (lib/candidatures/lifecycle-batch), le même que celui qui
  //       alimente les compteurs par annonce de /api/publications.
  const pubIdsRef = Array.from(new Set(candRowsAll.map((c) => c.publication_id)))
  const pubWindows = await loadLifecyclePublicationWindows(auth.supabaseAdmin, pubIdsRef)
  // Fenêtres illisibles ⇒ on ne COMPTE pas. `exact: false` est le mot déjà
  // employé par cette route pour « ce chiffre n'est pas sûr » : un badge à 0
  // dirait « rien de neuf » au moment précis où on ne sait pas (§E.22 ⑨).
  if (pubWindows === null) return { valeur: 0, exact: false }

  // 1ter. ARCHIVÉES ÉCARTÉES avant tout comptage (cf. en-tête).
  const now = new Date()
  const lifecycleByCand = await deriveLifecycleByCandidature(
    auth.supabaseAdmin,
    candRowsAll,
    pubWindows,
    durees,
    now,
  )
  if (lifecycleByCand === null) return { valeur: 0, exact: false }
  const candRows = candRowsAll.filter((c) => lifecycleByCand.get(c.id)?.bucket === 'active')
  if (candRows.length === 0) return { valeur: 0, exact: tronque ? false : true }

  // 2. Vues de l'user courant pour ces candidatures
  const candIds = candRows.map((c) => c.id)
  const { data: viewsRaw, error: vErr } = await auth.supabaseAdmin
    .from('candidature_views')
    .select('candidature_id, viewed_at')
    .eq('user_id', auth.user.id)
    .in('candidature_id', candIds)
  if (vErr) {
    console.error('[me/badges] candidature_views query failed', vErr.message)
    return { valeur: 0, exact: true }
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
  return { valeur: unviewed, exact: !tronque }
}
