'use client'

import DashboardShell from '@/components/shell/DashboardShell'
import PendingInvitationGate from '@/components/PendingInvitationGate'

/**
 * Sub-layout entreprise — mount le DashboardShell pleine largeur partagé.
 * Toutes les pages sous /dashboard/entreprise/* héritent automatiquement.
 *
 * PendingInvitationGate (Lot B, B3 cas 2) : détecte une invitation en attente
 * par email vérifié à la première session utile et propose l'acceptation en
 * overlay. Ne rend rien s'il n'y a pas d'invitation.
 */
export default function EntrepriseLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell side="entreprise">
      <PendingInvitationGate />
      {children}
    </DashboardShell>
  )
}
