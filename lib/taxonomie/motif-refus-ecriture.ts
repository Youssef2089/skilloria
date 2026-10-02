// lib/taxonomie/motif-refus-ecriture.ts
//
// UN REFUS DE LA BASE SE DIT EN PHRASE, PAS EN MESSAGE DE POSTGRES (relecteur, mineur — lot alertes).
//
// LE DÉFAUT : `POST /api/admin/update-speciality` rendait `ecriture_refusee` avec `cause: <message brut de Postgres>`,
// et l'écran l'affichait entre guillemets à l'administrateur — un texte anglais de la base (« value too long for type
// character varying(50) »), dans un écran français, qui ne dit pas quoi corriger.
//
// LA RÈGLE : la route rend un MOTIF nommé, lu dans le code SQLSTATE (jamais dans le texte du message, qui change avec
// la langue et la version du serveur) ; chaque motif a sa phrase dans les quatre langues (admin_taxonomie) ; le message
// brut reste dans le journal du serveur, pour qui diagnostique.
//
// Module PUR, sans import : le diagnostic du lot l'exécute tel quel.

/** Les motifs d'un refus d'écriture de la base, chacun avec sa phrase à l'écran. */
export const MOTIFS_REFUS_ECRITURE = [
  'texte_trop_long',
  'valeur_obligatoire',
  'valeur_invalide',
  'regle_du_referentiel',
  'reference_absente',
  'refus_non_classe',
] as const

export type MotifRefusEcriture = (typeof MOTIFS_REFUS_ECRITURE)[number]

/**
 * Le motif d'un refus de la base (classe 22 « donnée » ou 23 « contrainte »), d'après son code SQLSTATE. Les refus déjà
 * nommés avant d'arriver ici (« Autre », slug pris) ne passent pas par cette fonction.
 */
export function motifDuRefus(codeSql: string | null | undefined): MotifRefusEcriture {
  switch (codeSql) {
    case '22001': // une chaîne dépasse la longueur de sa colonne
      return 'texte_trop_long'
    case '23502': // une valeur obligatoire manque
      return 'valeur_obligatoire'
    case '22P02': // une valeur qui n'a pas la forme de son type
    case '22003': // un nombre hors des bornes de son type
    case '22023': // un paramètre invalide
      return 'valeur_invalide'
    case '23514': // une règle de la base (contrainte de vérification ou garde)
      return 'regle_du_referentiel'
    case '23503': // une référence vers une ligne qui n'existe plus
      return 'reference_absente'
    default:
      return 'refus_non_classe'
  }
}
