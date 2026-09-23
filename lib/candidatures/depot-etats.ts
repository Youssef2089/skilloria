// lib/candidatures/depot-etats.ts
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ LE VOCABULAIRE D'UN DÉPÔT — ses causes, sa fenêtre, ses états.           ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// MODULE **PUR** : aucun import, aucun accès réseau, aucune dépendance à
// Next.js. Il est donc exécuté TEL QUEL par son contrôle (§E.33) — on éprouve
// la règle elle-même, pas une reconstitution de la règle.
//
// ⚠️ LES TROIS CAUSES SONT DÉFINIES **ICI ET NULLE PART AILLEURS**.
//    Elles vivaient en trois endroits qui se recopiaient : le type
//    `CausePanne` du jugement, la contrainte `check` de la base, et le filtre
//    de l'écran d'administration. Trois listes du même fait vieillissent
//    séparément (§E.20). Le type est désormais DÉRIVÉ de la liste — une
//    divergence ne compile pas — et le contrôle vérifie que la contrainte de
//    la base porte exactement ces valeurs-là.

/**
 * Les trois raisons pour lesquelles un jugement n'aboutit pas.
 *
 * Elles restent DISTINCTES jusqu'à l'affichage : un compteur unique dirait
 * seulement « il en manque beaucoup », là où trois disent lequel des trois
 * problèmes on a — et donc quoi faire. Un plafond atteint se relève, une panne
 * de modèle se répare, une réponse illisible se surveille.
 */
export const CAUSES_DEPOT = ['plafond', 'modele_indisponible', 'reponse_illisible'] as const

export type CausePanne = (typeof CAUSES_DEPOT)[number]

/**
 * Fenêtre pendant laquelle un dépôt commencé peut encore aboutir.
 *
 * QUARANTE-CINQ SECONDES, ET LE CHOIX SE JUSTIFIE DES DEUX CÔTÉS.
 *   Le jugement appelle le modèle avec un délai d'attente de 30 s
 *   (TIMEOUT_MS, lib/candidatures/ai-assessment.ts). Un dépôt commencé il y a
 *   moins de 30 s peut donc encore produire une candidature ; au-delà, son
 *   appel a forcément rendu la main — réussi, échoué, ou expiré. La marge de
 *   15 s couvre le temps qui encadre l'appel : gardes, insertion, dévoilement.
 *
 *   TROP COURTE, on déclarerait interrompu un dépôt qui va aboutir — et on le
 *   relancerait, donc on paierait deux fois le même dossier.
 *   TROP LONGUE, une fonction tuée resterait invisible d'autant, et le
 *   dévoilement inclus attendrait un dépôt qui ne viendra jamais.
 *
 *   ⚠️ ELLE EST ADOSSÉE AU DÉLAI DU MODÈLE. Si TIMEOUT_MS change, celle-ci
 *      doit changer avec lui : une fenêtre plus courte que le délai d'attente
 *      déclarerait interrompus des dépôts encore vivants.
 *
 * ELLE SERT AUX DEUX CÔTÉS, ET C'EST VOULU : le dévoilement inclus s'en sert
 * pour savoir s'il doit attendre, l'écran d'administration pour savoir s'il
 * doit afficher. Deux constantes distinctes finiraient par diverger, et
 * l'écran proposerait alors de relancer un dépôt que le dévoilement attend
 * encore.
 */
export const FENETRE_DEPOT_MS = 45_000

/**
 * CE QU'ON MONTRE D'UNE LIGNE DE JOURNAL — quatre états, jamais trois.
 *
 * `interrompu` n'est PAS stocké : il se DÉRIVE de l'heure. Un état stocké
 * exigerait que quelqu'un vienne le poser — une tâche, donc un intervalle,
 * donc exactement la classe de défaut fermée par §E.63. Dérivé, il est juste
 * à la seconde près et il se répare tout seul si le dépôt finit par aboutir.
 */
export type EtatDepotAffiche = 'depose' | 'echec' | 'interrompu' | 'en_cours'

/**
 * L'état d'affichage d'une ligne de journal.
 *
 * `maintenantMs` est EXIGÉ, sans valeur par défaut : une fonction qui lit
 * l'heure elle-même ne s'éprouve qu'en attendant (§E.33). Ici, le banc lui
 * donne l'instant qu'il veut.
 */
export function etatDeDepot(
  ligne: { etat: string; commence_at: string },
  maintenantMs: number,
): EtatDepotAffiche {
  if (ligne.etat === 'depose') return 'depose'
  if (ligne.etat === 'echec') return 'echec'
  // ⚠️ UNE DATE ILLISIBLE NE VAUT PAS « TOUT VA BIEN ». `Date.parse` rend NaN,
  //    et toute comparaison avec NaN est fausse : la ligne serait restée
  //    `en_cours`, donc invisible sur l'écran ET bloquante pour le
  //    dévoilement, pour toujours. On la traite comme interrompue — le sens
  //    est juste (on ne sait pas quand elle a commencé, elle n'aboutira pas)
  //    et elle se voit.
  const debut = Date.parse(ligne.commence_at)
  if (!Number.isFinite(debut)) return 'interrompu'
  return maintenantMs - debut > FENETRE_DEPOT_MS ? 'interrompu' : 'en_cours'
}

/**
 * LE PRÉDICAT « EN SOUFFRANCE », ÉCRIT UNE FOIS.
 *
 * Deux surfaces le lisent : l'écran `/admin/depots-en-echec` et le compteur
 * de la SUPERVISION. Deux expressions du même fait diraient un jour deux
 * nombres différents — la supervision annoncerait trois problèmes et l'écran
 * en montrerait cinq, et c'est la supervision qu'on cesserait de croire
 * (§E.36). Ici, il n'y en a qu'une.
 *
 * Forme PostgREST (`.or(...)`) : un dépôt en ÉCHEC, ou un dépôt resté en
 * cours au-delà de la fenêtre. Un dépôt en cours RÉCENT n'est pas un problème,
 * il est en train de se faire.
 */
export function filtreDepotsEnSouffrance(maintenantMs: number): string {
  const limite = new Date(maintenantMs - FENETRE_DEPOT_MS).toISOString()
  return `etat.eq.echec,and(etat.eq.en_cours,commence_at.lt.${limite})`
}
