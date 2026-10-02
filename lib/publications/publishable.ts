// lib/publications/publishable.ts
//
// CE QU'IL FAUT POUR QU'UNE ANNONCE SOIT PUBLIABLE — source UNIQUE.
//
// Pendant symétrique de lib/profile-visibility.ts, et pour la même raison : le
// prédicat vivait en double (contrainte `publications_publiee_requiert_zones_
// check` en base, garde de la route publish) et allait vivre en triple avec le
// formulaire. Deux copies dérivent, trois divergent.
//
// LA SÉMANTIQUE D'UN ENSEMBLE VIDE, qui n'est pas la même des deux côtés :
//   • ZONES DE TRAVAIL : obligatoires. Une annonce sans zone ne recouperait
//     AUCUN expert — `&&` sur un ensemble vide est toujours faux. Elle serait
//     publiée et silencieusement invisible, ce que ce lot supprime partout.
//   • SPÉCIALITÉS : OBLIGATOIRES depuis le 03/10/2026 (décision de Youssef, §D.39) — au moins une, sur l'annonce d'une
//     organisation comme sur le besoin de sous-traitance, avec les mêmes valeurs que l'expert : une du référentiel, ou
//     « Autre (préciser) » et sa précision (l'expert peut déclarer « Autre » seul : l'annonce aussi, §D.40). Une annonce
//     qui n'a que « Autre » ne restreint pas la spécialité dans la mise en relation (un ensemble d'identifiants vide n'y
//     contraint rien — c'est le cas des annonces publiées avant ce lot, qui restent lisibles).
//     La base ne le garantit PAS encore : le code en ligne publie sans spécialité, et la contrainte refuserait ce qu'il
//     écrit (§E.72) — elle part dans un lot suivant (dette §H, architecture).
//   • SÉNIORITÉS : facultatives — un ensemble vide y signifie « aucune contrainte sur cet axe ».
//   • RÉPARTITION HYBRIDE : exigée quand « Hybride » est coché (des jours sur site ET en télétravail par semaine).

export type PublicationPublishableInput = {
  title: string | null | undefined
  description: string | null | undefined
  branch_id: string | null | undefined
  speciality_ids: readonly string[] | null | undefined
  speciality_other: string | null | undefined
  work_zone_ids: readonly string[] | null | undefined
  work_modes: readonly string[] | null | undefined
  jours_sur_site: number | null | undefined
  jours_teletravail: number | null | undefined
}

/** Clés traduites dans `publications.form.field_errors` (et `criteres.champs` pour les nouvelles). */
export const PUBLICATION_PUBLISHABLE_FIELDS = [
  'title',
  'description',
  'branch_id',
  'speciality_ids',
  'work_zone_ids',
  'repartition_hybride',
] as const

export type PublicationPublishableField = (typeof PUBLICATION_PUBLISHABLE_FIELDS)[number]

/**
 * Le sous-ensemble que la contrainte base garantit aussi
 * (`publications_publiee_requiert_zones_check`).
 */
export const CHAMPS_AUSSI_GARANTIS_EN_BASE: readonly PublicationPublishableField[] = [
  'work_zone_ids',
]

export function missingForPublish(
  input: PublicationPublishableInput,
): PublicationPublishableField[] {
  const manquants: PublicationPublishableField[] = []
  if (!(input.title ?? '').trim()) manquants.push('title')
  if (!(input.description ?? '').trim()) manquants.push('description')
  if (!input.branch_id) manquants.push('branch_id')
  if ((input.speciality_ids?.length ?? 0) === 0 && !(input.speciality_other ?? '').trim()) manquants.push('speciality_ids')
  if ((input.work_zone_ids?.length ?? 0) === 0) manquants.push('work_zone_ids')
  if ((input.work_modes ?? []).includes('hybrid') && (input.jours_sur_site == null || input.jours_teletravail == null)) {
    manquants.push('repartition_hybride')
  }
  return manquants
}

export const estPubliable = (input: PublicationPublishableInput): boolean =>
  missingForPublish(input).length === 0
