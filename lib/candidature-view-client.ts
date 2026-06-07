'use client'

import { useCallback } from 'react'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * useMarkCandidatureViewed — hook React pour POST /api/me/candidatures/[id]/view
 * (Lot bascule "badges par item consulté").
 *
 * OBLIGATOIRE de passer par `useSecureFetch` :
 *   - injecte `Authorization: Bearer <access_token>` requis par requireAuth
 *   - injecte `x-subdomain: <domain>` requis pour le tenant guard
 * Un fetch() direct renvoie 401 silencieux (cf. bug récent sur section-visit).
 *
 * Au succès, dispatch `skilloria:notif-bump` → useNavBadges.mutate() →
 * décrément INSTANTANÉ du badge sans attendre le poll 30s.
 *
 * Best-effort : un échec (offline, 401 transitoire…) ne bloque rien — le
 * badge restera ré-affiché à la prochaine polling. On `console.warn` pour
 * détectabilité.
 */
export function useMarkCandidatureViewed(): (candidatureId: string) => Promise<void> {
  const secureFetch = useSecureFetch()
  return useCallback(
    async (candidatureId: string) => {
      if (!candidatureId) return
      try {
        const res = await secureFetch(`/api/me/candidatures/${candidatureId}/view`, {
          method: 'POST',
        })
        if (!res.ok) {
          console.warn('[markCandidatureViewed] non-OK', { candidatureId, status: res.status })
          return
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('skilloria:notif-bump'))
        }
      } catch (err) {
        console.warn('[markCandidatureViewed] threw', { candidatureId, err })
      }
    },
    [secureFetch],
  )
}
