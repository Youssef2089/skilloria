/**
 * lib/match-freshness.ts — sémantique partagée du badge "Nouveau" sur les
 * missions/offres matchées (Lot F).
 *
 * Source unique : feed expert MissionCard + home mini MissionMiniCard.
 *
 * Délai d'expiration aligné sur le pattern LinkedIn/WTTJ : 48 h.
 * Centralisé ici pour qu'un ajustement (24h, 72h…) ne nécessite qu'une
 * seule modif. Ce n'est PAS une règle métier (le matching/scoring n'en
 * dépend pas) — purement UX.
 */

export const MATCH_NEW_BADGE_MAX_AGE_HOURS = 48

/**
 * Un match est "Nouveau" pour l'UX si :
 *   - status ∈ {pending, notified}  (l'expert n'a pas encore vu le détail)
 *   - ET il a été créé il y a < MATCH_NEW_BADGE_MAX_AGE_HOURS heures.
 *
 * Disparaît :
 *   - à l'ouverture du détail (status → viewed) — comportement existant
 *   - à l'expiration du délai (matched_at < now - 48h) — nouveau
 *   - à la dismiss (status → dismissed)
 *
 * Calculé au render. Le polling SWR 30s déclenche un re-render et donc
 * une réévaluation automatique → pas besoin de timer dédié.
 */
export function isMatchNew(matchStatus: string, matchedAtIso: string | null): boolean {
  if (matchStatus !== 'pending' && matchStatus !== 'notified') return false
  if (!matchedAtIso) return false
  const matchedTime = new Date(matchedAtIso).getTime()
  if (Number.isNaN(matchedTime)) return false
  const ageMs = Date.now() - matchedTime
  return ageMs < MATCH_NEW_BADGE_MAX_AGE_HOURS * 60 * 60 * 1000
}
