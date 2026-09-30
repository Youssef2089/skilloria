/**
 * lib/identite/verdict.ts — UNE REQUÊTE N'AGIT QUE SOUS LE COMPTE QUE L'ÉCRAN AFFICHE (§E.87, 30/09/2026).
 *
 * ═══ LE CAS MESURÉ ════════════════════════════════════════════════════════
 *   Sur staging, un compte d'essai freelance ouvert dans un onglet ; dans le MÊME navigateur, Youssef se
 *   connecte à l'admin avec son propre compte. La session Supabase du navigateur est UNE par adresse
 *   (stockage de l'origine, une clé par projet) et le cookie de session unique est posé sur le domaine
 *   parent : la dernière connexion gagne, pour TOUS les onglets. L'onglet du compte d'essai a continué
 *   d'afficher « Mehdi » dans son menu (lu une fois, au montage) pendant que chaque requête partait sous
 *   l'identité de l'admin : « Bonjour Youssef », « Mon profil » refusé (« réservée aux experts
 *   freelance » — vrai pour l'admin), le CV refusé (`wrong_user_type`), affiché « une erreur est survenue ».
 *   Entre deux experts, la même séquence aurait écrit dans le profil de l'AUTRE.
 *
 * ═══ LA RÈGLE ═════════════════════════════════════════════════════════════
 *   L'écran déclare le compte qu'il affiche (`x-compte-affiche`, posé par `useSecureFetch`) ; le serveur
 *   REFUSE une requête dont le jeton appartient à un autre compte (`compte_different`, 403) ; le navigateur
 *   se déconnecte proprement et le dit. Jamais un mélange : ni une requête d'un compte sous le menu d'un
 *   autre, ni un menu qui montre un compte qui n'agit plus.
 *
 * Module PUR, sans état : le client ET le serveur l'importent, le contrôle l'exécute.
 */

/** L'en-tête par lequel l'écran déclare le compte qu'il affiche. */
export const ENTETE_COMPTE_AFFICHE = 'x-compte-affiche'

/** Le code du refus — contrat avec l'écran de connexion et l'i18n. */
export const CODE_COMPTE_DIFFERENT = 'compte_different'

export type VerdictCompte =
  /** L'écran affiche le compte qui agit. */
  | 'meme'
  /** L'écran affiche un compte, un AUTRE agit (ou plus aucun) : refus. */
  | 'different'
  /** L'écran n'a encore rien affiché (premier chargement) : rien à comparer. */
  | 'inconnu'

/**
 * @param affiche le compte que l'écran affiche (celui qu'il a lu au montage)
 * @param agissant le compte du jeton — celui sous lequel la requête partirait
 */
export function verdictCompte(affiche: string | null | undefined, agissant: string | null | undefined): VerdictCompte {
  const a = (affiche ?? '').trim()
  if (!a) return 'inconnu'
  const b = (agissant ?? '').trim()
  if (!b) return 'different'
  return a === b ? 'meme' : 'different'
}
