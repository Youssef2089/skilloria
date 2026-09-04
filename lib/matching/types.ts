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

export type MatchingVerdict = {
  status: 'ok' | 'error' | 'empty_pool' | 'no_config'
  proposals: MatchProposal[]
  /** Notes de pilotage (journaux). Jamais affichées à un utilisateur. */
  notes: string
  /** Modèle de reranking effectivement appelé. */
  model: string | null
}
