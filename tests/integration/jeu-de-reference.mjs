// tests/integration/jeu-de-reference.mjs — LE JEU DE RÉFÉRENCE DU MOTEUR DE MISE EN RELATION (lot DevOps CI).
//
// Des DONNÉES, rien d'autre : qui sont les experts et les annonces, ce que l'IA simulée note, ce que le moteur
// doit rendre. Exécuté par tests/integration/moteur-reference.mjs (vrai moteur, base du runner) ; sa cohérence
// interne (chaque couple du vivier noté, chaque correspondance tirée de sa note) est vérifiée sans base par
// scripts/diag-integration-continue.mjs.
//
// Branche « R » (la première branche active de l'écosystème) et « T » (une autre, témoin) ; spécialités S1 et
// S2 (créées dans R) ; zones par code pays (FR, DE, MA) ou de continent (EU, AF, WORLD) — celles du référentiel.
// Pour ajouter un cas : un expert ou une annonce ici, ses notes dans NOTES, ce qu'on attend dans ATTENDU — et
// la phrase qui dit POURQUOI dans le commentaire d'ATTENDU.

export const EXPERTS = [
  { ref: 'E1', voie: 'expert', branche: 'R', specialites: ['S1'], seniorites: ['senior'], zones: ['FR'] },
  { ref: 'E2', voie: 'expert', branche: 'R', specialites: ['S2'], seniorites: ['senior'], zones: ['FR'] },
  { ref: 'E3', voie: 'expert', branche: 'R', specialites: ['S1'], seniorites: ['junior'], zones: ['FR'] },
  { ref: 'E4', voie: 'expert', branche: 'R', specialites: ['S1'], seniorites: ['senior'], zones: ['MA'] },
  { ref: 'E5', voie: 'expert', branche: 'R', specialites: [], autre: 'Spécialité rare de référence', seniorites: ['senior'], zones: ['FR'] },
  { ref: 'E6', voie: 'expert', branche: 'T', specialites: [], autre: 'Branche témoin', seniorites: ['senior'], zones: ['FR'] },
  { ref: 'E7', voie: 'expert', branche: 'R', specialites: ['S1'], seniorites: ['senior'], zones: ['WORLD'] },
  { ref: 'E8', voie: 'expert', branche: 'R', specialites: ['S1'], seniorites: ['senior'], zones: ['FR'], invisible: true },
  { ref: 'E9', voie: 'expert', branche: 'R', specialites: ['S1'], seniorites: ['senior'], zones: ['FR'], indisponible: true },
  { ref: 'C1', voie: 'cdi', branche: 'R', specialites: ['S2'], seniorites: ['junior'], zones: ['MA'] },
  { ref: 'C2', voie: 'cdi', branche: 'R', specialites: ['S1'], seniorites: ['senior'], zones: ['DE'], ouvert: true },
  { ref: 'C3', voie: 'cdi', branche: 'R', specialites: ['S2'], seniorites: ['junior'], zones: ['MA'], indisponible: true },
]

export const ANNONCES = [
  // Une mission (public natif : freelance) en France et en Allemagne, S1, senior.
  { ref: 'M1', type: 'mission', branche: 'R', specialites: ['S1'], seniorites: ['senior'], zones: ['FR', 'DE'] },
  // Une mission « Autre » seul (aucune spécialité), sans séniorité, sur « Europe — tout le continent ».
  { ref: 'M2', type: 'mission', branche: 'R', specialites: [], seniorites: [], zones: ['EU'] },
  // Une offre (public natif : CDI) au Maroc, S2, junior ou confirmé.
  { ref: 'O1', type: 'offre', branche: 'R', specialites: ['S2'], seniorites: ['junior', 'confirmed'], zones: ['MA'] },
]

/**
 * Les notes de l'IA SIMULÉE, couple par couple : « fort » (au-dessus du palier), « normal » (entre le filtre et le
 * palier), « sous » (sous le filtre). Un couple du vivier absent d'ici fait échouer son lot : le jeu est COMPLET,
 * et une divergence du vivier se voit.
 */
export const NOTES = {
  M1: { E1: 'fort', E5: 'normal', E7: 'sous', C2: 'fort' },
  M2: { E1: 'normal', E2: 'fort', E3: 'normal', E5: 'sous', E7: 'normal', C2: 'normal' },
  O1: { C1: 'fort' },
}

/** Ce que le moteur doit rendre : le vivier (sans IA), puis les correspondances et leur palier (avec l'IA simulée). */
export const ATTENDU = {
  //   M1 : E2 (S2 ≠ S1), E3 (junior), E4 (Maroc), E6 (branche témoin), E8 (invisible), E9 (ne pas déranger),
  //        C1 et C3 (CDI non ouverts aux missions) sont HORS du vivier ; E5 (« Autre » seul : aucune contrainte de
  //        spécialité, §D.39), E7 (« Partout dans le monde ») et C2 (CDI ouvert aux missions, en Allemagne) y sont.
  //        E7 est noté sous le filtre du flux : aucune correspondance.
  M1: { vivier: ['C2', 'E1', 'E5', 'E7'], correspondances: { E1: 'strong', E5: 'normal', C2: 'strong' } },
  //   M2 : ni spécialité ni séniorité exigées — les freelances visibles et disponibles de la branche en Europe
  //        (le monde compris), et C2 ouvert aux missions. E5 est noté sous le filtre.
  M2: { vivier: ['C2', 'E1', 'E2', 'E3', 'E5', 'E7'], correspondances: { E1: 'normal', E2: 'strong', E3: 'normal', E7: 'normal', C2: 'normal' } },
  //   O1 : C1 seul — C3 est salarié non en recherche, C2 n'a pas S2, aucun freelance n'est ouvert aux offres.
  O1: { vivier: ['C1'], correspondances: { C1: 'strong' } },
}

/** Les deux filtres posés par le jeu (sur 10), par la fonction de l'écran (`regler_matching`). */
export const FEED = 3
export const PALIER = 8

/** Les experts que le sens expert → annonces fait tourner en premier (les autres suivent par le sens annonce). */
export const SENS_EXPERT = ['E1', 'E3', 'C1']
/** Des experts inéligibles que le sens expert → annonces doit laisser sans correspondance. */
export const INELIGIBLES = ['E8', 'E9', 'C3']
