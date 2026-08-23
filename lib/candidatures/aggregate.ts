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
  /** Fenêtre d'échange 15 j ENCORE ouverte. Raison du bucket ACTIF. */
  exchange_open: number
  /** Déposée, annonce encore ouverte, pas encore débloquée. Bucket ACTIF. */
  awaiting_review: number
  /** Candidat retenu. Bucket ACTIF (issue positive, sans limite de temps). */
  selected: number
  /** Refus explicite de l'entreprise. Bucket ARCHIVÉ — d'où son absence des
   *  tuiles d'accueil, qui sont bornées à l'actif : elle y vaudrait toujours 0. */
  rejected: number
  /**
   * Score IA moyen en POURCENTAGE (base sur 10 → ×10), arrondi ici pour que le
   * client n'ait aucun calcul à refaire. `null` = aucun score connu sur le lot.
   */
  avg_score_pct: number | null
}

/** Compte les raisons dérivées d'un lot. Une seule passe, aucune règle rejouée. */
export function aggregateCandidatures(list: readonly AggregableCandidature[]): CandidaturesAggregate {
  let exchangeOpen = 0
  let awaitingReview = 0
  let selected = 0
  let rejected = 0
  let scoreSum = 0
  let scoreN = 0

  for (const c of list) {
    switch (c.lifecycle?.reason) {
      case 'exchange_open':   exchangeOpen++;   break
      case 'awaiting_review': awaitingReview++; break
      case 'selected':        selected++;       break
      case 'rejected':        rejected++;       break
      // Les autres raisons (publication_expired, publication_closed,
      // exchange_expired, withdrawn, archived) ne portent aucune tuile : elles
      // comptent dans `total` et dans `counts.archived`, nulle part ailleurs.
      default: break
    }
    if (c.ai_match_score != null) {
      scoreSum += c.ai_match_score
      scoreN++
    }
  }

  return {
    total: list.length,
    exchange_open: exchangeOpen,
    awaiting_review: awaitingReview,
    selected,
    rejected,
    avg_score_pct: scoreN > 0 ? Math.round((scoreSum / scoreN) * 10) : null,
  }
}
