'use client'

import { useEffect } from 'react'
import { useRouter } from '@/i18n/navigation'

/**
 * /dashboard/cabinet — REDIRECTION vers /dashboard/entreprise (B3.5.fix).
 *
 * Décision produit : un seul dashboard organisation pour les 3 sous-types
 * (client / esn / cabinet). Cf. lib/auth-routing.ts.
 *
 * Cette page est volontairement conservée (au lieu d'être supprimée) pour
 * que les anciens bookmarks et liens vers /dashboard/cabinet redirigent
 * proprement au lieu d'aboutir sur un 404.
 *
 * Locale préservée automatiquement par le router next-intl.
 * Pattern useEffect (router.replace pendant render = warning React).
 */
export default function DashboardCabinetRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/dashboard/entreprise')
  }, [router])

  return (
    <div
      style={{
        padding: 48,
        textAlign: 'center',
        fontFamily: 'Inter, system-ui, sans-serif',
        color: '#64748b',
      }}
    >
      …
    </div>
  )
}
