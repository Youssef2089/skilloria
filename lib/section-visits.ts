/**
 * lib/section-visits.ts — sections couvertes par la mécanique "dernière visite"
 * (Lot global C2). UNE seule source pour : les clés acceptées par
 * `POST /api/me/section-visit`, les compteurs renvoyés par
 * `GET /api/me/badges`, et les call-sites client (`useNavBadges` +
 * `markSectionVisited`).
 *
 * Sections COUVERTES par le mécanisme (badge = items nouveaux depuis dernière
 * visite ; ouverture met à jour la visite et purge le badge) :
 *   - 'missions'             — feed expert : matches CRÉÉS depuis visite.
 *   - 'candidatures_expert'  — listing expert : candidatures dont status
 *                              flipped depuis visite (unlock/select/reject).
 *   - 'candidatures_org'     — listing org : nouvelles candidatures REÇUES
 *                              sur les pubs de l'org depuis visite.
 *   - 'annonces_org'         — listing org : nouvelles candidatures REÇUES
 *                              sur les pubs de l'org depuis visite (alias
 *                              de candidatures_org pour V1 — l'home org est
 *                              la même surface que /candidatures).
 *
 * Sections VOLONTAIREMENT HORS du mécanisme (cf. arbitrage user) :
 *   - 'messages_*'  → garde la sémantique unread par CONVERSATION via
 *                      /api/me/conversations. NE PAS basculer sur
 *                      last_visited (perdrait le grain conversation).
 *   - cloche 🔔     → garde la sémantique notifications non-lues.
 */

export const SECTION_KEYS = [
  'missions',
  'candidatures_expert',
  'candidatures_org',
  'annonces_org',
] as const

export type SectionKey = (typeof SECTION_KEYS)[number]

export function isSectionKey(value: unknown): value is SectionKey {
  return typeof value === 'string' && (SECTION_KEYS as readonly string[]).includes(value)
}
