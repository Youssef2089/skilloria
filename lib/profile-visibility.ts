// lib/profile-visibility.ts
//
// CE QU'IL FAUT POUR QU'UN PROFIL SOIT VISIBLE — source UNIQUE.
//
// POURQUOI CE FICHIER EXISTE
//   Ce prédicat vivait en TROIS exemplaires : la contrainte
//   `profiles_visible_requiert_criteres_check` en base, la garde de
//   `PATCH /api/profile`, et `validateForPublish()` dans chacun des deux
//   formulaires. Trois copies du même test dérivent — c'est exactement ce qui a
//   fait échouer une migration, et c'est ce qui ferait dire à un écran « votre
//   profil est complet » pendant que le serveur le refuse.
//
//   Une seule écriture, trois lecteurs :
//     • la route, qui REFUSE (règle 20 : la barrière est au serveur) ;
//     • le formulaire, qui prévient AVANT l'envoi ;
//     • la bannière qui explique à un expert devenu invisible CE QUI LUI MANQUE.
//
//   Ce dernier point n'est pas cosmétique. La migration a rendu invisibles des
//   profils déjà publiés, sans prévenir personne : ces experts se connectent et
//   ne comprennent pas. La seule réparation possible est de leur dire
//   précisément quels champs manquent — pas « votre profil est incomplet ».
//
// LE RÉSUMÉ, ET POURQUOI 200 À 800
//   C'est le texte que le moteur de matching lit pour juger la pertinence. En
//   dessous de 200 caractères il n'y a pas matière à juger ; au-delà de 800 il
//   sort du document envoyé au moteur et n'est donc plus lu. Ces deux bornes ne
//   sont pas des préférences de rédaction, ce sont les limites de ce qui est
//   effectivement pris en compte — et c'est ce qu'il faut dire à l'expert.

export const RESUME_MIN = 200
export const RESUME_MAX = 800

export type ExpertKind = 'expert_freelance' | 'expert_cdi'

/** Ce que la vérification lit. Volontairement plat : un DTO, pas une ligne de base. */
export type ProfileVisibilityInput = {
  title: string | null | undefined
  summary: string | null | undefined
  skills: readonly string[] | null | undefined
  branch_id: string | null | undefined
  speciality_ids: readonly string[] | null | undefined
  seniorities: readonly string[] | null | undefined
  work_zone_ids: readonly string[] | null | undefined
  availability_status: string | null | undefined
  cdi_status: string | null | undefined
  experiences_count: number
  languages_count: number
  cv_parsing_status: string | null | undefined
  ai_consent_at: string | null | undefined
}

/**
 * Identifiants de champs manquants. Ce sont des CLÉS, pas des libellés : les
 * quatre langues les traduisent dans `profile_validation.field_errors`.
 */
export const PROFILE_VISIBILITY_FIELDS = [
  'title',
  'summary',
  'skills',
  'branch_id',
  'speciality_ids',
  'seniorities',
  'work_zone_ids',
  'availability',
  'experiences',
  'languages_structured',
  'cv_ready',
] as const

export type ProfileVisibilityField = (typeof PROFILE_VISIBILITY_FIELDS)[number]

/**
 * Le sous-ensemble que la CONTRAINTE BASE garantit aussi
 * (`profiles_visible_requiert_criteres_check`).
 *
 * Les autres ne sont exigés que par la route : la base ne peut pas joindre
 * `users.user_type` ni compter des lignes d'une autre table depuis un CHECK.
 * Cette liste existe pour que le diagnostic vérifie que ce fichier et la
 * migration parlent bien des mêmes champs — la dérive entre les deux est
 * précisément ce qui a coûté un push.
 */
export const CHAMPS_AUSSI_GARANTIS_EN_BASE: readonly ProfileVisibilityField[] = [
  'branch_id',
  'speciality_ids',
  'seniorities',
  'work_zone_ids',
  'availability',
  'summary',
]

const nonVide = (v: readonly string[] | null | undefined): boolean => (v?.length ?? 0) > 0

/**
 * Rend la liste ORDONNÉE des champs qui empêchent la visibilité. Vide = publiable.
 *
 * L'ordre suit celui du formulaire : c'est dans cet ordre que l'expert va les
 * corriger, et c'est dans cet ordre qu'on les lui présente.
 */
export function missingForVisibility(
  input: ProfileVisibilityInput,
  expertKind: ExpertKind,
): ProfileVisibilityField[] {
  const manquants: ProfileVisibilityField[] = []
  const resume = (input.summary ?? '').trim()

  if (!(input.title ?? '').trim()) manquants.push('title')
  if (resume.length < RESUME_MIN || resume.length > RESUME_MAX) manquants.push('summary')
  if ((input.skills?.length ?? 0) < 3) manquants.push('skills')
  if (!input.branch_id) manquants.push('branch_id')
  if (!nonVide(input.speciality_ids)) manquants.push('speciality_ids')
  if (!nonVide(input.seniorities)) manquants.push('seniorities')
  if (!nonVide(input.work_zone_ids)) manquants.push('work_zone_ids')

  // La disponibilité se déclare dans le champ propre au type d'expert. La
  // contrainte de base, elle, ne peut tester que « au moins l'un des deux » :
  // elle ne sait pas joindre users.user_type. C'est la route qui exige le bon.
  const dispo = expertKind === 'expert_cdi' ? input.cdi_status : input.availability_status
  if (!dispo) manquants.push('availability')

  if (input.experiences_count < 1) manquants.push('experiences')
  if (input.languages_count < 1) manquants.push('languages_structured')
  if (!(input.cv_parsing_status === 'done' && input.ai_consent_at != null)) manquants.push('cv_ready')

  return manquants
}

export const peutEtreVisible = (
  input: ProfileVisibilityInput,
  expertKind: ExpertKind,
): boolean => missingForVisibility(input, expertKind).length === 0
