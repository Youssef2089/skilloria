/**
 * lib/interrupteurs.ts — UNE SEULE CONVENTION, ET ELLE ÉCHOUE FERMÉ.
 *
 * ═══ LE DÉFAUT QU'ON FERME ════════════════════════════════════════════════
 *   Trois interrupteurs, deux conventions opposées :
 *
 *     ENABLE_AI_CV_PARSING              !== 'true'   → échouait FERMÉ
 *     ENABLE_RERANKING                  === 'false'  → échouait OUVERT
 *     ENABLE_AI_CANDIDATURE_ASSESSMENT  === 'false'  → échouait OUVERT
 *
 *   Sur les deux derniers, `0`, `off`, `FALSE`, `flase` — n'importe quelle
 *   valeur autre que la chaîne exacte `false` — laissaient la fonction ACTIVE.
 *   Autrement dit : quelqu'un qui croit avoir coupé le reranking le laisse
 *   tourner, et DÉPENSER, sur une faute de frappe.
 *
 * ═══ LA RÈGLE ═════════════════════════════════════════════════════════════
 *   Une capacité est active si, et seulement si, sa variable vaut EXACTEMENT
 *   `'true'`. Tout le reste — absente, vide, `0`, `off`, `TRUE`, `tru` — la
 *   laisse ÉTEINTE.
 *
 *   Le sens de l'échec n'est pas symétrique : laisser une IA tourner par
 *   accident coûte de l'argent et envoie des données à un tiers ; la laisser
 *   éteinte par accident ne fait que priver d'une fonction, visiblement, et se
 *   corrige en une variable. Entre les deux, le choix n'est pas discutable.
 *
 *   ⚠️ CONSÉQUENCE ASSUMÉE : une capacité SANS variable définie est éteinte.
 *      Il faut donc déclarer `=true` en Preview comme en Production pour les
 *      activer. C'est le prix d'un interrupteur qui ne ment pas.
 */

/** Les capacités pilotées par interrupteur. Nommer ferme la liste. */
export type Capacite =
  | 'ENABLE_AI_CV_PARSING'
  | 'ENABLE_AI_CANDIDATURE_ASSESSMENT'
  | 'ENABLE_RERANKING'
  /**
   * Le parcours d'achat. Il appliquait DÉJÀ cette règle, mais dans sa propre
   * fonction (`billingEnabled`, lib/billing/config.ts) — deux écritures de la
   * même chose, à deux endroits.
   *
   * Aucune divergence de comportement à ce jour ; c'est justement pour cela
   * qu'il faut converger MAINTENANT. Deux implémentations identiques ne
   * divergent jamais le jour où on les écrit : elles divergent le jour où l'une
   * des deux est corrigée. `billingEnabled()` reste exporté et délègue ici —
   * ses appelants ne changent pas d'une ligne.
   */
  | 'ENABLE_BILLING'

/**
 * `true` seulement si la variable vaut EXACTEMENT `'true'`.
 *
 * Aucune tolérance — ni espaces, ni casse, ni synonymes. Accepter `'True'` ou
 * `' true '` rouvrirait la discussion à chaque valeur suivante (`'yes'` ?
 * `'1'` ?), et c'est cette discussion, pas la casse, qui a produit deux
 * conventions.
 */
export function capaciteActive(capacite: Capacite): boolean {
  return process.env[capacite] === 'true'
}
