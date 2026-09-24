import { randomUUID } from 'node:crypto'

/**
 * LA PIÈCE — le numéro qui relie toutes les écritures d'un même geste (§D.26).
 *
 * ═══ UNE PAR GESTE, CRÉÉE À L'ENTRÉE, TRANSMISE EXPLICITEMENT ══════════════
 *   Un expert postule = candidature + note + dépense + notification + e-mail :
 *   MÊME pièce. Elle naît à l'entrée de la route (avant toute écriture) et
 *   voyage en PARAMÈTRE — jamais dans un contexte ambiant. Un
 *   `AsyncLocalStorage` aurait l'air commode et perdrait la pièce au premier
 *   `after()`, au premier `setTimeout`, au premier appel qui change de
 *   contexte — sans erreur, en silence. Un paramètre obligatoire ne se perd
 *   pas : le compilateur nomme l'appel qui l'oublie.
 *
 *   À travers `after()`, la pièce est capturée par la fermeture, comme
 *   n'importe quelle valeur : c'est ce que « transmise explicitement » veut
 *   dire — rien d'autre ne survit à la réponse (§E.5).
 *
 * ═══ GÉNÉRABLE DES DEUX CÔTÉS ═══════════════════════════════════════════════
 *   Ici, `randomUUID()`. En SQL, `gen_random_uuid()` — une tâche pg_cron qui
 *   ne passe par aucune route génère la sienne (`effacer_adresses_ip()`), et
 *   une tâche qui appelle une route la lui TRANSMET dans le corps HTTP
 *   (étape 3). Même forme, même unicité, aucune coordination.
 *
 * Le type est MARQUÉ : une chaîne quelconque n'est pas une pièce. Une pièce
 * reçue de l'extérieur (corps HTTP, rejeu) passe par `estPiece()`.
 */
declare const marquePiece: unique symbol
export type Piece = string & { readonly [marquePiece]: true }

const FORME_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Une pièce neuve — à l'ENTRÉE du geste, avant toute écriture. */
export function nouvellePiece(): Piece {
  return randomUUID() as Piece
}

/** Une pièce reçue (corps HTTP d'une tâche, rejeu) : acceptée si elle a la forme, refusée sinon. */
export function estPiece(x: unknown): x is Piece {
  return typeof x === 'string' && FORME_UUID.test(x)
}
