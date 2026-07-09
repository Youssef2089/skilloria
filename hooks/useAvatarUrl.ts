'use client'

import { useEffect, useState } from 'react'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * useAvatarUrl — URL signée (300s) de la PROPRE photo de l'utilisateur courant.
 *
 * SEUL mécanisme d'obtention de la photo propre (M3 famille 1). Appelle
 * POST /api/me/avatar-url, qui ne signe QUE `auth.user.id` (jamais la photo
 * d'autrui). Re-signe au montage puis à chaque `sk:profile-changed` (émis par
 * AvatarUploadModal après un upload réussi) — c'est ce qui rafraîchit l'aperçu
 * post-upload sans lecture publique.
 *
 * Erreur / absence de photo -> url null : le composant Avatar affiche alors son
 * fallback initiales. NE PAS utiliser pour la photo d'un autre utilisateur
 * (org / admin / messagerie : déjà signée côté serveur dans les DTO).
 */
export function useAvatarUrl(): { url: string | null; loading: boolean } {
  const secureFetch = useSecureFetch()
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const res = await secureFetch('/api/me/avatar-url', { method: 'POST' })
        const data = (await res.json().catch(() => null)) as { url?: string | null } | null
        if (!cancelled) setUrl(res.ok ? data?.url ?? null : null)
      } catch {
        if (!cancelled) setUrl(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [secureFetch, tick])

  // Rafraîchit après un upload (AvatarUploadModal émet `sk:profile-changed`).
  useEffect(() => {
    const onChanged = () => setTick((t) => t + 1)
    window.addEventListener('sk:profile-changed', onChanged)
    return () => window.removeEventListener('sk:profile-changed', onChanged)
  }, [])

  return { url, loading }
}
