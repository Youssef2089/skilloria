/**
 * Mapping `users.user_type` → URL du dashboard correspondant.
 *
 * Source de vérité unique pour ce mapping. Utilisé par :
 *   - /connexion (post-login)
 *   - /auth/callback (post-confirm email)
 *
 * Toute évolution du routing user_type doit se faire ici uniquement.
 *
 * NB : `users.user_type` n'a PAS de valeur 'esn' — register-org mappe
 * `org_type='esn'` → `user_type='cabinet'` via metadataRoleFromOrgType
 * (cf. app/api/auth/register-org/route.ts).
 */

export const FALLBACK_DASHBOARD_URL = '/dashboard'

export function dashboardUrlForUserType(userType: string | null | undefined): string {
  switch (userType) {
    case 'expert_freelance':
      return '/dashboard/freelance'
    case 'expert_cdi':
      return '/dashboard/cdi'
    case 'client':
      return '/dashboard/entreprise'
    case 'cabinet':
      return '/dashboard/cabinet'
    case 'admin':
      return '/admin'
    default:
      return FALLBACK_DASHBOARD_URL
  }
}
