'use client'

import type { SectionKey } from '@/lib/section-visits'

/**
 * markSectionVisited — appelle POST /api/me/section-visit côté client
 * (Lot global C2).
 *
 * À appeler une fois au mount de la page de listing concernée
 * (cf. `useMarkSectionVisited`). NE PAS interrompre le rendu si l'appel
 * échoue (best-effort) — le badge restera juste ré-affiché à la prochaine
 * polling et un retry suivra.
 *
 * Note : on dispatche `skilloria:notif-bump` au succès pour forcer
 * `useNavBadges` à revalider IMMÉDIATEMENT (le badge passe à 0 sans attendre
 * le prochain poll 30s).
 */
export async function markSectionVisited(section: SectionKey): Promise<void> {
  try {
    const res = await fetch('/api/me/section-visit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ section }),
      credentials: 'same-origin',
    })
    if (!res.ok) return
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('skilloria:notif-bump'))
    }
  } catch {
    /* best-effort, silencieux */
  }
}
