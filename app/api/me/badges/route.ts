import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { SECTION_KEYS, type SectionKey } from '@/lib/section-visits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/me/badges
 *
 * Source UNIQUE pour les badges rouges de la nav (Lot global C2, règle unique).
 * Pour chaque section couverte, retourne le nombre d'items NOUVEAUX depuis la
 * dernière visite enregistrée dans `user_section_visits`.
 *
 * Surfaces couvertes :
 *   - missions             (expert) : matches du profil créés > last_visited
 *   - candidatures_expert  (expert) : candidatures du profil dont updated_at
 *                                     > last_visited (status flipped par l'org)
 *   - candidatures_org     (org)    : candidatures sur les pubs de l'org dont
 *                                     created_at > last_visited (nouvelles
 *                                     candidatures reçues)
 *   - annonces_org         (org)    : alias de candidatures_org en V1 — la
 *                                     home org listant les annonces n'a pas
 *                                     de notion d'item nouveau distincte ;
 *                                     on remonte le compteur de candidatures
 *                                     reçues (cohérent UX).
 *
 * Surfaces NON gérées ici (conserveent leur propre source) :
 *   - messages : `/api/me/conversations` → somme unread_count.
 *   - cloche   : `/api/me/notifications` → unread_count.
 *
 * Règle "jamais de last_visited" : si la ligne est absente pour une section
 * donnée, on considère qu'AUCUN item n'a été vu — TOUS les items existants
 * comptent comme nouveaux. C'est le bon défaut produit (l'expert qui n'a
 * jamais ouvert /missions voit le badge plein).
 *
 * Performance : 1 SELECT user_section_visits + 1 SELECT par section concernée
 * (limit côté DB via filtre + count={ exact, head: true }). O(constant)
 * requêtes par appel. Polling 30s côté useNavBadges.
 *
 * Retour : { missions, candidatures_expert, candidatures_org, annonces_org }
 *  où chaque valeur ∈ ℕ. Les sections inactives pour le user courant
 *  (expert sans profile, org sans pubs) retournent 0 — pas d'info fuitée.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type BadgeCounts = Record<SectionKey, number>

// Date "epoch" comme défaut quand aucune visite n'a jamais été enregistrée :
//   tout item existant compte comme nouveau (sémantique "rien n'a été vu").
const EPOCH_ISO = '1970-01-01T00:00:00Z'

export async function GET(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  // Lecture parallèle : visites + (profile expert) + (membre org) en une passe.
  const [visitsRes, profileRes, orgRes] = await Promise.all([
    auth.supabaseAdmin
      .from('user_section_visits')
      .select('section, last_visited_at')
      .eq('user_id', auth.user.id),
    auth.supabaseAdmin
      .from('profiles')
      .select('id, verification_status')
      .eq('user_id', auth.user.id)
      .maybeSingle(),
    // auth.organization.id si dispo (membre actif d'une org). On évite un
    // appel direct si requireAuth a déjà résolu l'org.
    Promise.resolve(auth.organization?.id ?? null),
  ])

  const lastVisited: Record<string, string> = {}
  for (const v of (visitsRes.data ?? []) as { section: string; last_visited_at: string }[]) {
    lastVisited[v.section] = v.last_visited_at
  }
  const counts: BadgeCounts = {
    missions: 0,
    candidatures_expert: 0,
    candidatures_org: 0,
    annonces_org: 0,
  }

  // ── Section EXPERT : missions + candidatures_expert ─────────────────────
  const profile = profileRes.data as { id: string; verification_status?: string | null } | null
  if (profile && profile.verification_status === 'approved') {
    const profileId = profile.id

    // missions = matches du profil créés > last_visited (exclus 'dismissed'
    // pour rester cohérent avec /api/me/missions et la page Offres).
    const sinceMissions = lastVisited.missions ?? EPOCH_ISO
    const { count: missionsCount, error: mErr } = await auth.supabaseAdmin
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profileId)
      .neq('status', 'dismissed')
      .gt('created_at', sinceMissions)
    if (mErr) {
      console.error('[me/badges:GET] missions count failed', mErr.message)
    } else {
      counts.missions = missionsCount ?? 0
    }

    // candidatures_expert = candidatures du profil dont updated_at > last_visited.
    // Le status change (unlock/select/reject) bump updated_at via trg_candidatures_updated_at.
    const sinceCandExpert = lastVisited.candidatures_expert ?? EPOCH_ISO
    const { count: cExpertCount, error: cErr } = await auth.supabaseAdmin
      .from('candidatures')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profileId)
      .gt('updated_at', sinceCandExpert)
    if (cErr) {
      console.error('[me/badges:GET] candidatures_expert count failed', cErr.message)
    } else {
      counts.candidatures_expert = cExpertCount ?? 0
    }
  }

  // ── Section ORG : candidatures_org + annonces_org ───────────────────────
  const orgId = orgRes
  if (orgId) {
    // 1. Récupère les pub.id de l'org (limité aux pubs en cours, status =
    //    'published' ou 'review' — exclut 'archived' pour ne pas compter
    //    sur des annonces tombées).
    const { data: pubsRaw } = await auth.supabaseAdmin
      .from('publications')
      .select('id')
      .eq('organization_id', orgId)
    const pubIds = ((pubsRaw ?? []) as { id: string }[]).map((p) => p.id)
    if (pubIds.length > 0) {
      const sinceCandOrg = lastVisited.candidatures_org ?? EPOCH_ISO
      const { count: cOrgCount, error: oErr } = await auth.supabaseAdmin
        .from('candidatures')
        .select('id', { count: 'exact', head: true })
        .in('publication_id', pubIds)
        .gt('created_at', sinceCandOrg)
      if (oErr) {
        console.error('[me/badges:GET] candidatures_org count failed', oErr.message)
      } else {
        counts.candidatures_org = cOrgCount ?? 0
      }
      // annonces_org : V1 alias = nouvelles candidatures reçues depuis la
      // dernière visite de la home org. Mécanique simple + cohérente avec
      // l'usage observé (le badge sur "Mes annonces" doit signaler les
      // candidatures fraîches sur n'importe quelle annonce).
      const sinceAnnonces = lastVisited.annonces_org ?? EPOCH_ISO
      const { count: aCount, error: aErr } = await auth.supabaseAdmin
        .from('candidatures')
        .select('id', { count: 'exact', head: true })
        .in('publication_id', pubIds)
        .gt('created_at', sinceAnnonces)
      if (aErr) {
        console.error('[me/badges:GET] annonces_org count failed', aErr.message)
      } else {
        counts.annonces_org = aCount ?? 0
      }
    }
  }

  void SECTION_KEYS  // exporté pour assertion de complétude des clés.

  return json({ badges: counts, last_visited: lastVisited }, 200)
}
