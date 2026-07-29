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
 * Vrai si l'utilisateur a un profil expert en `verification_status='approved'`.
 * `false` si absent de profiles ou statut différent (draft/pending/rejected…).
 */
export async function isExpertProfileApproved(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('verification_status')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    console.error('[expert-verified-guard] profile lookup failed', error.message)
    return false
  }
  return (data as { verification_status: string | null } | null)?.verification_status === 'approved'
}
