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
 * Compte prudent renvoyé quand la lecture échoue. Voir le fail-safe plus bas.
 */
const PRUDENT_COUNT_ON_READ_ERROR = 2

/**
 * Statut qui, à lui seul, coupe l'accès — MÊME LITTÉRAL que `SUSPENDED_STATUS`
 * de lib/auth-guard.ts.
 *
 * ⚠️ ÉGALITÉ STRICTE SUR 'suspended', JAMAIS `status !== 'active'`.
 *    Le CHECK `users_status_check` admet six valeurs (draft, active, in_review,
 *    suspended, rejected, archived) et `requireAuth` ne refuse que sur
 *    'suspended' (lib/auth-guard.ts, § ÉGALITÉ STRICTE). Écrire
 *    `status = 'active'` ici retirerait du compte :
 *      - l'admin d'une organisation TOUTE NEUVE — `handle_new_user` insère
 *        `status = 'draft'` ;
 *      - un compte 'in_review', valeur écrite par /api/profile à chaque
 *        soumission.
 *    L'organisation se retrouverait à 0 admin disponible et le garde-fou
 *    BLOQUERAIT une gestion de membres parfaitement légitime. Le compteur doit
 *    poser exactement la question du garde d'accès, ni plus ni moins.
 *
 * Le littéral est volontairement RECOPIÉ plutôt qu'importé : lib/auth-guard.ts
 * tire `NextRequest` et tout le contexte de requête, dont ce module pur n'a que
 * faire. La cohérence des deux n'est pas laissée à la vigilance — elle est
 * VÉRIFIÉE par scripts/diag-org-lockout.mjs, qui lit les deux fichiers.
 */
const SUSPENDED_STATUS = 'suspended'

/**
 * Nombre d'admins ACTIFS de l'org. Sert la garde anti lock-out (D3) : toute
 * opération qui ferait passer ce compte à 0 est refusée côté serveur.
 *
 * ═══ « ACTIF » = LA PERSONNE PEUT ENCORE ADMINISTRER, PAS « LA LIGNE DIT
 *     active » ══════════════════════════════════════════════════════════════
 *   Ce compteur ne regardait QUE `organization_members` : une ligne
 *   `role_in_org='admin', status='active'` était comptée même quand le COMPTE
 *   derrière ne pouvait plus se connecter.
 *
 *   Le cas qui casse : un compte purgé (RGPD) est anonymisé et banni ~100 ans
 *   par `purgeAccount` (lib/account-purge.ts) — mais sa ligne d'appartenance
 *   n'est PAS touchée, et ce n'est pas un oubli : l'historique d'interaction
 *   doit être préservé. Le compteur voyait donc 1 admin, `wouldRemoveLastAdmin`
 *   croyait l'organisation pourvue, et l'organisation se retrouvait SANS AUCUN
 *   administrateur joignable — incapable d'inviter ou de promouvoir depuis ses
 *   propres écrans, réparable seulement par le back-office. Un lock-out
 *   silencieux, produit par le garde-fou censé l'empêcher.
 *
 *   Trois états rendent un compte inapte à administrer, et ce sont EXACTEMENT
 *   ceux que `requireAuth` refuse (lib/auth-guard.ts) — le compteur ne s'invente
 *   pas de règle, il rejoue celle du garde d'accès :
 *     - `status = 'suspended'`          → 403 account_suspended ;
 *     - `deletion_scheduled_at NOT NULL`→ 403 account_deletion_scheduled, seule
 *                                         l'allowlist de réactivation passe ;
 *     - `anonymized_at NOT NULL`        → 403 account_anonymized, bloqué partout.
 *
 *   Le nom de la fonction ne change pas : il a toujours voulu dire « admins
 *   actifs ». C'est l'implémentation qui ne tenait pas la promesse.
 *
 * ═══ SENS DE VARIATION : LA GARDE NE PEUT QUE SE RENFORCER ═════════════════
 *   Le résultat corrigé est toujours ≤ l'ancien (on filtre un sur-ensemble).
 *   Aucune opération autrefois refusée ne devient permise : impossible qu'une
 *   régression de sécurité sorte d'ici. En revanche une organisation dont le
 *   dernier admin joignable est réellement seul verra désormais son
 *   rétrogradage refusé — c'est le comportement voulu, pas un effet de bord.
 *
 * ═══ DEUX REQUÊTES, ET C'EST DÉLIBÉRÉ ══════════════════════════════════════
 *   Une jointure PostgREST (`users!inner`) tiendrait en un aller-retour, mais
 *   `organization_members` porte DEUX clés étrangères vers `users`
 *   (`user_id` et `invited_by`) : l'embed serait ambigu et devrait être
 *   désambiguïsé par le nom de contrainte. Une erreur de syntaxe y retomberait
 *   sur le fail-safe — c'est-à-dire cesserait SILENCIEUSEMENT de garder. Deux
 *   requêtes triviales et lisibles valent mieux qu'une jointure élégante dont
 *   l'échec est muet. Le volume est borné : on ne lit que les admins d'UNE org.
 *
 * ═══ FAIL-SAFE INCHANGÉ ════════════════════════════════════════════════════
 *   En cas d'erreur de lecture, compte prudent (2) : on NE transforme PAS une
 *   panne de lecture en blocage d'opération légitime. Ce choix reste juste ici,
 *   car les trois appelants (changement de rôle, retrait de membre, départ
 *   volontaire) sont tous RÉVERSIBLES. Il diffère volontairement de
 *   `countOtherAvailablePlatformAdmins` (lib/admin/user-actions-guard.ts), qui
 *   renvoie `null` parce que l'un de SES appelants — la purge — est définitif.
 */
export async function countActiveAdmins(admin: SupabaseClient, orgId: string): Promise<number> {
  // 1. Les LIGNES d'appartenance : qui est admin de cette org, sur le papier ?
  const { data: rows, error: memberErr } = await admin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', orgId)
    .eq('role_in_org', 'admin')
    .eq('status', 'active')
  if (memberErr) {
    console.warn('[org-members] countActiveAdmins members error — garde prudente', memberErr.message)
    return PRUDENT_COUNT_ON_READ_ERROR
  }

  const userIds = [
    ...new Set((rows ?? []).map((r) => (r as { user_id: string | null }).user_id).filter(Boolean)),
  ] as string[]
  // Aucune ligne admin : la réponse est 0, et elle est certaine. Pas de seconde
  // requête, et surtout pas de repli prudent — ce n'est pas une panne.
  if (userIds.length === 0) return 0

  // 2. Les COMPTES : combien d'entre eux passent encore `requireAuth` ?
  //    `users.status` est NOT NULL (défaut 'active') : `neq` est sûr ici.
  const { count, error: userErr } = await admin
    .from('users')
    .select('id', { count: 'exact', head: true })
    .in('id', userIds)
    .neq('status', SUSPENDED_STATUS)
    .is('deletion_scheduled_at', null)
    .is('anonymized_at', null)
  if (userErr) {
    console.warn('[org-members] countActiveAdmins users error — garde prudente', userErr.message)
    return PRUDENT_COUNT_ON_READ_ERROR
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
