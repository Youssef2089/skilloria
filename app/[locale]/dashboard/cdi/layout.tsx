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
 * Les pages /mon-profil, /profil, /profil/valider conservent encore leur
 * shell inline custom (refacto différée — comme côté freelance, ces pages
 * sont trop volumineuses pour ce sprint). Le layout les détecte et les
 * laisse en pass-through pour éviter un double-shell empilé.
 *
 * CONFIRMATION SC7a : cdi/page.tsx ne contient PAS de PATCH /api/profile —
 * ce trigger vit uniquement dans profil/valider qui reste intact.
 */

const LEGACY_SHELL_ROUTES = [
  '/dashboard/cdi/mon-profil',
  '/dashboard/cdi/profil',
  '/dashboard/cdi/profil/valider',
] as const

export default function CdiLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isLegacy = LEGACY_SHELL_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'))
  if (isLegacy) return <>{children}</>
  return <DashboardShell side="cdi">{children}</DashboardShell>
}
