// lib/taxonomie/specialite-seule.ts
//
// ÉTAIT-CE LA SEULE SPÉCIALITÉ DE L'EXPERT ? (lot zones de travail, 02/10/2026 — point 6)
//
// Aucune AUTRE spécialité ACTIVE dans le profil, et aucune précision « Autre » : exactement le critère « spécialité »
// de la publication (lib/profile-visibility.ts, contrainte `profiles_visible_requiert_criteres_check`). Quand c'est le
// cas, la notification de retrait dit que le profil ne peut plus être publié tant qu'il n'en a pas choisi une autre.
//
// Module PUR, sans import : `diag-lot-zones` l'exécute tel quel.

export function etaitLaSeule(
  specialiteRetiree: string,
  specialitesDuProfil: readonly string[] | null | undefined,
  precisionAutre: string | null | undefined,
  actives: ReadonlySet<string>,
): boolean {
  const autres = (specialitesDuProfil ?? []).filter((id) => id !== specialiteRetiree && actives.has(id))
  return autres.length === 0 && (precisionAutre ?? '').trim() === ''
}
