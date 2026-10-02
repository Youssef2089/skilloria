// lib/criteres/specialites.ts
//
// LES SPÉCIALITÉS PROPOSÉES — la même liste sur les quatre écrans (lot « critères des annonces », 03/10/2026, §D.39).
//
// Le profil de l'expert (validation freelance et CDI), l'annonce d'une organisation et le besoin de sous-traitance
// proposent les spécialités de la BRANCHE choisie, telles que /api/taxonomy les sert (actives, traduites), plus l'option
// « Autre (préciser) » quand une branche est choisie (§D.40 — une sentinelle, jamais une ligne du référentiel). Chaque
// écran construisait sa liste lui-même ; le besoin de sous-traitance n'en avait pas. Une fonction, quatre appelants —
// `diag-criteres-communs` rougit si un écran construit la sienne.
//
// Module PUR (imports relatifs) : le contrôle l'exécute tel quel.

import { SPECIALITY_OTHER } from '../taxonomie/specialite-autre.ts'

export type SpecialiteDuReferentiel = { id: string; branch_id: string; name: string }

/** Les options du sélecteur de spécialités pour la branche choisie (aucune sans branche). */
export function optionsSpecialites(
  specialites: readonly SpecialiteDuReferentiel[],
  brancheId: string | null | undefined,
  libelleAutre: string,
): Array<{ value: string; label: string }> {
  if (!brancheId) return []
  return [
    ...specialites.filter((s) => s.branch_id === brancheId).map((s) => ({ value: s.id, label: s.name })),
    { value: SPECIALITY_OTHER, label: libelleAutre },
  ]
}

/** Les spécialités choisies qui restent valables après un changement de branche (« Autre » survit toujours). */
export function specialitesGardees(
  choisies: readonly string[],
  specialites: readonly SpecialiteDuReferentiel[],
  brancheId: string | null | undefined,
): string[] {
  return choisies.filter(
    (id) => id === SPECIALITY_OTHER || (!!brancheId && specialites.some((s) => s.id === id && s.branch_id === brancheId)),
  )
}
