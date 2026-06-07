'use client'

import { useCallback } from 'react'
import { useSecureFetch } from '@/lib/secure-fetch'
import type { SectionKey } from '@/lib/section-visits'

/**
 * useMarkSectionVisited — hook React pour POST /api/me/section-visit
 * (Lot global C2 + fix bug "table user_section_visits vide").
 *
 * Doit OBLIGATOIREMENT passer par `useSecureFetch` :
 *   - injecte `Authorization: Bearer <access_token>` requis par requireAuth
 *   - injecte `x-subdomain: <domain>` requis pour le tenant guard
 *
 * Un `fetch()` direct sans ces headers renvoyait 401 silencieux côté
 * requireAuth (bug initial : aucune ligne créée → badges bloqués). C'est
 * exactement la même mécanique que toutes les autres routes /api/me/*.
 *
 * À appeler une fois au mount de la page de listing concernée. Best-effort :
 * si l'appel échoue (offline, 401 transitoire…), le badge restera ré-affiché
 * à la prochaine polling — on log juste un warning pour qu'un futur bug soit
 * détectable.
 *
 * Au succès, dispatche `skilloria:notif-bump` → `useNavBadges.mutate()` →
 * badge passe à 0 immédiatement (sans attendre le poll 30s).
 */
export function useMarkSectionVisited(): (section: SectionKey) => Promise<void> {
  const secureFetch = useSecureFetch()
  return useCallback(
    async (section: SectionKey) => {
      try {
        const res = await secureFetch('/api/me/section-visit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ section }),
        })
        if (!res.ok) {
          // Log explicite — sans ça le bug initial était parfaitement
          // invisible (table vide, badge bloqué, zéro signal).
          console.warn('[markSectionVisited] non-OK', { section, status: res.status })
          return
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('skilloria:notif-bump'))
        }
      } catch (err) {
        console.warn('[markSectionVisited] threw', { section, err })
      }
    },
    [secureFetch],
  )
}
