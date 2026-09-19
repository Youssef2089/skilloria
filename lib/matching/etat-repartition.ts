/**
 * « AUCUNE EXÉCUTION » N'EST PAS « LECTURE EN PANNE ».
 *
 * ┌─ LA RECHUTE, ET ELLE EST DE MA MAIN ────────────────────────────────────┐
 * │ Le lot 1.3 a passé une journée à fermer cette classe dans `lib/` : une   │
 * │ erreur technique convertie en affirmation métier (§E.22). L'écran de     │
 * │ réglage livré LE MÊME JOUR l'a rouverte — il affichait « Répartition     │
 * │ indisponible : la lecture a échoué » alors que le moteur n'avait tout    │
 * │ simplement JAMAIS TOURNÉ.                                                │
 * │                                                                          │
 * │ Accuser une panne quand il n'y a rien à lire envoie chercher un défaut   │
 * │ qui n'existe pas — et, le jour où la lecture tombe vraiment, la phrase   │
 * │ ne veut plus rien dire parce qu'on l'a déjà vue mentir.                  │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ═══ POURQUOI LES DEUX SE CONFONDAIENT — LA CAUSE EST EN SQL ═════════════
 *   `matching_threshold_health()` construit ses tranches par
 *   `from runs, generate_series(1, 10)`. Quand `runs` est VIDE, la jointure
 *   croisée ne rend AUCUNE ligne, donc `array_agg` rend **NULL**.
 *   L'écran testait `repartition === null` et concluait « lecture en échec ».
 *   Le `null` de « rien à agréger » et le `null` de « je n'ai pas pu lire »
 *   avaient la même forme — exactement le défaut de §E.22.
 *
 * ═══ LA PARADE EST UN TYPE, PAS UNE VIGILANCE ═══════════════════════════
 *   Trois états nommés, et le compilateur force l'écran à répondre aux trois.
 *   La décision vit ici, au serveur comme au client, dans une fonction PURE :
 *   éprouvable sans navigateur, et impossible à réécrire de travers dans un
 *   ternaire au milieu du JSX.
 */

/** Ce que le serveur rend pour un écosystème. `null` = la lecture a échoué. */
export type LectureRepartition = Array<{
  runs_observes: number | string | null
  repartition: Array<number | string> | null
  notes_totales: number | string | null
}> | null

export type EtatRepartition =
  /** La lecture a échoué. On ne sait pas. C'est un PROBLÈME. */
  | { etat: 'indisponible' }
  /** La lecture a réussi : le moteur n'a pas encore tourné. C'est un ÉTAT. */
  | { etat: 'aucune_execution' }
  /** On a de quoi répondre « à 7, combien entrent ». */
  | { etat: 'disponible'; tranches: number[]; total: number; runs: number }

const entier = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function etatRepartition(lecture: LectureRepartition): EtatRepartition {
  // ① LA LECTURE A ÉCHOUÉ. Le serveur rend `null` sur erreur, et JAMAIS un
  //    tableau vide : vide se lirait « aucune donnée » (§E.22).
  if (lecture === null) return { etat: 'indisponible' }

  // ② LA LECTURE A RÉUSSI ET N'A RIEN TROUVÉ. La fonction SQL rend toujours
  //    une ligne ; c'est son contenu qui dit s'il y a eu des exécutions.
  //    Une réponse VIDE est traitée ici comme « aucune exécution » et non
  //    comme une panne : la fonction est `stable` et rend toujours une ligne,
  //    donc zéro ligne ne peut venir que d'un agrégat sans matière.
  const l = lecture[0]
  if (!l) return { etat: 'aucune_execution' }

  const runs = entier(l.runs_observes)
  const tranches = Array.isArray(l.repartition) ? l.repartition.map(entier) : null

  // `repartition` NULL avec zéro run : c'est le cross join sans matière.
  if (runs === 0 || tranches === null || tranches.length !== 10) {
    return { etat: 'aucune_execution' }
  }

  const total = tranches.reduce((a, b) => a + b, 0)
  if (total === 0) return { etat: 'aucune_execution' }

  return { etat: 'disponible', tranches, total, runs }
}

/**
 * COMBIEN LA VALEUR LAISSE ENTRER, COMBIEN ELLE ÉCARTE.
 *
 * La répartition compte par TRANCHE ENTIÈRE : une valeur fractionnaire est
 * ramenée à sa tranche. On ne prétend pas à une précision que la mesure n'a pas.
 */
export function inclusExclus(
  tranches: readonly number[],
  valeur: number,
): { inclus: number; exclus: number } {
  const depuis = Math.max(0, Math.min(10, Math.floor(Number.isFinite(valeur) ? valeur : 0)))
  let inclus = 0
  let exclus = 0
  for (let i = 0; i < tranches.length; i++) {
    if (i >= depuis) inclus += tranches[i]
    else exclus += tranches[i]
  }
  return { inclus, exclus }
}
