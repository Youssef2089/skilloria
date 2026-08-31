// lib/candidatures/aggregate.ts
//
// AGRÉGAT D'UN LOT DE CANDIDATURES — définition unique des nombres affichés.
//
// Ne contient AUCUNE règle d'état : la règle vit dans
// lib/candidatures/lifecycle.ts. Ici, uniquement le comptage des raisons déjà
// dérivées. Symétrique de lib/candidatures/lifecycle-batch.ts, qui assemble les
// entrées ; ce module, lui, compte les sorties.
//
// POURQUOI CE MODULE
//   Trois écrans affichaient des nombres de candidatures : la page
//   Candidatures, l'accueil freelance et l'accueil CDI. Chacun les recomposait
//   dans le navigateur, à sa façon. Vécu : « Postulées 3 » à côté de « Échanges
//   en cours 0 / Acceptées 0 / Refusées 0 », parce que la première tuile
//   comptait une longueur de tableau et les trois autres des sous-ensembles de
//   raisons — dont deux n'existent que dans le bucket actif et une seulement
//   dans l'archivé. Trois altitudes dans une même rangée.
//
//   Un compteur et sa liste ne peuvent diverger que s'ils ont deux
//   définitions. Il n'y en a donc plus qu'une, et elle est SERVEUR.
//
// LECTURE PURE : aucune écriture, aucun batch, aucune migration.

import type { CandidatureLifecycle } from '@/lib/candidatures/lifecycle'
import {
  emptyFacetCounts,
  facetForLifecycle,
  type CandidatureFacetCounts,
} from '@/lib/candidatures/facets'

/** Entrée minimale : l'état de vie déjà dérivé, et le score IA s'il existe. */
export type AggregableCandidature = {
  lifecycle: CandidatureLifecycle | null
  ai_match_score: number | null
}

/**
 * Jeu COMPLET de métriques. Volontairement exhaustif : chaque écran y puise ce
 * dont il a besoin sans qu'aucun ne recalcule. Ajouter une tuile quelque part
 * ne doit jamais rouvrir un `for` dans un composant.
 */
export type CandidaturesAggregate = {
  /** Nombre de candidatures du lot. */
  total: number
  /**
   * Répartition par FACETTE (lib/candidatures/facets.ts) — la MÊME table que
   * celle sur laquelle les listes filtrent.
   *
   * Elle remplace les quatre champs nommés d'avant (`exchange_open`,
   * `awaiting_review`, `selected`, `rejected`), qui ne couvraient que quatre
   * des neuf raisons : les tuiles d'accueil savaient donc compter ce qu'aucun
   * filtre ne savait afficher, et cinq raisons n'étaient comptées nulle part.
   * Ici la partition est complète — la somme des facettes vaut `total`.
   */
  facets: CandidatureFacetCounts
  /**
   * Score IA moyen en POURCENTAGE (base sur 10 → ×10), arrondi ici pour que le
   * client n'ait aucun calcul à refaire. `null` = aucun score connu sur le lot.
   */
  avg_score_pct: number | null
}

/** Compte les facettes d'un lot. Une seule passe, aucune règle rejouée. */
export function aggregateCandidatures(list: readonly AggregableCandidature[]): CandidaturesAggregate {
  const facets = emptyFacetCounts()
  let scoreSum = 0
  let scoreN = 0

  for (const c of list) {
    if (c.lifecycle) facets[facetForLifecycle(c.lifecycle)]++
    if (c.ai_match_score != null) {
      scoreSum += c.ai_match_score
      scoreN++
    }
  }

  return {
    total: list.length,
    facets,
    avg_score_pct: scoreN > 0 ? Math.round((scoreSum / scoreN) * 10) : null,
  }
}
