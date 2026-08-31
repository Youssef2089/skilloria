import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * lib/admin/user-actions-guard.ts — GARDES des actions d'administration de
 * comptes (suspension, révocation de session, changement de rôle en org).
 *
 * POURQUOI UN MODULE, ET PAS TROIS COPIES
 *   Trois routes appliquent les MÊMES interdits. Recopiées, elles auraient
 *   dérivé : c'est déjà l'histoire de `disclosurePolicyForCandidatureLifecycle`
 *   et de `deriveCandidatureLifecycle` sur ce projet. Une seule fonction, trois
 *   appelants, et un refus impossible à oublier.
 *
 * QUATRE INTERDITS, TOUS SERVEUR (point 20). L'UI peut griser un bouton ; elle
 * ne protège rien. Ces règles s'appliquent même à un appel forgé.
 *
 *   1. JAMAIS SUR SOI-MÊME. Un administrateur ne se suspend pas, ne se
 *      déconnecte pas et ne se rétrograde pas. Même esprit que la garde
 *      `self_forbidden` déjà en place sur les membres d'organisation.
 *   2. JAMAIS SUR UN AUTRE ADMINISTRATEUR. Un compte admin compromis se traite
 *      en base, pas via l'écran que ce compte pourrait lui-même détourner.
 *      Autoriser admin→admin, c'est offrir à un attaquant qui a pris un compte
 *      admin le moyen de neutraliser tous les autres avant qu'on réagisse.
 *   3. JAMAIS ZÉRO ADMINISTRATEUR PLATEFORME ACTIF. Symétrique de
 *      `countActiveAdmins` (lib/org-members.ts) transposé à la plateforme.
 *      En pratique la règle 2 la couvre déjà — elle reste en filet explicite,
 *      parce qu'un jour quelqu'un assouplira la règle 2.
 *   4. JAMAIS DE CONTOURNEMENT IMPLICITE de l'anti-lock-out d'organisation.
 *      Traité dans la route de rôle : la garde reste active par défaut et ne
 *      cède que sur un `force: true` explicite, que seule la modale envoie.
 *
 * LECTURE PURE : ce module ne modifie rien.
 */

export type AdminActionRefusal = {
  /** Code stable, rendu tel quel par le client. */
  code:
    | 'self_forbidden'
    | 'target_is_admin'
    | 'last_platform_admin'
    | 'target_not_found'
  /** Message technique (jamais affiché brut à l'utilisateur). */
  message: string
}

export type AdminActionTarget = {
  id: string
  user_type: string | null
  status: string | null
  domain_id: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
}

/**
 * Charge la cible d'une action d'administration. Renvoie `null` si elle
 * n'existe pas — l'appelant répond alors 404 sans distinguer « inexistant » de
 * « hors périmètre » (l'admin plateforme voit tous les écosystèmes, il n'y a
 * pas de fuite à craindre ici, mais la forme reste uniforme).
 */
export async function loadAdminActionTarget(
  supabaseAdmin: SupabaseClient,
  targetUserId: string,
): Promise<AdminActionTarget | null> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, user_type, status, domain_id, email, first_name, last_name')
    .eq('id', targetUserId)
    .maybeSingle()
  if (error) {
    console.error('[admin/user-actions-guard] target lookup failed', error.message)
    return null
  }
  return (data as AdminActionTarget | null) ?? null
}

/**
 * Applique les interdits 1 à 3. Renvoie `null` si l'action est permise, sinon
 * le refus à traduire en réponse HTTP.
 *
 * `countActivePlatformAdmins` n'est appelé QUE si la cible est elle-même
 * administratrice — ce qui, avec l'interdit 2, n'arrive jamais en V1. On évite
 * ainsi une requête de comptage sur chaque action.
 */
export async function refuseAdminActionOnTarget(args: {
  supabaseAdmin: SupabaseClient
  adminUserId: string
  target: AdminActionTarget | null
}): Promise<AdminActionRefusal | null> {
  const { supabaseAdmin, adminUserId, target } = args

  if (!target) {
    return { code: 'target_not_found', message: 'Target user not found' }
  }
  if (target.id === adminUserId) {
    return { code: 'self_forbidden', message: 'An administrator cannot act on their own account' }
  }
  if (target.user_type === 'admin') {
    // Interdit 2 — et l'interdit 3 par voie de conséquence.
    return { code: 'target_is_admin', message: 'Acting on another administrator is not allowed' }
  }

  // Interdit 3, filet explicite. Inatteignable tant que l'interdit 2 tient ;
  // il tiendra le jour où quelqu'un l'assouplira sans y penser.
  if (target.user_type === 'admin') {
    const remaining = await countActivePlatformAdmins(supabaseAdmin, target.id)
    if (remaining < 1) {
      return {
        code: 'last_platform_admin',
        message: 'Refusing to leave the platform without an active administrator',
      }
    }
  }

  return null
}

/**
 * Nombre d'administrateurs plateforme ACTIFS, en excluant `excludeUserId`.
 *
 * Fail-safe identique à `countActiveAdmins` (lib/org-members.ts) : en cas
 * d'erreur de lecture on renvoie un compte PRUDENT (2), pour ne pas
 * transformer une panne de lecture en blocage d'une opération légitime. Une
 * garde est un garde-fou, pas un point de défaillance.
 */
export async function countActivePlatformAdmins(
  supabaseAdmin: SupabaseClient,
  excludeUserId: string,
): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('user_type', 'admin')
    .eq('status', 'active')
    .neq('id', excludeUserId)
  if (error) {
    console.warn('[admin/user-actions-guard] countActivePlatformAdmins error — garde prudente', error.message)
    return 2
  }
  return count ?? 0
}

/** Statut HTTP à renvoyer pour un refus donné. */
export function refusalHttpStatus(refusal: AdminActionRefusal): number {
  return refusal.code === 'target_not_found' ? 404 : 403
}
