import type { CLES_DETAIL, TypeAction } from './actions'

/**
 * LA FORME DU DÉTAIL, DÉRIVÉE DE LA LISTE BLANCHE — `tsc` refuse une clé hors liste (§D.26).
 *
 * ═══ POURQUOI UN TYPE, ET PAS SEULEMENT LA BASE ═════════════════════════════
 *   La base refuse toute clé hors de la liste blanche (GL004) — mais au moment
 *   du GESTE, dans la même transaction que l'écriture métier : une clé oubliée
 *   fait échouer le geste lui-même, en production. Le compilateur le voit AVANT.
 *   `CLES_DETAIL` (lib/journal/actions.ts) est la liste ; `diag-grand-livre`
 *   prouve qu'elle est IDENTIQUE à la base, action par action. Ce type en tire la
 *   FORME : les chemins `avant.vie_annonce_jours`, `features[].value`,
 *   `champs[]` deviennent l'objet permis, clés optionnelles, et un littéral qui
 *   porte une clé de plus ne compile pas (vérification des propriétés en excès).
 *
 * ═══ CE QU'IL NE VOIT PAS, ET LE DIT ═══════════════════════════════════════
 *   · une clé construite par programme (`Object.fromEntries`, un spread) : le
 *     type est large, l'excès n'est pas vérifié — d'où la règle §E.38 (littéraux
 *     clé par clé) et le détecteur de `diag-grand-livre` ;
 *   · les VALEURS : un identifiant et un nom ont le même type. La liste blanche
 *     dit quelles clés, pas ce qu'on y met — le détecteur de données
 *     personnelles juge les valeurs.
 */

/** Une valeur de détail : un fait ou un identifiant. */
type Feuille = unknown

type SansTableau<S extends string> = S extends `${infer B}[]` ? B : S
/** La clé de tête d'un chemin : `avant.x` → `avant`, `champs[]` → `champs`, `f[].v` → `f`. */
type Tete<P extends string> = P extends `${infer H}.${string}` ? SansTableau<H> : SansTableau<P>
/** Ce qui suit la clé `K` : `avant.x` → `x` ; `f[].v` → `v`. */
type Suite<P extends string, K extends string> = P extends `${K}.${infer R}` ? R : P extends `${K}[].${infer R}` ? R : never

/** L'objet permis par un ensemble de chemins. */
export type FormeDetail<P extends string> = {
  [K in Tete<P>]?: [Suite<P, K>] extends [never]
    ? Feuille
    : FormeDetail<Suite<P, K>> | FormeDetail<Suite<P, K>>[] | null
}

/** Les chemins déclarés pour l'action `A`. */
export type CheminsDe<A extends TypeAction> = (typeof CLES_DETAIL)[A][number]

/** Le détail permis pour l'action `A` — la seule forme que `journaliser()` acceptera. */
export type DetailDe<A extends TypeAction> = FormeDetail<CheminsDe<A>>

/** Une branche du détail : `SousDetail<'reglage_modifie', 'avant'>` pour un `p_avant` passé à une RPC. */
export type SousDetail<A extends TypeAction, K extends string> = FormeDetail<Suite<CheminsDe<A>, K>>
