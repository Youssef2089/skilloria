'use client'

/**
 * Hint local "matching récemment déclenché" (Lot UX refetch auto).
 *
 * Plusieurs actions côté client déclenchent un `runMatchingForExpert` côté
 * serveur via `after()` (~8-15s) :
 *   - approbation profil (PATCH /api/profile {visible:true} → auto-approve inline)
 *   - sortie DND (toggle Disponible / Open to work, ping /api/me/sync-matching)
 *   - sauvegarde profil quand l'expert est déjà approuvé+actif (re-PATCH)
 *
 * Tant que l'`after()` n'a pas fini, le feed `/api/me/missions` renvoie
 * encore l'ancien état (souvent vide). Sans signal côté client, l'utilisateur
 * verrait l'empty-state "Aucune mission ne correspond…" → impression trompeuse
 * que "rien ne se passe".
 *
 * Ce module pose/lit un timestamp en `sessionStorage` (clé scopée par user_id)
 * que les home dashboards utilisent pour :
 *   - afficher un état transitoire "Analyse en cours…"
 *   - accélérer le poll de useLiveResource (~3s au lieu de 30s)
 *   - revenir au comportement normal dès que des missions arrivent OU que la
 *     fenêtre (120s) est écoulée.
 *
 * Implémentation volontairement minimaliste : pas de provider React, pas de
 * subscription. Les composants lisent la valeur au render — c'est suffisant
 * car `useLiveResource` poll quand même (juste à un rythme dérivé du hint).
 */

const STORAGE_PREFIX = 'sk:matching:trigger:'

/** Fenêtre pendant laquelle on considère l'expert "en cours d'analyse" (ms). */
export const MATCHING_TRIGGER_WINDOW_MS = 120_000

/** Poll rapide pendant la fenêtre d'analyse (ms). */
export const MATCHING_TRIGGER_FAST_POLL_MS = 3_000

/** Poll normal hors fenêtre (ms). */
export const MATCHING_TRIGGER_NORMAL_POLL_MS = 30_000

/** Marque "matching vient d'être déclenché" pour cet utilisateur. */
export function markMatchingTriggered(userId: string): void {
  if (typeof window === 'undefined' || !userId) return
  try {
    window.sessionStorage.setItem(`${STORAGE_PREFIX}${userId}`, String(Date.now()))
  } catch {
    /* SSR-safe / privacy-mode noop */
  }
}

/** Retourne le timestamp ms du dernier déclenchement, ou null. */
export function readMatchingTrigger(userId: string | null | undefined): number | null {
  if (typeof window === 'undefined' || !userId) return null
  try {
    const raw = window.sessionStorage.getItem(`${STORAGE_PREFIX}${userId}`)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

/** Purge le hint (sortie de fenêtre / missions reçues). */
export function clearMatchingTrigger(userId: string | null | undefined): void {
  if (typeof window === 'undefined' || !userId) return
  try {
    window.sessionStorage.removeItem(`${STORAGE_PREFIX}${userId}`)
  } catch {
    /* noop */
  }
}

/**
 * Indique si on est dans la fenêtre d'analyse pour cet utilisateur.
 *
 * Combine 2 sources :
 *   - `verifiedAt`  : timestamp profile.verified_at (cas approbation)
 *   - `lastTriggerMs` (= readMatchingTrigger(userId)) : trigger client récent
 *
 * Retourne true si AU MOINS une est récente (< MATCHING_TRIGGER_WINDOW_MS).
 *
 * `now` est passé en paramètre pour faciliter le test et permettre une lecture
 * cohérente dans un render React (sans re-render à chaque tick d'horloge).
 */
export function isWithinMatchingWindow(args: {
  now: number
  verifiedAt?: string | null
  lastTriggerMs?: number | null
}): boolean {
  const { now, verifiedAt, lastTriggerMs } = args
  if (lastTriggerMs != null && now - lastTriggerMs < MATCHING_TRIGGER_WINDOW_MS) {
    return true
  }
  if (verifiedAt) {
    const t = Date.parse(verifiedAt)
    if (Number.isFinite(t) && now - t < MATCHING_TRIGGER_WINDOW_MS) {
      return true
    }
  }
  return false
}
