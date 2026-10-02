// lib/criteres/communs.ts
//
// LES CRITÈRES COMMUNS — CE QU'UN EXPERT DÉCLARE ET CE QU'UNE ANNONCE DEMANDE, AVEC LES MÊMES VALEURS
// (lot « critères des annonces », 03/10/2026 — décision de Youssef, §D.39).
//
// LE DÉFAUT QUI L'A FAIT ÉCRIRE : le besoin de sous-traitance n'avait pas de spécialité ; le mode de travail était un
// choix UNIQUE sur l'annonce et MULTIPLE sur le profil ; chaque écran recopiait sa liste de valeurs (`WORK_MODE_VALUES`
// dans les deux écrans de validation, `WORK_MODE_CODES` dans l'annonce). Trois copies d'une même liste dérivent — et un
// critère que l'annonce demande dans un vocabulaire que l'expert ne peut pas déclarer ne se rencontre jamais.
//
// LA RÈGLE : un critère commun a UNE liste de valeurs, ici, que les quatre écrans (validation freelance, validation CDI,
// annonce d'organisation, besoin de sous-traitance) et les routes importent. Les contraintes de la base (profiles ET
// publications) portent la MÊME liste. `diag-criteres-communs` (BLOQUANT) rougit pour tout critère absent d'un écran,
// pour toute liste recopiée dans un écran, et pour toute contrainte de base qui ne dit pas la même liste.
//
// Module PUR, sans import : les contrôles l'exécutent tel quel.

/** Les niveaux d'expérience (contraintes `profiles_seniorities_check` et `publications_seniorities_check`). */
export const SENIORITES = ['junior', 'confirmed', 'senior', 'expert'] as const
export type Seniorite = (typeof SENIORITES)[number]

/**
 * Les modes de travail (contraintes `profiles_work_modes_valid` et `publications_work_modes_valid`). Choix MULTIPLES des
 * deux côtés. NE FILTRENT PAS la mise en relation (décision de septembre, rappelée le 03/10/2026).
 */
export const MODES_TRAVAIL = ['remote', 'onsite', 'hybrid'] as const
export type ModeTravail = (typeof MODES_TRAVAIL)[number]

/**
 * Temps plein ou temps partiel (contraintes `profiles_temps_travail_valid` et `publications_temps_travail_valid`). Un
 * champ À PART du mode de travail ; choix multiples des deux côtés (une annonce qui coche les deux accepte l'un ou
 * l'autre ; un expert aussi). NE FILTRE PAS la mise en relation (décision de Youssef, 03/10/2026).
 */
export const TEMPS_TRAVAIL = ['plein', 'partiel'] as const
export type TempsTravail = (typeof TEMPS_TRAVAIL)[number]

/** Les unités d'une durée de mission (contrainte `publications_duree_check`). Une offre CDI n'a PAS de durée. */
export const UNITES_DUREE = ['jours', 'semaines', 'mois', 'annees'] as const
export type UniteDuree = (typeof UNITES_DUREE)[number]

/** Une durée se dit en un nombre entier d'unités, de 1 à 999 (contrainte `publications_duree_check`). */
export const DUREE_MIN = 1
export const DUREE_MAX = 999

/**
 * La répartition d'un travail « Hybride » : des jours sur site et des jours en télétravail PAR SEMAINE. Chacun au moins
 * un jour (sinon ce n'est pas de l'hybride), et sept au plus à eux deux (contrainte `publications_repartition_hybride_check`).
 */
export const JOURS_PAR_SEMAINE = 7

/**
 * LE REGISTRE — les critères communs aux trois écrans (profil expert, annonce, besoin de sous-traitance), et d'où vient
 * leur liste de valeurs : une liste fermée de ce module, ou le RÉFÉRENTIEL (/api/taxonomy, le même pour tous).
 * `filtre` dit s'il sépare des experts dans la mise en relation (le moteur : lib/matching/pool.ts et run-for-expert.ts).
 */
export const CRITERES_COMMUNS = [
  { cle: 'branche', valeurs: 'referentiel', filtre: true },
  { cle: 'specialites', valeurs: 'referentiel', filtre: true },
  { cle: 'seniorites', valeurs: SENIORITES, filtre: true },
  { cle: 'zones', valeurs: 'referentiel', filtre: true },
  { cle: 'modes_travail', valeurs: MODES_TRAVAIL, filtre: false },
  { cle: 'temps_travail', valeurs: TEMPS_TRAVAIL, filtre: false },
] as const

export type CleCritere = (typeof CRITERES_COMMUNS)[number]['cle']

/** Une liste reçue, réduite aux valeurs connues, sans doublon, dans l'ordre de la liste fermée. */
export function valeursConnues<T extends string>(liste: readonly T[], recu: unknown): T[] {
  if (!Array.isArray(recu)) return []
  return liste.filter((v) => recu.includes(v))
}
