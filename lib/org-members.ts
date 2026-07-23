import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * lib/org-members.ts — helpers serveur partagés par les routes « Membres &
 * invitations » (Lot B). Toute écriture sur organization_members /
 * organization_invitations passe par une route serveur (D2) ; ces helpers
 * centralisent les deux gardes réutilisées partout :
 *   - garde ADMIN ACTIF de l'org (miroir applicatif de is_active_admin_of_org),
 *   - garde ANTI LOCK-OUT (D3) : ne jamais retirer le dernier admin actif.
 * + le mapping org_type → (user_type, role d'inscription) pour l'invité sans
 *   compte (arbitrage A1).
 */

export const VALID_ORG_ROLES = ['admin', 'editor', 'viewer'] as const
export type OrgRole = (typeof VALID_ORG_ROLES)[number]

export function isValidOrgRole(v: unknown): v is OrgRole {
  return typeof v === 'string' && (VALID_ORG_ROLES as readonly string[]).includes(v)
}

/**
 * Mapping org_type → user_type BDD + `role` d'inscription (métadonnée signUp
 * lue par le trigger handle_new_user). Arbitrage A1 : l'invité sans compte
 * DÉRIVE son user_type de l'org, jamais 'client' par défaut.
 *   client  → user_type 'client'   (role signUp 'entreprise')
 *   cabinet → user_type 'cabinet'  (role signUp 'cabinet')
 *   esn     → user_type 'cabinet'  (même mapping que lib/entitlements)
 * `role` est le libellé front attendu par handle_new_user (CASE 'entreprise'
 * → client, 'cabinet' → cabinet).
 */
export function membershipIdentityForOrgType(orgType: string | null | undefined): {
  userType: 'client' | 'cabinet'
  signupRole: 'entreprise' | 'cabinet'
} {
  if (orgType === 'cabinet' || orgType === 'esn') {
    return { userType: 'cabinet', signupRole: 'cabinet' }
  }
  return { userType: 'client', signupRole: 'entreprise' }
}

/**
 * Nombre d'admins ACTIFS de l'org. Sert la garde anti lock-out (D3) : toute
 * opération qui ferait passer ce compte à 0 est refusée côté serveur.
 * Fail-safe : en cas d'erreur de lecture, on retourne un compte prudent (2)
 * pour NE PAS transformer une panne de lecture en blocage d'opération légitime
 * — la garde est un garde-fou, pas un point de défaillance.
 */
export async function countActiveAdmins(admin: SupabaseClient, orgId: string): Promise<number> {
  const { count, error } = await admin
    .from('organization_members')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('role_in_org', 'admin')
    .eq('status', 'active')
  if (error) {
    console.warn('[org-members] countActiveAdmins error — garde prudente', error.message)
    return 2
  }
  return count ?? 0
}

/**
 * `true` si retirer/rétrograder la ligne (targetUserId, targetRole) viderait le
 * dernier admin actif. On ne bloque QUE si la cible est elle-même un admin actif
 * ET qu'elle est la dernière. Le call-site aura déjà chargé la ligne cible.
 */
export function wouldRemoveLastAdmin(params: {
  targetIsActiveAdmin: boolean
  activeAdminCount: number
}): boolean {
  return params.targetIsActiveAdmin && params.activeAdminCount <= 1
}
