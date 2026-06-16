'use client'

import { usePathname } from '@/i18n/navigation'
import DashboardShell from '@/components/shell/DashboardShell'
import DeletionGate from '@/components/DeletionGate'

/**
 * Sub-layout freelance — Lot refonte UX.
 *
 * Mount DashboardShell pleine largeur pour les pages refactorisées.
 *
 * Les pages /mon-profil, /profil, /profil/valider conservent encore leur
 * shell inline custom (refacto différée — ces pages ont 700-1500 lignes,
 * trop volumineuses pour ce sprint). Le layout détecte ces routes et les
 * laisse en pass-through pour éviter un double-shell empilé.
 *
 * Cette guard list est TEMPORAIRE — à supprimer dès que ces pages sont
 * refactorisées pour utiliser les primitives partagées.
 */

const LEGACY_SHELL_ROUTES = [
  '/dashboard/freelance/mon-profil',
  '/dashboard/freelance/profil',
  '/dashboard/freelance/profil/valider',
] as const

export default function FreelanceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isLegacy = LEGACY_SHELL_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'))
  if (isLegacy) return <><DeletionGate />{children}</>
  return <DashboardShell side="freelance"><DeletionGate />{children}</DashboardShell>
}
