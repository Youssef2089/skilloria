'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * DeletionGate — monté dans les sub-layouts dashboard freelance/CDI.
 *
 * Mission S3 : si le compte est en « suppression programmée » (grâce), on ne
 * doit PAS ouvrir le dashboard normal. Ce gate interroge /api/me/account/status
 * (allowlistée dans auth-guard pendant la grâce) et redirige vers l'écran de
 * réactivation. Composant headless (rend null). Le serveur reste la barrière
 * non contournable (auth-guard 403) — ce gate n'est que le confort UX.
 */
export default function DeletionGate() {
  const secureFetch = useSecureFetch()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const res = await secureFetch('/api/me/account/status', { method: 'GET' })
        if (!res.ok || cancelled) return
        const d = (await res.json()) as { deletion_scheduled_at?: string | null; anonymized_at?: string | null }
        if (cancelled) return
        if (d.deletion_scheduled_at && !d.anonymized_at) {
          router.replace('/reactivation')
        }
      } catch {
        /* silencieux — le serveur reste la barrière */
      }
    }
    void check()
    return () => { cancelled = true }
  }, [pathname, secureFetch, router])

  return null
}
