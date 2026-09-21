/**
 * lib/plafonds-liste.ts — UN PLAFOND MUET EST UN MENSONGE DIFFÉRÉ.
 *
 * ═══ LE DÉFAUT QU'ON FERME ════════════════════════════════════════════════
 *   Deux listes serveur portaient un `.limit()` que rien n'observait. Tant que
 *   le volume reste sous le plafond, il n'existe pas ; le jour où il passe
 *   dessus, la queue de liste disparaît et PERSONNE ne l'apprend. Ni
 *   l'utilisateur, dont la liste est incomplète sans qu'un seul écran le dise ;
 *   ni nous, parce qu'une requête tronquée réussit — elle rend simplement
 *   moins de lignes.
 *
 * ═══ POURQUOI DÉTECTER PLUTÔT QUE REPOUSSER ═══════════════════════════════
 *   Relever le plafond ne fait que déplacer la date. Le problème n'est pas sa
 *   VALEUR, c'est son SILENCE : à 2000 comme à 20 000, la troncature reste
 *   indétectable depuis le résultat. On lit donc UNE LIGNE DE PLUS que le
 *   plafond : si elle existe, il y a une suite, et on le dit. Le coût est
 *   d'une ligne, la certitude est totale.
 *
 * ═══ CE QUE ÇA NE FAIT PAS ════════════════════════════════════════════════
 *   Ni pagination, ni chargement progressif. Le plafond reste ; il cesse
 *   seulement de mentir.
 */

/**
 * Candidatures servies à une organisation, toutes annonces confondues.
 *
 * Tri : note décroissante puis date. Le bout qui tombe est donc celui des
 * MOINS BIEN NOTÉES — défendable pour une liste, contrairement à un tri
 * croissant qui aurait fait disparaître les meilleures.
 */
export const PLAFOND_CANDIDATURES_ORG = 2000

/**
 * Annonces servies à une organisation.
 *
 * Tri : `updated_at` décroissant. Le bout qui tombe est celui des annonces LES
 * PLUS ANCIENNEMENT touchées — le bon bout, vérifié : une organisation qui
 * dépasse le plafond garde ses annonces vivantes et perd les dormantes.
 */
export const PLAFOND_PUBLICATIONS_ORG = 500

/**
 * Les six plafonds qui étaient MUETS (trouvés par le balayage de
 * diag-plafonds-listes, 20/09/2026 ; sondés le 21/09) — tous coupent la QUEUE
 * de l’histoire, jamais sa tête : le tri qui précède chaque sonde est
 * descendant, et le contrôle le vérifie.
 */
/** Candidatures servies à un EXPERT (son suivi). Tri : `created_at` décroissant. */
export const PLAFOND_CANDIDATURES_EXPERT = 200
/** Conversations d’une boîte de réception (expert ou organisation). Tri : dernier message décroissant. */
export const PLAFOND_CONVERSATIONS = 200
/** Messages d’un fil. Les PLUS RÉCENTS sont gardés, puis rendus dans l’ordre chronologique. */
export const PLAFOND_MESSAGES = 500
/** Les trois listes de la fiche d’approbation d’un expert (back-office). */
export const PLAFOND_FICHE_EXPERT = { experiences: 20, educations: 10, languages: 15 } as const

export type Troncature = {
  /** Le plafond appliqué, pour que l'écran puisse le nommer. */
  plafond: number
  /** Vrai si des lignes existent au-delà et n'ont pas été servies. */
  atteint: boolean
}

/**
 * La limite à demander à la base : le plafond, PLUS UNE.
 *
 * Cette ligne supplémentaire n'est jamais servie. Elle ne sert qu'à répondre à
 * « y en avait-il d'autres ? », question à laquelle un résultat de exactement
 * `plafond` lignes ne peut pas répondre : il est aussi bien complet que tronqué.
 */
export function limiteSondee(plafond: number): number {
  return plafond + 1
}

/**
 * Coupe au plafond et DIT si quelque chose a été laissé de côté.
 *
 * Le journal est en `error` et non en `warn` : ce n'est pas une gêne passagère
 * mais un résultat incomplet servi à un utilisateur, et il doit ressortir des
 * journaux sans qu'on ait à le chercher.
 */
export function couperEtSignaler<T>(
  lignes: readonly T[],
  plafond: number,
  contexte: string,
): { lignes: T[]; troncature: Troncature } {
  if (lignes.length <= plafond) {
    return { lignes: [...lignes], troncature: { plafond, atteint: false } }
  }
  console.error('[plafond] LISTE TRONQUÉE — la suite n’est pas servie', { contexte, plafond })
  return { lignes: lignes.slice(0, plafond), troncature: { plafond, atteint: true } }
}
