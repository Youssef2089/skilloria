// lib/ai-plafonds.ts
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ CE QU'UN PLAFOND PAR ACTEUR ARRÊTE — et ce qu'il ne doit JAMAIS arrêter. ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ┌─ LA DÉCISION, ARBITRÉE ─────────────────────────────────────────────────┐
// │ « Une organisation au plafond PUBLIE QUAND MÊME — elle a payé — mais le  │
// │   classement ne part pas. Un expert au plafond garde son compte          │
// │   utilisable. »                                                          │
// │                                                                          │
// │ Un plafond par acteur ne suspend pas un compte : il arrête ce que la     │
// │ PLATEFORME dépense toute seule pour cet acteur. Ce que la personne vient │
// │ de demander, elle, aboutit.                                              │
// └──────────────────────────────────────────────────────────────────────────┘
//
// ═══ POURQUOI UNE TABLE, ET PAS DEUX `if` BIEN PLACÉS ═══════════════════════
//   Sept points de dépense existent, un huitième s'écrira. Deux conditions
//   dispersées laisseraient le huitième sans classe — c'est-à-dire, par
//   distraction, du côté qui ne bloque jamais : un plafond qu'on ajoute et qui
//   ne plafonne rien.
//
//   La table est EXHAUSTIVE PAR LE TYPE (`satisfies Record<ActionIA, …>`) : une
//   action ajoutée sans classe NE COMPILE PAS. Même parade que `ActeurIA`, qui
//   n'a pas de valeur par défaut pour la même raison.
//
// ⚠️ LE PLAFOND GLOBAL, LUI, ARRÊTE TOUT — c'est le dernier garde-fou, et il
//    parle d'argent qui n'existe plus. La distinction ci-dessous ne le concerne
//    pas : elle dit seulement ce qu'un acteur PARTICULIER cesse de coûter quand
//    c'est LUI qui a trop coûté.
//
// MODULE PUR — AUCUN IMPORT DE VALEUR. Son contrôle l'exécute (§E.33).

import type { ActionIA } from '@/lib/ai-budget'

/**
 * Qui a décidé de cette dépense.
 *
 * `automatique` — la plateforme la déclenche d'elle-même, en boucle, sans que
 *   personne ne l'attende sur un écran. C'est là que part l'argent d'un acteur
 *   qui dérape, et c'est ce qu'un plafond par acteur doit arrêter.
 *
 * `deliberee` — quelqu'un vient de faire un geste et attend son résultat. La
 *   bloquer ne protège pas l'argent : elle casse le geste. Et elle le casse de
 *   façon invisible, parce qu'un plafond n'est pas un motif qu'un utilisateur
 *   puisse comprendre sur l'écran où il se trouve.
 */
export type ClasseAction = 'automatique' | 'deliberee'

/**
 * LA CLASSE DE CHAQUE POINT DE DÉPENSE, avec sa raison.
 *
 * ⚠️ CHAQUE LIGNE EST UN ARBITRAGE, PAS UNE ÉVIDENCE. Les relire avant d'en
 *    ajouter une : la question n'est pas « est-ce cher ? » mais « qui attend
 *    le résultat, et que casse-t-on en ne le rendant pas ? ».
 */
export const CLASSE_DES_ACTIONS = {
  /**
   * AUTOMATIQUE — la seule, aujourd'hui, et c'est celle que la décision nomme.
   * Le moteur tourne à chaque publication, à chaque bascule de disponibilité,
   * à chaque relance. C'est la dépense qui se répète, donc celle qui dérape.
   * L'arrêter laisse l'annonce publiée et le compte intact : exactement ce qui
   * a été demandé.
   */
  matching_pool: 'automatique',

  /**
   * DÉLIBÉRÉE — l'expert vient de téléverser son CV et regarde la barre de
   * progression. Elle a DÉJÀ son propre plafond, en base et par personne
   * (`ai_quotas`), qui est le bon outil pour cette dépense-là.
   */
  cv_parsing: 'deliberee',

  /**
   * DÉLIBÉRÉE, ET C'EST §D.19 QUI LE REND OBLIGATOIRE. « Une candidature existe
   * avec sa note et son résumé, ou elle n'existe pas » : bloquer le jugement,
   * c'est empêcher l'expert de postuler. Un compte qui ne peut plus postuler
   * n'est pas « utilisable ».
   * L'abus par répétition est fermé ailleurs, et par le bon outil : le plafond
   * horaire de relance (§D.7).
   */
  candidature_assessment: 'deliberee',

  /** DÉLIBÉRÉE — l'organisation a cliqué et attend son texte. */
  pitch: 'deliberee',

  /**
   * DÉLIBÉRÉE — elle arrive UNE FOIS, à l'entrée dans le produit. La bloquer
   * laisserait un expert non vérifié indéfiniment, sans qu'aucun écran ne
   * puisse le lui dire.
   */
  expert_verification: 'deliberee',

  /** DÉLIBÉRÉE — même raison, du côté de l'organisation qui s'inscrit. */
  org_verification: 'deliberee',

  /**
   * DÉLIBÉRÉE — l'organisation publie, et cette analyse est une GARDE du
   * produit, pas un service qu'on lui rend. La couper parce qu'elle a trop
   * dépensé reviendrait à lever une protection au moment où l'on se méfie.
   */
  publication_quality: 'deliberee',
} as const satisfies Record<ActionIA, ClasseAction>

/**
 * L'état de dépense d'UN acteur, tel que la base le calcule.
 *
 * ⚠️ L'ALERTE N'Y FIGURE PAS, ET C'EST DÉLIBÉRÉ. Elle SIGNALE, elle n'empêche
 *    rien (§D.9) — un parcours n'a donc aucune raison de la connaître. La
 *    porter ici ne l'aurait pas rendue bloquante ; elle l'aurait rendue
 *    DISPONIBLE, ce qui est la première moitié du chemin. Une alerte devient
 *    un blocage parce qu'elle était à portée de main, pas parce que quelqu'un
 *    l'a décidé. `diag-depense-ia` tient cette frontière depuis le lot qui l'a
 *    posée, et c'est lui qui a dénoncé ce transport.
 *
 *    Elle vit donc là où elle sert : les écrans d'administration.
 */
export type EtatActeur = {
  depense_mois_usd: number
  plafond_mensuel_usd: number
  au_plafond: boolean
}

export type VerdictPlafondActeur =
  | { arrete: false }
  | { arrete: true; depense_mois_usd: number; plafond_mensuel_usd: number }

/**
 * CE PLAFOND D'ACTEUR ARRÊTE-T-IL CETTE ACTION ?
 *
 * Deux conditions, et les deux comptent :
 *   ① l'acteur est au plafond ;
 *   ② l'action est de celles que la plateforme déclenche d'elle-même.
 *
 * ⚠️ L'ORDRE DES DEUX N'A AUCUNE IMPORTANCE ICI, mais leur CONJONCTION en a
 *    une : ne garder que ① suspendrait le compte, ne garder que ② n'arrêterait
 *    jamais rien.
 */
export function arretParPlafondActeur(
  action: ActionIA,
  etat: EtatActeur | null,
): VerdictPlafondActeur {
  if (etat === null) return { arrete: false }
  if (!etat.au_plafond) return { arrete: false }
  if (CLASSE_DES_ACTIONS[action] !== 'automatique') return { arrete: false }
  return {
    arrete: true,
    depense_mois_usd: etat.depense_mois_usd,
    plafond_mensuel_usd: etat.plafond_mensuel_usd,
  }
}

/**
 * L'ALERTE reste SOUS le plafond, et la base tient la règle.
 *
 * ⚠️ CETTE FONCTION EST LA SEULE CHOSE QUE CE MODULE SAIT DE L'ALERTE, et elle
 *    ne s'exécute que dans le back-office : elle juge deux RÉGLAGES l'un par
 *    rapport à l'autre, jamais une dépense. Elle vit ici pour que tout ce qui
 *    touche aux plafonds se lise au même endroit.
 *
 * Une alerte au-dessus du plafond ne se déclencherait JAMAIS : le plafond
 * arrête la dépense avant qu'elle n'y arrive. Ce serait un réglage qu'on peut
 * saisir, qui s'affiche, et qui ne peut rien produire — la forme exacte du
 * réglage mort (§D.11), avec en prime l'air d'être vivant.
 */
export function alerteCoherente(seuilAlerteUsd: number, plafondUsd: number): boolean {
  return seuilAlerteUsd <= plafondUsd
}
