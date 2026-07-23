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

/**
 * Codes de refus « ce compte ne peut pas rejoindre l'organisation cible ».
 * Règle projet (figée) : un compte est soit expert, soit entreprise, jamais les
 * deux ; et un compte entreprise appartient toujours à UNE seule organisation.
 */
export type JoinBlockReason =
  | 'email_is_expert_account'
  | 'email_is_admin_account'
  | 'email_already_in_organization'

/**
 * Détermine si un compte EXISTANT (userId) est inéligible pour rejoindre
 * `targetOrgId`. Retourne le code de refus, ou `null` si le compte peut
 * légitimement rejoindre (compte entreprise sans appartenance, ou déjà membre
 * actif de CETTE org — cas idempotent géré en amont par l'appelant).
 *
 * Filet serveur partagé par : POST invitations (au moment d'inviter), GET
 * resolve (affichage), POST accept (à l'acceptation — un compte a pu être créé
 * entre-temps). Fail-safe : erreur de lecture → null (on ne bloque pas sur une
 * panne ; les autres gardes restent en place).
 */
export async function joinBlockReason(
  admin: SupabaseClient,
  userId: string,
  targetOrgId: string,
): Promise<JoinBlockReason | null> {
  const { data: u, error } = await admin
    .from('users')
    .select('user_type')
    .eq('id', userId)
    .maybeSingle()
  if (error || !u) {
    console.warn('[org-members] joinBlockReason user read error — no block', error?.message)
    return null
  }
  const ut = (u.user_type as string | null) ?? null
  if (ut === 'expert_freelance' || ut === 'expert_cdi') return 'email_is_expert_account'
  if (ut === 'admin') return 'email_is_admin_account'

  // Compte entreprise (client/cabinet) : bloqué s'il est membre ACTIF d'une
  // AUTRE organisation. Membre actif de la cible → non bloqué (idempotent).
  const { data: memberships, error: mErr } = await admin
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userId)
    .eq('status', 'active')
  if (mErr) {
    console.warn('[org-members] joinBlockReason membership read error — no block', mErr.message)
    return null
  }
  const inAnotherOrg = (memberships ?? []).some(
    (m) => (m.organization_id as string) !== targetOrgId,
  )
  return inAnotherOrg ? 'email_already_in_organization' : null
}
