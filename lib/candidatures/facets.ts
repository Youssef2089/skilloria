// lib/candidatures/facets.ts
//
// FACETTES DE CANDIDATURE — le découpage FIN d'un bucket, dérivé serveur.
//
// POURQUOI CE MODULE
//   Les deux listes de candidatures n'offraient que « Actives » / « Archivées ».
//   C'est insuffisant en soi : une organisation qui reçoit trente candidatures
//   doit pouvoir isoler celles qu'elle n'a pas encore traitées sans faire
//   défiler les échanges en cours et les candidats retenus. Les tuiles chiffrées
//   des accueils n'ont fait que révéler ce manque — elles comptaient des
//   sous-ensembles qu'aucun filtre ne savait afficher.
//
// UNE FACETTE EST UNE RAISON, PAS UN STATUT
//   `candidatures.status` est la MÉCANIQUE ; `lifecycle.reason` est le FAIT
//   (cf. lib/candidatures/lifecycle.ts). Compter sur l'un et filtrer sur
//   l'autre, c'est la divergence compteur/liste déjà rencontrée trois fois sur
//   ce projet. Les facettes se dérivent donc EXCLUSIVEMENT de `reason` :
//   compteur et liste appliquent littéralement le même prédicat sur le même
//   tableau, dans la même requête.
//
// PARTITION COMPLÈTE, PAS UNE SÉLECTION
//   Les 9 raisons sont couvertes sans reste et sans recouvrement : toute
//   candidature appartient à EXACTEMENT une facette, et la somme des facettes
//   d'un bucket est le compte du bucket. C'est cette propriété qui rend
//   l'égalité « chiffre affiché = nombre de lignes » démontrable plutôt que
//   surveillée. `assertFacetPartition` la vérifie en développement.
//
// DEUX REGROUPEMENTS, ASSUMÉS
//   - `publication_ended` réunit `publication_expired` et `publication_closed`.
//     Pour qui FILTRE une liste, c'est le même fait : l'annonce n'est plus
//     ouverte. La nuance (« expirée » vs « retirée ») reste lisible sur CHAQUE
//     LIGNE via `lifecycle.reason`, là où elle a un sens.
//   - `withdrawn` réunit `withdrawn` et `archived`, deux raisons vestigiales
//     que le produit n'écrit jamais (cf. lifecycle.ts). Une chip par nuance
//     morte aurait donné deux zéros permanents.
//
// LECTURE PURE : aucune écriture, aucun batch, aucune migration.

import type {
  CandidatureBucket,
  CandidatureLifecycle,
  CandidatureLifecycleReason,
} from '@/lib/candidatures/lifecycle'

export type CandidatureFacet =
  // ── bucket 'active' ───────────────────────────────────────────────────
  /** Déposée, annonce encore ouverte, pas encore débloquée. */
  | 'awaiting_review'
  /** Fenêtre d'échange de 15 j encore ouverte. */
  | 'exchange_open'
  /** Candidat retenu. */
  | 'selected'
  // ── bucket 'archived' ─────────────────────────────────────────────────
  /** Refus explicite de l'entreprise. */
  | 'rejected'
  /** Échange ouvert puis refermé sans sélection. */
  | 'exchange_expired'
  /** L'annonce n'est plus ouverte : expirée à 30 j OU retirée par l'org. */
  | 'publication_ended'
  /** Retrait du candidat / archivage explicite (raisons vestigiales). */
  | 'withdrawn'

/** Bucket auquel appartient chaque facette. Une facette n'en a qu'un. */
export const FACET_BUCKET: Readonly<Record<CandidatureFacet, CandidatureBucket>> = Object.freeze({
  awaiting_review: 'active',
  exchange_open: 'active',
  selected: 'active',
  rejected: 'archived',
  exchange_expired: 'archived',
  publication_ended: 'archived',
  withdrawn: 'archived',
})

/**
 * Facettes proposées par bucket, DANS L'ORDRE D'AFFICHAGE des chips.
 * Ordre choisi : ce qui appelle une action d'abord, ce qui est clos ensuite.
 */
export const FACETS_BY_BUCKET: Readonly<Record<CandidatureBucket, readonly CandidatureFacet[]>> =
  Object.freeze({
    active: ['awaiting_review', 'exchange_open', 'selected'] as const,
    archived: ['rejected', 'exchange_expired', 'publication_ended', 'withdrawn'] as const,
  })

export const ALL_FACETS: readonly CandidatureFacet[] = [
  ...FACETS_BY_BUCKET.active,
  ...FACETS_BY_BUCKET.archived,
]

/**
 * Facettes que le produit ne PEUT PAS alimenter aujourd'hui.
 *
 * `withdrawn` regroupe les statuts 'withdrawn' et 'archived', que rien n'écrit
 * (cf. « STATUTS VESTIGIAUX » dans lifecycle.ts) — et que /api/me/candidatures
 * exclut en plus explicitement côté expert. Une chip permanente à zéro est
 * exactement le compteur mort qu'on vient de retirer ailleurs : elle n'est donc
 * affichée QUE si le serveur en compte au moins une (lignes historiques), ou si
 * elle est le filtre courant — sans quoi on ne pourrait plus la quitter.
 *
 * La facette reste dans la PARTITION : une ligne historique doit tomber dans
 * une case honnête et être comptée dans son bucket. On ne masque que la chip.
 */
export const VESTIGIAL_FACETS: readonly CandidatureFacet[] = ['withdrawn']

export function isVestigialFacet(facet: CandidatureFacet): boolean {
  return (VESTIGIAL_FACETS as readonly string[]).includes(facet)
}

/** Raison dérivée → facette. SEUL endroit où la correspondance est écrite. */
export function facetForReason(reason: CandidatureLifecycleReason): CandidatureFacet {
  switch (reason) {
    case 'awaiting_review':
      return 'awaiting_review'
    case 'exchange_open':
      return 'exchange_open'
    case 'selected':
      return 'selected'
    case 'rejected':
      return 'rejected'
    case 'exchange_expired':
      return 'exchange_expired'
    case 'publication_expired':
    case 'publication_closed':
      return 'publication_ended'
    case 'withdrawn':
    case 'archived':
      return 'withdrawn'
  }
}

export function facetForLifecycle(lifecycle: CandidatureLifecycle): CandidatureFacet {
  return facetForReason(lifecycle.reason)
}

export type CandidatureFacetCounts = Record<CandidatureFacet, number>

export function emptyFacetCounts(): CandidatureFacetCounts {
  return {
    awaiting_review: 0,
    exchange_open: 0,
    selected: 0,
    rejected: 0,
    exchange_expired: 0,
    publication_ended: 0,
    withdrawn: 0,
  }
}

/**
 * Compte les facettes d'un lot déjà dérivé. À appeler sur la TOTALITÉ (avant
 * tout filtrage) : les chips doivent annoncer ce que leur clic va afficher,
 * y compris pour la facette qu'on ne regarde pas.
 */
export function countFacets(
  list: readonly { lifecycle: CandidatureLifecycle | null }[],
): CandidatureFacetCounts {
  const counts = emptyFacetCounts()
  for (const item of list) {
    if (!item.lifecycle) continue
    counts[facetForLifecycle(item.lifecycle)]++
  }
  return counts
}

/**
 * Normalise `?facet=`. `null` = pas de filtrage par facette (bucket entier).
 *
 * COHÉRENCE AVEC LE BUCKET : une facette qui n'appartient pas au bucket demandé
 * est IGNORÉE, pas appliquée. Sans cela, `?filter=active&facet=rejected`
 * renverrait une liste vide sans que rien ne l'explique — un écran mort produit
 * par une URL contradictoire. On sert le bucket demandé, les chips montrent
 * alors ce qui existe réellement.
 *
 * `bucket` à `null` (`?filter=all`) accepte n'importe quelle facette : la
 * facette porte elle-même son bucket.
 */
export function parseFacetFilter(
  raw: string | null | undefined,
  bucket: CandidatureBucket | null,
): CandidatureFacet | null {
  if (!raw) return null
  if (!(ALL_FACETS as readonly string[]).includes(raw)) return null
  const facet = raw as CandidatureFacet
  if (bucket && FACET_BUCKET[facet] !== bucket) return null
  return facet
}

/**
 * Garde-fou de partition : la somme des facettes doit être le total, et la
 * somme des facettes d'un bucket doit être le compte de ce bucket. Un jour où
 * une raison sera ajoutée à `lifecycle.ts` sans être mappée ici, ce sont ces
 * égalités qui casseront — pas un compteur silencieusement faux en production.
 * Ne jette jamais : signale. Un compteur imparfait ne doit pas éteindre un écran.
 */
export function assertFacetPartition(
  facets: CandidatureFacetCounts,
  buckets: { active: number; archived: number },
  where: string,
): void {
  const sum = (keys: readonly CandidatureFacet[]) => keys.reduce((n, k) => n + facets[k], 0)
  const active = sum(FACETS_BY_BUCKET.active)
  const archived = sum(FACETS_BY_BUCKET.archived)
  if (active !== buckets.active || archived !== buckets.archived) {
    console.error(`[candidatures/facets] partition rompue (${where})`, {
      facets,
      buckets,
      sums: { active, archived },
    })
  }
}
