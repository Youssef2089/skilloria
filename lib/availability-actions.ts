'use client'


/**
 * Helper côté client pour basculer le statut d'écoute d'un expert (Lot A —
 * disponibilité "Ne pas déranger" complète). UNE seule source de vérité,
 * réutilisée par :
 *
 *   - Les toggles des home pages (AvailabilityToggle freelance / CdiStatusToggle).
 *   - Le bouton "Repasser À l'écoute" des empty-states DND (home Suggestions
 *     + page Offres, côté freelance ET CDI).
 *
 * Sémantique uniforme côté UI :
 *   listening=true  →  freelance: 'available'     | cdi: 'open_to_work'
 *   listening=false →  freelance: 'do_not_disturb' | cdi: 'employed'
 *
 *  (Les valeurs DB elles-mêmes restent inchangées — cf. lot 2.)
 *
 * La barrière serveur (matching + feed) reste appliquée par
 * [lib/matching/index.ts](./matching/index.ts) et
 * [app/api/me/missions/route.ts](../app/api/me/missions/route.ts).
 *
 * Effets de bord côté navigateur (DOM events) :
 *   1. `sk:availability-changed` → rafraîchit la pill topbar du DashboardShell.
 *   2. `skilloria:notif-bump` → déclenche `mutate()` sur tous les
 *      [useLiveResource](../hooks/useLiveResource.ts) actifs (ex.
 *      /api/me/missions sur home Suggestions + page Offres). C'est ainsi
 *      que les listes d'offres se vident OU se re-remplissent IMMÉDIATEMENT
 *      après la bascule, sans reload manuel.
 */

export type ExpertSide = 'freelance' | 'cdi'

// `setExpertListening` n'existe plus (audit du 30/09/2026, M8) : elle écrivait `profiles` depuis le
// navigateur, un droit retiré le 28/09/2026. Toute bascule passe par `basculerDisponibilite`
// (lib/profil/bascule-disponibilite.ts → POST /api/profile/disponibilite).

/**
 * Dispatch des deux events nécessaires pour propager l'instantané :
 *  - `sk:availability-changed` : DashboardShell topbar pill (lot 2).
 *  - `skilloria:notif-bump`    : useLiveResource → mutate() (lot A).
 *
 * Exposé séparément pour les call-sites qui font déjà leur propre UPDATE
 * (les handlers des toggles de home pages, qui gèrent l'UI optimiste +
 * rollback + toast eux-mêmes) — ils appellent juste `emitAvailabilityChanged()`
 * après succès.
 */
export function emitAvailabilityChanged(): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent('sk:availability-changed'))
    window.dispatchEvent(new CustomEvent('skilloria:notif-bump'))
  } catch {
    /* SSR-safe noop */
  }
}
