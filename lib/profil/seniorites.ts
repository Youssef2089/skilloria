// lib/profil/seniorites.ts
//
// LES TRANCHES DE SÉNIORITÉ — UNE DÉFINITION, ET CHAQUE VALEUR DANS UNE SEULE TRANCHE
// (recette staging du 01/10/2026, point 13).
//
// LE DÉFAUT : le vérificateur écrivait « junior < 3 ; confirmed 3-6 ; senior 6-12 ;
// expert 12+ ». Les bornes se recouvraient : 6 ans était à la fois confirmé et senior,
// 12 ans à la fois senior et expert — et la fiche d'un expert à 12 ans portait les
// deux lectures. L'analyseur du CV, lui, donnait « 7 ans, entre confirmé et senior »
// comme exemple de charnière : une troisième lecture des mêmes bornes.
//
// LA RÈGLE : des intervalles SEMI-OUVERTS — la borne basse est comprise, la borne
// haute ne l'est pas. 3 ans est confirmé, 6 ans est senior, 12 ans est expert. Les
// textes envoyés aux modèles (vérificateur, deux analyseurs) sont TIRÉS d'ici :
// aucun ne recopie un chiffre.
//
// ⚠️ MODULE PUR : aucun import, aucun accès à la base — `diag-recette-s1` l'exécute.

export const SENIORITES = ['junior', 'confirmed', 'senior', 'expert'] as const
export type Seniorite = (typeof SENIORITES)[number]

/** `de` compris, `jusqua` exclu ; `null` = sans borne haute. */
export const TRANCHES_SENIORITE: ReadonlyArray<{ valeur: Seniorite; de: number; jusqua: number | null }> = [
  { valeur: 'junior', de: 0, jusqua: 3 },
  { valeur: 'confirmed', de: 3, jusqua: 6 },
  { valeur: 'senior', de: 6, jusqua: 12 },
  { valeur: 'expert', de: 12, jusqua: null },
]

/** La tranche d'un nombre d'années — exactement une, ou `null` pour une valeur illisible. */
export function trancheDesAnnees(annees: number | null | undefined): Seniorite | null {
  if (typeof annees !== 'number' || !Number.isFinite(annees) || annees < 0) return null
  const t = TRANCHES_SENIORITE.find((x) => annees >= x.de && (x.jusqua === null || annees < x.jusqua))
  return t ? t.valeur : null
}

/**
 * Les tranches dites à un modèle, en français (la langue des consignes). Une phrase
 * qui ne laisse aucune valeur entre deux tranches : « de 6 à moins de 12 ans ».
 */
export function tranchesPourConsigne(): string {
  return TRANCHES_SENIORITE.map((t) =>
    t.jusqua === null
      ? `${t.valeur} : ${t.de} ans et plus`
      : t.de === 0
        ? `${t.valeur} : moins de ${t.jusqua} ans`
        : `${t.valeur} : de ${t.de} à moins de ${t.jusqua} ans`,
  ).join(' ; ')
}
