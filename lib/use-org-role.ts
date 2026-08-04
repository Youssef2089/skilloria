'use client'

import { useEffect, useState } from 'react'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * useOrgRole — rôle de l'utilisateur dans son organisation active, côté client
 * (C7). Sert au masquage PRÉVENTIF des actions (viewer = lecture seule) ; la
 * GARANTIE reste la garde serveur `requireOrgRole` (checklist #20).
 *
 * Cache module-level + déduplication de la requête en vol : de nombreuses cartes
 * candidat peuvent monter en même temps → une SEULE requête /api/me/org-role est
 * émise et partagée. Le rôle change rarement en session ; un rechargement de
 * page rafraîchit. `canManage` = editor OU admin (droit d'écriture org).
 */
export type OrgRole = 'viewer' | 'editor' | 'admin' | null

let cachedRole: OrgRole | undefined
let inflight: Promise<OrgRole> | null = null

export function useOrgRole(): { role: OrgRole; canManage: boolean; loading: boolean } {
  const secureFetch = useSecureFetch()
  const [role, setRole] = useState<OrgRole | undefined>(cachedRole)

  useEffect(() => {
    let active = true
    if (cachedRole !== undefined) {
      setRole(cachedRole)
      return
    }
    if (!inflight) {
      inflight = (async () => {
        try {
          const res = await secureFetch('/api/me/org-role', { method: 'GET' })
          if (!res.ok) return null
          const payload = (await res.json().catch(() => ({}))) as { role_in_org?: OrgRole }
          return payload.role_in_org ?? null
        } catch {
          return null
        }
      })().then((r) => {
        cachedRole = r
        inflight = null
        return r
      })
    }
    void inflight.then((r) => { if (active) setRole(r) })
    return () => { active = false }
  }, [secureFetch])

  // Tant que le rôle n'est pas connu, on N'AFFICHE PAS d'action write (défaut
  // prudent : pas de flash de boutons pour un viewer). loading distingue ce cas.
  const loading = role === undefined
  const canManage = role === 'editor' || role === 'admin'
  return { role: role ?? null, canManage, loading }
}
