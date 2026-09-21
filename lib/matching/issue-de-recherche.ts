// lib/matching/issue-de-recherche.ts
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ UNE RECHERCHE DE MISSIONS SE TERMINE TOUJOURS, ET ELLE DIT COMMENT.      ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ┌─ CE QUE CE TYPE REMPLACE ────────────────────────────────────────────────┐
// │ L'écran affichait « Analyse de votre profil en cours… vos missions       │
// │ arrivent dans quelques instants », puis, cent vingt secondes plus tard,  │
// │ « Aucune mission ne correspond à votre profil pour le moment ».          │
// │                                                                          │
// │ LES DEUX PHRASES ÉTAIENT FAUSSES. Rien n'avait été analysé : le          │
// │ basculement posait une échéance à SOIXANTE MINUTES et rendait la main.   │
// │ La première phrase affirmait un travail qui n'avait pas commencé ; la    │
// │ seconde affirmait un résultat qu'on n'avait pas.                         │
// │                                                                          │
// │ La fin de l'analyse était décidée par un CHRONOMÈTRE — soixante-quinze   │
// │ secondes — et par un changement de liste. Ni l'un ni l'autre ne sait     │
// │ quoi que ce soit du moteur.                                             │
// └──────────────────────────────────────────────────────────────────────────┘
//
// LA PARADE EST UN TYPE, PAS UNE DISCIPLINE. Une union fermée que l'appelant
// DOIT traiter en entier : il n'existe aucune branche « on ne sait pas encore »
// qui pourrait rester affichée indéfiniment. Chaque issue porte de quoi écrire
// une phrase vraie.

import type { Empechement } from './types'
import type { ArretDeNotation } from './rerank'

/**
 * Pourquoi un expert ne peut PAS recevoir de missions, aujourd'hui, et il le
 * sait avant qu'aucun moteur ne tourne.
 *
 * ⚠️ CES RAISONS SONT CONNUES EN UNE LECTURE DE LIGNE. C'est tout l'objet de ce
 *    type : la réponse existe au moment du clic, elle n'a jamais demandé
 *    d'attendre, et la faire attendre était le défaut.
 *
 * Elles sont produites par `expertEligible()`
 * ([lib/matching/run-for-expert.ts]) — qui est la SEULE implémentation de la
 * garde, et rend désormais ces codes directement. Il n'existe donc pas de
 * seconde liste de conditions qui pourrait dériver de la première (§E.20).
 */
export type RaisonIneligible =
  | 'profil_non_visible'
  | 'cv_non_analyse'
  | 'consentement_absent'
  | 'profil_non_approuve'
  | 'ne_pas_deranger'
  | 'non_en_recherche'

/**
 * Pourquoi une recherche n'a pas pu aboutir, alors que l'expert y avait droit.
 *
 * `moteur_indisponible` couvre le cas MESURÉ le 21/09/2026 : `ENABLE_RERANKING`
 * et `COHERE_API_KEY` absents. Le moteur refuse alors proprement, en quelques
 * millisecondes — et, sans ce code, l'écran l'aurait présenté comme « aucune
 * mission ne correspond ». Une panne de configuration n'est pas un résultat.
 *
 * `plafond_atteint` est distinct, et c'est délibéré : la dépense mensuelle a
 * atteint son PLAFOND (§D.9 — un plafond bloque). L'expert n'y peut rien, mais
 * l'administrateur, si : les confondre ferait chercher une clé absente alors
 * que le budget est simplement consommé.
 */
export type RaisonEchec =
  | 'moteur_indisponible'
  | 'plafond_atteint'
  | 'reglages_absents'
  | 'lecture_en_panne'
  | 'trop_de_demandes'
  /**
   * L'ATTENTE a expiré — pas le travail. Le run continue côté serveur et
   * écrira ses recommandations ; ce qui s'arrête, c'est la roue qui tourne.
   * C'est une issue NOMMÉE, donc dicible : « la recherche prend plus de temps
   * que prévu, vos missions apparaîtront ici » est vrai. Retirer le message en
   * silence au bout de soixante-quinze secondes, comme avant, ne l'était pas.
   */
  | 'trop_long'

/**
 * Chaque arrêt de notation a SON issue — aucune n'a de repli.
 *
 * Un `Record` plutôt qu'une comparaison à une valeur : la comparaison range
 * tout le reste dans sa branche « sinon », de sorte qu'un arrêt ajouté demain
 * serait présenté sous l'étiquette d'un autre, sans que rien ne le dise. Ici,
 * TypeScript refuse de compiler tant que le nouvel arrêt n'a pas SON issue.
 */
const ECHEC_PAR_ARRET: Record<Exclude<ArretDeNotation, 'aucun_document'>, RaisonEchec> = {
  interrupteur_ferme: 'moteur_indisponible',
  cle_absente: 'moteur_indisponible',
  plafond_atteint: 'plafond_atteint',
}

export type IssueDeRecherche =
  /** Le moteur a tourné jusqu'au bout et a trouvé. */
  | { etat: 'trouvees'; missions: number }
  /** Le moteur a tourné jusqu'au bout et n'a rien trouvé. C'est un RÉSULTAT. */
  | { etat: 'aucune' }
  /** L'expert n'y avait pas droit, et on le savait sans rien lancer. */
  | { etat: 'ineligible'; raison: RaisonIneligible }
  /** Quelque chose a empêché la recherche. Ce n'est PAS « aucune mission ». */
  | { etat: 'echec'; raison: RaisonEchec }

/**
 * Traduit le verdict brut du moteur en issue affichable.
 *
 * ⚠️ RIEN ICI NE LIT UNE PHRASE. La première version de cette fonction
 *    distinguait « moteur éteint » de « aucune mission » par une expression
 *    régulière sur `verdict.notes` — un champ dont le type dit, en toutes
 *    lettres, qu'il n'est jamais affiché à un utilisateur. Corriger un accent
 *    dans cette phrase aurait suffi à faire annoncer « aucune mission » sur une
 *    panne de configuration, en silence et en production (§E.24).
 *
 *    Le moteur rend maintenant `empechement` EN VALEUR, et c'est lui qu'on lit.
 *
 * ⚠️ `empty_pool` NE SE TRADUIT PAS EN « aucune mission ». Le moteur l'emploie
 *    pour deux faits opposés : « l'expert n'est pas éligible » et « aucune
 *    annonce à noter ». Seul `empechement` les sépare.
 */
export function issueDepuisVerdict(verdict: {
  status: string
  proposals: unknown[]
  empechement?: Empechement
}): IssueDeRecherche {
  const emp = verdict.empechement
  if (emp?.quoi === 'ineligible') return { etat: 'ineligible', raison: emp.raison }
  if (emp?.quoi === 'arret_de_notation') {
    return { etat: 'echec', raison: ECHEC_PAR_ARRET[emp.code] }
  }

  if (verdict.status === 'no_config') return { etat: 'echec', raison: 'reglages_absents' }
  if (verdict.status === 'error') return { etat: 'echec', raison: 'lecture_en_panne' }

  if (verdict.proposals.length > 0) return { etat: 'trouvees', missions: verdict.proposals.length }
  return { etat: 'aucune' }
}
