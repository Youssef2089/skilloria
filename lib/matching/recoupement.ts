// lib/matching/recoupement.ts
//
// LE RECOUPEMENT EN MÉMOIRE DU SENS EXPERT → ANNONCES (lot « critères des annonces », 03/10/2026, §D.39).
//
// Les critères MULTIVALUÉS de l'annonce (spécialités, séniorités) se recoupent en mémoire dans ce sens : ils vivent sur
// la ligne annonce, pas sur la ligne profil. Le prédicat vivait dans le corps de `run-for-expert.ts` ; il est sorti ICI
// pour être EXÉCUTÉ tel quel par `diag-specialites-recoupement` (la preuve que les spécialités filtrent dans les deux
// sens, avec un témoin écarté). Le sens annonce → experts pose la MÊME règle dans la requête du vivier (lib/matching/
// pool.ts, un `.or()`).
//
// LES SPÉCIALITÉS — LA MÊME RÈGLE DES DEUX CÔTÉS (décision de Youssef, relecture de l'ARRÊT 28) : un ensemble VIDE d'un
// côté OU de l'autre ne contraint pas la spécialité — l'annonce qui n'a que « Autre (préciser) » (et les annonces
// publiées avant que la spécialité devienne obligatoire), comme l'EXPERT dont la seule spécialité est « Autre » : l'IA
// juge sur le texte. Sinon, au moins une spécialité en commun. (Avant : seul le vide côté annonce était sans contrainte,
// et un expert « Autre » seul ne voyait que les annonces « Autre » seules.)
//
// LES SÉNIORITÉS : un ensemble vide côté annonce = aucune contrainte ; sinon l'expert en possède au moins une. (Les zones
// suivent une autre règle — une liste de pays vide ne retient personne, §D.38 — et se filtrent en SQL, pas ici.)
//
// Module PUR, sans import.

/** L'annonce exige-t-elle quelque chose que l'expert possède ? (vide côté annonce = aucune contrainte) */
export function recoupe(exigees: readonly string[] | null | undefined, possedees: ReadonlySet<string>): boolean {
  const e = exigees ?? []
  return e.length === 0 || e.some((x) => possedees.has(x))
}

/** Les spécialités de l'annonce et de l'expert sont-elles compatibles ? Vide d'un côté OU de l'autre = aucune contrainte. */
export function specialitesCompatibles(
  annonce: readonly string[] | null | undefined,
  expert: readonly string[] | null | undefined,
): boolean {
  const a = annonce ?? []
  const e = expert ?? []
  return a.length === 0 || e.length === 0 || a.some((x) => e.includes(x))
}

/** Une annonce est-elle retenue pour cet expert, sur les critères recoupés en mémoire (spécialités, séniorités) ? */
export function annonceRetenuePourExpert(
  annonce: { speciality_ids: readonly string[] | null; seniorities: readonly string[] | null },
  expert: { speciality_ids: readonly string[] | null; seniorities: readonly string[] | null },
): boolean {
  return (
    specialitesCompatibles(annonce.speciality_ids, expert.speciality_ids) &&
    recoupe(annonce.seniorities, new Set(expert.seniorities ?? []))
  )
}
