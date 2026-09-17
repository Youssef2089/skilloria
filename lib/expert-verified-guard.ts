import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * lib/expert-verified-guard.ts — garde SERVEUR « profil expert approuvé »
 * (checklist #4 / #20), SCOPÉE à la collaboration / sous-traitance.
 *
 * ⚠️ Ne JAMAIS poser cette garde globalement sur la chaîne de publication : les
 * vraies organisations (client/cabinet/esn) n'ont AUCUN profil expert → elles
 * seraient bloquées à tort. On l'appelle uniquement :
 *   - dans ensure-org (création de l'org personnelle d'un expert), et
 *   - dans la chaîne de publication quand le type est 'sous_traitance'
 *     (donc quand la publication émane d'une org personnelle freelance).
 *
 * Un expert non approuvé ne doit pas pouvoir créer son org perso ni publier un
 * besoin — même en appelant les routes directement (le verrou UI seul ne suffit
 * pas). Code d'erreur exposé : `profile_not_verified`.
 */

export const PROFILE_NOT_VERIFIED_CODE = 'profile_not_verified'

/**
 * LE REFUS QUI NE MENT PAS. Rendu quand la vérification du profil n'a pas pu
 * être LUE : la garde reste fermée, mais l'utilisateur lit « nous n'avons pas
 * pu vérifier, réessayez » et non « votre profil n'est pas vérifié ». Un 503,
 * pas un 403 — c'est une panne de notre côté, pas un verdict sur lui.
 */
export const PROFILE_CHECK_UNAVAILABLE_CODE = 'profile_check_unavailable'

/**
 * Vrai si l'utilisateur a un profil expert en `verification_status='approved'`.
 * `false` si absent de profiles ou statut différent (draft/pending/rejected…).
 *
 * ⚠️ NE DISTINGUE PAS une erreur de lecture d'un refus — c'est
 *    `expertProfileGate` qui le fait. Cette fonction est conservée pour les
 *    appelants qui n'ont qu'un booléen à rendre, et elle DÉLÈGUE : une seule
 *    lecture, un seul raisonnement. Un appelant qui doit expliquer son refus
 *    à un utilisateur prend la porte à quatre états.
 */
export async function isExpertProfileApproved(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<boolean> {
  return (await expertProfileGate(supabaseAdmin, userId)) === 'approved'
}

/**
 * Variante à TROIS états, pour les surfaces appelées à la fois par un expert et
 * par une organisation.
 *
 * `isExpertProfileApproved` renvoie `false` pour qui n'a pas de ligne
 * `profiles` — donc pour tout compte entreprise. L'utiliser tel quel sur une
 * route partagée verrouillerait les organisations à tort (cf. l'avertissement
 * en tête de ce module). Ce prédicat distingue « pas un expert » de « expert
 * non approuvé », pour que l'appelant ne verrouille QUE le second.
 */
/**
 * QUATRE états, et le quatrième n'est pas un verdict.
 *
 *   `indisponible` dit « je n'ai pas pu lire », rien d'autre. Il existe parce
 *   que ce module écrasait l'erreur de lecture en `not_approved` : le refus
 *   était PRUDENT et JUSTE — on n'ouvre pas une porte qu'on ne sait pas
 *   vérifier — mais l'utilisateur lisait « votre profil n'est pas vérifié »
 *   alors que son profil l'était. **Le refus avait raison, le motif mentait.**
 *   Les deux se règlent séparément (§E.22).
 */
export type ExpertProfileGate = 'not_expert' | 'approved' | 'not_approved' | 'indisponible'

export async function expertProfileGate(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<ExpertProfileGate> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('verification_status')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    // La garde reste FERMÉE — on ne relâche rien sur une erreur de lecture —
    // mais elle ne se fait plus passer pour un verdict sur le profil.
    console.error('[expert-verified-guard] profile lookup failed', error.message)
    return 'indisponible'
  }
  const row = data as { verification_status: string | null } | null
  if (!row) return 'not_expert'
  return row.verification_status === 'approved' ? 'approved' : 'not_approved'
}
