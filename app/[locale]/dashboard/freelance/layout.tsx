'use client'

import { usePathname } from '@/i18n/navigation'
import DashboardShell from '@/components/shell/DashboardShell'

/**
 * Sub-layout freelance — Lot refonte UX.
 *
 * Mount DashboardShell pleine largeur pour les pages refactorisées.
 *
 * Seule /mon-profil conserve son shell inline custom (elle rend DashboardSidebar
 * elle-même) → pass-through pour éviter un double-shell empilé.
 *
 * CORRECTIF (bug parcours profil) : /profil (import CV) et /profil/valider
 * étaient ELLES AUSSI en pass-through alors qu'elles NE rendent PAS de shell
 * inline → elles s'affichaient nues (sans sidebar, sans navigation, sans bouton
 * Retour), enfermant l'utilisateur. Elles sont désormais enveloppées par le
 * DashboardShell partagé (comme toute page de détail : sidebar + topbar +
 * GlobalBackButton, dont les titres shell.page_titles.profil / profil_valider
 * étaient déjà prêts).
 *
 * Cette guard list est TEMPORAIRE — à supprimer dès que /mon-profil est
 * refactorisée pour utiliser les primitives partagées.
 */

const LEGACY_SHELL_ROUTES = [
  '/dashboard/freelance/mon-profil',
] as const

export default function FreelanceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isLegacy = LEGACY_SHELL_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'))
  // DeletionGate est monté au layout parent commun (/dashboard) → couverture
  // universelle, y compris ces routes legacy. Plus besoin ici (C3).
  if (isLegacy) return <>{children}</>
  return <DashboardShell side="freelance">{children}</DashboardShell>
}
