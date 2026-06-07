/**
 * Mapping `users.user_type` → URL du dashboard correspondant.
 *
 * Source de vérité unique pour ce mapping. Utilisé par :
 *   - /connexion (post-login)
 *   - /auth/callback (post-confirm email)
 *
 * Toute évolution du routing user_type doit se faire ici uniquement.
 *
 * UNIFICATION DASHBOARD ORG (B3.5.fix) :
 *   Il n'existe qu'UN SEUL dashboard organisation (`/dashboard/entreprise`).
 *   Les 3 sous-types métier (client / esn / cabinet) y sont routés
 *   indifféremment. La différenciation future des fonctionnalités par
 *   org_type se fera DANS le composant OrganisationDashboard (qui reçoit
 *   `organization.org_type` en prop).
 *
 *   `users.user_type='cabinet'` (issu du mapping
 *   `org_type='esn'|'cabinet'` → `user_type='cabinet'` côté register-org)
 *   route donc lui aussi vers `/dashboard/entreprise`. La route
 *   `/dashboard/cabinet` reste exposée comme simple redirection (évite
 *   les 404 sur anciens bookmarks / liens).
 *
 *   TODO : `metadataRoleFromOrgType` dans register-org mappe encore
 *   `esn→cabinet` — sans conséquence routing désormais. À revoir si
 *   un autre call-site finit par dépendre de cette distinction.
 */

export const FALLBACK_DASHBOARD_URL = '/dashboard'

export function dashboardUrlForUserType(userType: string | null | undefined): string {
  switch (userType) {
    case 'expert_freelance':
      return '/dashboard/freelance'
    case 'expert_cdi':
      return '/dashboard/cdi'
    case 'client':
    case 'cabinet':
      // Un seul dashboard organisation — cf. B3.5.fix.
      return '/dashboard/entreprise'
    case 'admin':
      return '/admin'
    default:
      return FALLBACK_DASHBOARD_URL
  }
}

/**
 * Inverse de dashboardUrlForUserType : à partir d'un pathname `/dashboard/<seg>/...`,
 * retourne les user_type AUTORISÉS pour ce segment, ou `null` si le segment
 * n'est pas un dashboard role-specific (ex. `/dashboard/cabinet` = redirect).
 *
 * Utilisé par la garde routing serveur (app/[locale]/dashboard/layout.tsx).
 * Source unique de vérité — toute évolution du mapping segment↔user_type
 * passe ici.
 */
export function allowedUserTypesForDashboardSegment(
  segment: string | null | undefined,
): readonly string[] | null {
  switch (segment) {
    case 'freelance':
      return ['expert_freelance'] as const
    case 'cdi':
      return ['expert_cdi'] as const
    case 'entreprise':
      return ['client', 'cabinet'] as const
    case 'cabinet':
      // Page redirect (any role lands → redirige côté client vers /entreprise).
      // On laisse passer tous les rôles pour ne pas casser le redirect.
      return null
    default:
      return null
  }
}
