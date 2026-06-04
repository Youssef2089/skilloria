'use client'

import DashboardShell from '@/components/shell/DashboardShell'

/**
 * Sub-layout freelance — mount le DashboardShell pleine largeur partagé.
 * Toutes les pages sous /dashboard/freelance/* héritent automatiquement.
 */
export default function FreelanceLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell side="freelance">{children}</DashboardShell>
}
