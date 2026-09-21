/**
 * Types du moteur de mise en relation.
 *
 * CE QUI A DISPARU DE CE FICHIER, ET C'EST LE SUJET DU LOT
 *   `ProfileCandidate`, `PublicationForMatching`, `AiMatchProposal`,
 *   `MatchingConfig` : les types d'un moteur qui envoyait cent profils à un
 *   modèle de langage dans un seul prompt et lui demandait de choisir.
 *
 *   Il n'y a plus de prompt, plus de sélection, plus de plafond. Le reranker
 *   note chaque couple indépendamment ; ce qui reste à décrire est donc beaucoup
 *   plus court — et c'est le signe que le moteur a cessé de faire trop de choses.
 */

import type { RaisonIneligible } from './issue-de-recherche'
import type { ArretDeNotation } from './rerank'

export type MatchingLocale = 'fr' | 'en' | 'es' | 'de'

/**
 * Une proposition retenue par un run.
 *
 * Le score y figure parce que l'appelant est le moteur lui-même (routes de
 * publication, rattrapage) — il n'est JAMAIS projeté vers un client. Ce qui sort
 * vers l'expert est le palier, jamais le nombre.
 */
export type MatchProposal = {
  profile_id: string
  relevance_score: number
}

/**
 * POURQUOI UN RUN N'A RIEN PRODUIT — en VALEUR, et non dans une phrase.
 *
 * ⚠️ `status: 'empty_pool'` RECOUVRE DEUX FAITS OPPOSÉS : « cet expert n'était
 *    pas éligible, on n'a rien lancé » et « on a tout noté, rien ne sort ». Le
 *    premier est un empêchement, le second est un RÉSULTAT. Tant que la seule
 *    façon de les distinguer était de lire `notes` — dont le commentaire
 *    ci-dessous dit qu'elle ne s'affiche jamais — un écran ne pouvait pas dire
 *    la vérité sans lire du français au motif (§E.24).
 *
 * Absent = le run est allé au bout. C'est la seule lecture correcte de son
 * absence, et c'est pour cela qu'il n'a pas de valeur neutre (§E.27).
 */
export type Empechement =
  /** L'expert n'avait pas droit au moteur, et on le savait avant de le lancer. */
  | { quoi: 'ineligible'; raison: RaisonIneligible }
  /**
   * La notation ne s'est pas faite : interrupteur, clé, plafond.
   *
   * ⚠️ `aucun_document` est EXCLU PAR LE TYPE, et ce n'est pas une précaution
   *    de style. Un vivier vide est un RÉSULTAT — « aucune annonce ne vous
   *    correspond » est alors vrai. Le porter ici en ferait un empêchement,
   *    donc une panne annoncée à un expert dont tout va bien. L'exclusion
   *    tient sans discipline : elle est vérifiée à la compilation (§E.31).
   */
  | { quoi: 'arret_de_notation'; code: Exclude<ArretDeNotation, 'aucun_document'> }

export type MatchingVerdict = {
  status: 'ok' | 'error' | 'empty_pool' | 'no_config'
  proposals: MatchProposal[]
  /** Notes de pilotage (journaux). Jamais affichées à un utilisateur. */
  notes: string
  /** Modèle de reranking effectivement appelé. */
  model: string | null
  /** Renseigné UNIQUEMENT quand le run a été empêché. Voir `Empechement`. */
  empechement?: Empechement
}
