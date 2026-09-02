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
//   • SPÉCIALITÉS et SÉNIORITÉS : facultatives, et un ensemble vide y signifie
//     « aucune contrainte sur cet axe », jamais « ne correspond à personne ».
//     Une annonce incomplètement remplie doit matcher LARGE, pas rien.
//
//   Si ces deux axes devaient devenir obligatoires, il faudrait les ajouter
//   ICI, dans la contrainte de base ET dans le repli de la migration — les
//   trois ensemble, jamais un seul.

export type PublicationPublishableInput = {
  title: string | null | undefined
  description: string | null | undefined
  branch_id: string | null | undefined
  work_zone_ids: readonly string[] | null | undefined
}

/** Clés traduites dans `publications.form.field_errors`. */
export const PUBLICATION_PUBLISHABLE_FIELDS = [
  'title',
  'description',
  'branch_id',
  'work_zone_ids',
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
  if ((input.work_zone_ids?.length ?? 0) === 0) manquants.push('work_zone_ids')
  return manquants
}

export const estPubliable = (input: PublicationPublishableInput): boolean =>
  missingForPublish(input).length === 0
