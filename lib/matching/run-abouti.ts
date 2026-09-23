// lib/matching/run-abouti.ts
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ UN RUN QUI A ÉCHOUÉ NE SE SOLDE PAS — LA DÉCISION, EN UN SEUL ENDROIT.   ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ⚠️ CE MODULE N'A AUCUN IMPORT, ET C'EST DÉLIBÉRÉ.
//    Il est chargé TEL QUEL par `scripts/diag-relance-rejouee.mjs`, qui
//    l'EXÉCUTE sur des verdicts fabriqués plutôt que de relire son texte
//    (§E.33). Un `import` d'alias `@/…` le rendrait inchargeable par Node, et
//    le contrôle retomberait sur une expression régulière — c'est-à-dire sur
//    un commentaire (§E.7). Même parti pris que `lib/expert-name-code.ts`,
//    `lib/matching/empreinte.ts` et `lib/billing/vendabilite.ts`.
//
// ┌─ LE DÉFAUT QU'IL FERME, MESURÉ LE 22/09/2026 ────────────────────────────┐
// │ TROIS appelants — `cron/expert-relance`, `me/sync-matching` et            │
// │ `admin/approve-expert` — appelaient `solderRelance()` APRÈS le run,       │
// │ **quel que soit le verdict**. Moteur éteint, clé absente, plafond de      │
// │ dépense atteint, réglages illisibles : l'échéance était effacée comme     │
// │ après un run réussi. Le jalon est posé, plus rien ne reprend (§E.27       │
// │ forme B) — et la modification de profil qui avait déclenché la relance    │
// │ n'est JAMAIS notée.                                                       │
// │                                                                           │
// │ Le troisième est le pire des trois : à l'APPROBATION, « c'est le moment   │
// │ qui compte pour l'expert » — son premier écran. Un run raté là, et son    │
// │ premier contact avec la plateforme est un écran vide, définitivement.     │
// │                                                                           │
// │ ET LE CÔTÉ ANNONCE FAISAIT L'INVERSE DEPUIS TOUJOURS : `acheverRun(…,     │
// │ acheve)` laisse `matching_completed_at` à NULL sur un échec, le run reste │
// │ rejouable, borné à cinq tentatives, et VISIBLE au-delà. Deux              │
// │ comportements pour un même fait, et c'est celui qui PERD qui était du     │
// │ côté de l'expert.                                                         │
// └───────────────────────────────────────────────────────────────────────────┘

/**
 * LE PLAFOND DE TENTATIVES D'UNE RELANCE — au-delà, plus rien ne la reprend.
 *
 * ⚠️ IL A UN JUMEAU EN BASE, et c'est assumé (§E.20) : le défaut de
 *    `prochaine_relance_expert(p_max_tentatives)`. Le SQL ne peut pas importer
 *    ce module, et passer la valeur depuis chaque appelant ferait de chacun un
 *    endroit où l'oublier. `diag-relance-rejouee` ÉCHOUE si les deux divergent,
 *    ET si la supervision compte les abandons à un autre seuil — c'est la
 *    seule parade qui ne soit pas une promesse de vigilance.
 *
 * Cinq, comme côté annonce (`matching_attempts < 5`). Le même nombre pour le
 * même comportement : en choisir un autre ici inviterait à se demander pourquoi.
 */
export const RELANCE_MAX_TENTATIVES = 5

/** La forme minimale d'un verdict — ce que la décision a besoin de lire. */
export type VerdictLu = {
  status: string
  empechement?: { quoi: string; code?: string }
}

/**
 * Le run est-il allé AU BOUT ? `true` ⇒ on solde. `false` ⇒ on rejoue.
 *
 * Fonction PURE, et sa liste de cas est courte parce que c'est une DÉCISION,
 * pas une classification : tout ce qui n'est pas un empêchement réparable est
 * un aboutissement.
 */
export function runAcheve(verdict: VerdictLu): boolean {
  // Une notation ARRÊTÉE n'est pas un run : interrupteur fermé, clé absente,
  // plafond de dépense atteint. Les trois se réparent, et les trois méritent
  // d'être rejouées — bornées par le plafond de tentatives.
  if (verdict.empechement?.quoi === 'arret_de_notation') return false
  // Une panne de lecture, ou des réglages absents : idem.
  if (verdict.status === 'error' || verdict.status === 'no_config') return false
  // `ineligible` EST un aboutissement, et c'est délibéré : l'expert n'a pas
  // droit au moteur aujourd'hui, et rejouer cinq fois n'y changera rien. Son
  // écran le lui dit déjà, en une lecture de ligne (§D.13 ①).
  // `ok` et `empty_pool` sans empêchement : le moteur a tourné jusqu'au bout.
  return true
}

/**
 * Le motif NOMMÉ d'un échec — jamais une phrase.
 *
 * Une phrase se traduit à l'affichage et se corrige à la relecture ; un code se
 * compare. C'est la leçon de §E.24 : la première version de
 * `issueDepuisVerdict` distinguait « moteur éteint » de « aucune mission » par
 * une expression régulière sur un champ de journal.
 */
export function codeDEchec(verdict: VerdictLu): string {
  if (verdict.empechement?.quoi === 'arret_de_notation') {
    return verdict.empechement.code === 'plafond_atteint'
      ? 'plafond_atteint'
      : 'moteur_indisponible'
  }
  if (verdict.status === 'no_config') return 'reglages_absents'
  return 'lecture_en_panne'
}

/**
 * L'ÉTAT DE LA DERNIÈRE RECHERCHE, tel que l'écran de l'expert doit le lire.
 *
 * `null` ⇔ la dernière a abouti. Pas de valeur neutre, pas de `'inconnu'` :
 * l'absence se lit « rien à signaler », et c'est sa seule lecture correcte
 * (§E.27).
 */
export function etatDerniereRecherche(row: {
  matching_relance_echec_code?: string | null
  matching_relance_due_at?: string | null
  matching_relance_tentatives?: number | null
}): { etat: 'echec'; raison: string; abandonnee: boolean } | null {
  // ⚠️ LES DEUX CONDITIONS, ET PAS UNE SEULE. Un code d'échec SANS échéance est
  //    un échec déjà rattrapé — un run ultérieur a abouti et a tout effacé.
  //    Annoncer un échec passé sur un flux simplement vide serait le défaut
  //    inverse de celui qu'on ferme : inquiéter sans raison au lieu de taire
  //    une panne.
  if (!row.matching_relance_echec_code || !row.matching_relance_due_at) return null
  return {
    etat: 'echec',
    raison: row.matching_relance_echec_code,
    abandonnee: (row.matching_relance_tentatives ?? 0) >= RELANCE_MAX_TENTATIVES,
  }
}
