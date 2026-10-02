// lib/matching/recoupement.ts
//
// LE RECOUPEMENT EN MÉMOIRE DU SENS EXPERT → ANNONCES (lot « critères des annonces », 03/10/2026, §D.39).
//
// Les critères MULTIVALUÉS de l'annonce (spécialités, séniorités) se recoupent en mémoire dans ce sens : ils vivent sur
// la ligne annonce, pas sur la ligne profil, et PostgREST ne sait pas comparer deux colonnes tableau entre elles dans un
// filtre. Le prédicat vivait dans le corps de `run-for-expert.ts` ; il est sorti ICI pour être EXÉCUTÉ tel quel par
// `diag-specialites-recoupement` (la preuve que les spécialités filtrent dans les deux sens, avec un témoin écarté).
//
// LA RÈGLE (inchangée) : un ensemble VIDE côté annonce = aucune contrainte sur cet axe — c'est le cas d'une annonce qui
// n'a que « Autre (préciser) », et des annonces publiées avant que la spécialité devienne obligatoire. Sinon, l'expert
// est retenu s'il possède AU MOINS UNE des valeurs exigées. (Les zones suivent une autre règle — une liste de pays vide
// ne retient personne, §D.38 — et se filtrent en SQL, pas ici.)
//
// Module PUR, sans import.

/** L'annonce exige-t-elle quelque chose que l'expert possède ? (vide côté annonce = aucune contrainte) */
export function recoupe(exigees: readonly string[] | null | undefined, possedees: ReadonlySet<string>): boolean {
  const e = exigees ?? []
  return e.length === 0 || e.some((x) => possedees.has(x))
}

/** Une annonce est-elle retenue pour cet expert, sur les critères recoupés en mémoire (spécialités, séniorités) ? */
export function annonceRetenuePourExpert(
  annonce: { speciality_ids: readonly string[] | null; seniorities: readonly string[] | null },
  expert: { speciality_ids: readonly string[] | null; seniorities: readonly string[] | null },
): boolean {
  return (
    recoupe(annonce.speciality_ids, new Set(expert.speciality_ids ?? [])) &&
    recoupe(annonce.seniorities, new Set(expert.seniorities ?? []))
  )
}
