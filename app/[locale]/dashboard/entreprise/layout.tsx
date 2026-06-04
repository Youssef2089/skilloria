'use client'

import DashboardShell from '@/components/shell/DashboardShell'

/**
 * Sub-layout entreprise — mount le DashboardShell pleine largeur partagé.
 * Toutes les pages sous /dashboard/entreprise/* héritent automatiquement.
 */
export default function EntrepriseLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell side="entreprise">{children}</DashboardShell>
}
