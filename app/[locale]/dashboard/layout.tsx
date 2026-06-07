import SessionHeartbeat from '@/components/SessionHeartbeat'
import { assertDashboardRoleGuard } from '@/lib/dashboard-routing-guard'

/**
 * Layout commun à TOUTES les routes /dashboard/*.
 *
 * Server component (Lot routing) : effectue la GARDE ROUTING serveur :
 *  - lit x-pathname (injecté par proxy.ts middleware)
 *  - parse le segment dashboard (freelance/cdi/entreprise/cabinet)
 *  - lit le ss_token cookie + résout users.user_type via service_role
 *  - si user_type ≠ segment attendu → redirect(dashboardUrlForUserType(userType))
 *  - sinon → pass-through (rendu normal)
 *
 * Garde non contournable côté client. Source unique de vérité du mapping
 * segment ↔ user_type : lib/auth-routing.ts (allowedUserTypesForDashboardSegment).
 *
 * SessionHeartbeat reste monté (client) : couvre la session unique 11F
 * pour TOUTES les pages dashboard (RLS direct, pas d'appel /api/* sinon).
 *
 * Pas de wrapper visuel — chaque sub-layout (freelance/cdi/entreprise) gère
 * son propre DashboardShell.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await assertDashboardRoleGuard()
  return (
    <>
      <SessionHeartbeat />
      {children}
    </>
  )
}
