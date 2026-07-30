'use client'

import { usePathname } from '@/i18n/navigation'
import DashboardShell from '@/components/shell/DashboardShell'

/**
 * Sub-layout CDI — Lot UX Finitions 2 SC7a.
 *
 * Mount DashboardShell side='cdi' pleine largeur, miroir exact du sub-layout
 * freelance. Le shell inline qui vivait dans cdi/page.tsx (1181 lignes) a été
 * retiré (cf. SC7a) et toutes les pages CDI utilisent désormais le shell
 * partagé via ce layout.
 *
 * Seule /mon-profil conserve son shell inline custom (elle rend DashboardSidebar
 * elle-même) → pass-through pour éviter un double-shell empilé.
 *
 * CORRECTIF (bug parcours profil), miroir exact du sub-layout freelance :
 * /profil (import CV) et /profil/valider ne rendent PAS de shell inline et
 * s'affichaient nues → elles sont désormais enveloppées par le DashboardShell
 * partagé (sidebar + topbar + GlobalBackButton).
 *
 * CONFIRMATION SC7a : cdi/page.tsx ne contient PAS de PATCH /api/profile —
 * ce trigger vit uniquement dans profil/valider qui reste intact.
 */

const LEGACY_SHELL_ROUTES = [
  '/dashboard/cdi/mon-profil',
] as const

export default function CdiLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isLegacy = LEGACY_SHELL_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'))
  // DeletionGate est monté au layout parent commun (/dashboard) → couverture
  // universelle, y compris ces routes legacy. Plus besoin ici (C3).
  if (isLegacy) return <>{children}</>
  return <DashboardShell side="cdi">{children}</DashboardShell>
}
