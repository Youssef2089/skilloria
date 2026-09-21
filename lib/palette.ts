// lib/palette.ts
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ LA SOURCE UNIQUE DES COULEURS DU PRODUIT.                                ║
// ║                                                                          ║
// ║ C'est le SEUL fichier d'interface autorisé à porter une couleur écrite   ║
// ║ en toutes lettres. Partout ailleurs — app/, components/, le reste de     ║
// ║ lib/ — une couleur se lit dans une variable CSS `--sk-*`, jamais dans    ║
// ║ un littéral. `scripts/diag-couleurs-litterales.mjs` rougit sur toute     ║
// ║ occurrence neuve.                                                        ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// POURQUOI CE FICHIER EXISTE, ET CE QU'IL A REMPLACÉ.
// L'audit du 21/09/2026 ([docs/audit-couleurs.html]) a mesuré 184 teintes
// distinctes et 3180 couleurs écrites à la main dans 125 fichiers, sans aucune
// classe Tailwind. L'accueil, lui, tenait en 15 couleurs déclarées dans un seul
// fichier. Les deux moitiés du produit ne partageaient AUCUNE couleur.
// Décision de Youssef : la palette de l'accueil devient celle de tout le
// produit, avec les MÊMES VALEURS, et elle se règle par écosystème.
//
// CE QUI SE RÈGLE ET CE QUI NE SE RÈGLE PAS — la distinction est le cœur du
// fichier, et elle n'est pas arbitraire.
//   · les HUIT RÔLES se règlent, par écosystème, depuis /admin/ecosystemes :
//     ce sont les couleurs d'une MARQUE, et une marque change d'un écosystème
//     à l'autre ;
//   · les COULEURS FIXES ne se règlent pas : un vert de validation signifie
//     « vérifié » et un rouge signifie « en échec », sur tous les écosystèmes.
//     C'est déjà la règle que portait `components/home/theme.ts` en tête :
//     « elles signifient "vérifié" ou "attention", jamais "Microsoft" ».
//     Les rendre réglables inviterait à peindre une erreur en vert.

import { accentStrong, accentTint, contrastRatio, deriveAccentColor } from './couleur'

/* ═══════════════════════════════════════════════════════════════════════════
   1. LES HUIT RÔLES RÉGLABLES
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Les rôles sont nommés par CE QU'ILS COLORENT, jamais par une valeur ni par
 * une place dans une échelle. « bandeau » dit où la couleur se pose ; « gris-2 »
 * n'aurait rien dit, et c'est ainsi qu'on se retrouve avec trois gris qui se
 * ressemblent et que personne n'ose toucher.
 */
export const ROLES_PALETTE = [
  'fond_page',
  'bandeau',
  'cartes',
  'bordures',
  'texte_principal',
  'texte_secondaire',
  'marque',
  'boutons',
] as const

export type RolePalette = (typeof ROLES_PALETTE)[number]

/**
 * La colonne de `domain_configs` qui porte chaque rôle.
 *
 * ⚠️ `marque` et `boutons` RÉUTILISENT deux colonnes qui existaient déjà —
 * `primary_color` et `accent_color`. En créer de nouvelles aurait produit deux
 * jumeaux qui divergent (§E.20) : `primary_color` EST déjà la couleur de marque
 * de l'écosystème, et `accent_color` EST déjà l'override de la couleur dérivée.
 * Leur nom anglais est conservé : les clients Supabase ne sont pas typés (§E.1),
 * une colonne se lit par son nom dans une chaîne, et un renommage casse au
 * runtime, en silence. Le renommage est un lot à lui seul (§D.9).
 */
export const COLONNE_PAR_ROLE: Record<RolePalette, string> = {
  fond_page: 'couleur_fond_page',
  bandeau: 'couleur_bandeau',
  cartes: 'couleur_cartes',
  bordures: 'couleur_bordures',
  texte_principal: 'couleur_texte_principal',
  texte_secondaire: 'couleur_texte_secondaire',
  marque: 'primary_color',
  boutons: 'accent_color',
}

/**
 * LES VALEURS DE RÉFÉRENCE — celles MESURÉES sur l'accueil le 21/09/2026.
 *
 * Ce ne sont pas des valeurs « par défaut » au sens d'un repli inventé (§E.11) :
 * ce sont les valeurs du produit, et la base porte les mêmes en `DEFAULT` de
 * colonne. Les deux côtés sont donc d'accord par construction, et un écosystème
 * neuf naît aux couleurs de la référence plutôt qu'en gris.
 *
 * `boutons` n'y figure pas, et c'est le point : il est CALCULÉ depuis la marque
 * jusqu'à franchir le contraste cible, puis surchargeable. Y écrire une valeur
 * en dur le figerait sur l'écosystème d'aujourd'hui.
 */
export const PALETTE_REFERENCE: Record<Exclude<RolePalette, 'boutons'>, string> = {
  fond_page: '#FDFBF7',
  bandeau: '#F6F2EA',
  cartes: '#FFFFFF',
  bordures: '#E7E2D8',
  texte_principal: '#1A1815',
  texte_secondaire: '#6B655C',
  marque: '#0EA5E9',
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. LES COULEURS FIXES — aucun écran ne les règle
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ `texteTenu` EST RÉSERVÉ AUX LIBELLÉS DE STRUCTURE, et c'est une décision
 *    de Youssef du 21/09/2026, pas une préférence.
 *
 *    Il vaut **3,63 contre le fond de page** — sous le minimum de lisibilité.
 *    Il colore donc les titres de groupes de la barre latérale et les survols :
 *    des repères qu'on ne LIT pas, on les balaie. **Jamais un texte qui porte
 *    une information.** Un état vide dit quelque chose — il utilise
 *    `texte_secondaire`, qui passe le minimum.
 *
 *    Cette règle NE SE BALAIE PAS : aucun motif ne distingue un libellé de
 *    structure d'un texte d'information. Elle se lit, écran par écran (§E.38).
 */
export const COULEURS_FIXES = {
  texteTenu: '#8A8377',
  bordureDouce: '#EFE9DD',

  // Porteuses de SENS. Identiques sur tous les écosystèmes : un état, jamais
  // une marque.
  succes: '#0F6E56',
  succesDoux: '#E1F5EE',
  avertissement: '#8A6100',
  avertissementDoux: '#FBF0DA',

  // ⚠️ L'ERREUR EST LA SEULE COULEUR DU PRODUIT QUI N'A PAS ÉTÉ MESURÉE SUR
  //    L'ACCUEIL : l'accueil n'a aucun état d'erreur. Elle a été CONSTRUITE par
  //    la même méthode que les deux précédentes — même bande de contraste sur
  //    le fond de page (5,4 à 6,0), même saturation — puis choisie par Youssef
  //    parmi trois candidats le 21/09/2026. Mesuré : 5,72 sur le fond de page,
  //    5,92 sur les cartes, 4,61 contre son propre fond doux.
  erreur: '#C32116',
  erreurDoux: '#FBDCDA',

  // Le pied de page de l'accueil est la SEULE surface foncée du produit.
  // Ces trois valeurs n'ont aucun équivalent dans les tableaux de bord, et
  // c'est mesuré, pas supposé : aucun fond sombre n'existe dans les deux voies
  // expertes. Elles restent ici pour que l'accueil n'ait pas sa propre source.
  surEncre: '#F4F0E8',
  surEncreTenu: '#9A938A',
  surEncreBordure: '#332F2A',
} as const

/**
 * LES COULEURS QUI NE NOUS APPARTIENNENT PAS.
 *
 * Le logo d'un tiers garde SA couleur. La recolorer au jeton du produit ne
 * serait pas une harmonisation : ce serait afficher un logo LinkedIn qui n'est
 * pas celui de LinkedIn. Aucune garde de contraste ne s'y applique non plus —
 * nous ne décidons pas de la marque d'un autre.
 *
 * C'est la seule raison pour laquelle une couleur peut entrer ici sans être un
 * rôle : elle n'est pas à nous.
 */
export const MARQUES_TIERCES = {
  linkedin: '#0A66C2',
} as const

/* ═══════════════════════════════════════════════════════════════════════════
   3. RÉSOLUTION
   ═══════════════════════════════════════════════════════════════════════════ */

export type Palette = {
  fondPage: string
  bandeau: string
  cartes: string
  bordures: string
  textePrincipal: string
  texteSecondaire: string
  marque: string
  /** Dérivé de la marque jusqu'au contraste cible, ou surchargé par l'admin. */
  boutons: string
  boutonsSurvol: string
  boutonsDoux: string
  /**
   * La couleur du LIBELLÉ posé sur un bouton plein. C'est `cartes` — la surface
   * claire du produit — et non un `#FFFFFF` écrit en dur : sur un écosystème
   * dont les cartes ne seraient pas blanches, un blanc figé jurerait. La garde
   * de contraste vérifie précisément cette paire avant d'enregistrer.
   */
  texteSurBoutons: string
} & typeof COULEURS_FIXES

const HEX = /^#[0-9a-fA-F]{6}$/

/** Rend la valeur si c'est un hexadécimal à six chiffres, sinon `null`. */
export function hexOuNull(valeur: unknown): string | null {
  return typeof valeur === 'string' && HEX.test(valeur.trim()) ? valeur.trim().toUpperCase() : null
}

/**
 * Construit la palette d'un écosystème depuis sa ligne `domain_configs`.
 *
 * Appelée AU SERVEUR uniquement : le navigateur reçoit des valeurs déjà
 * calculées et ne décide de rien. C'est la même règle que l'accent (§E.15) —
 * un composant client qui applique une règle serveur la fige dans le bundle.
 *
 * Une colonne absente ou illisible retombe sur la référence. Ce n'est PAS un
 * repli inventé (§E.11) : la référence est la palette du produit, elle est
 * écrite dans ce fichier ET en `DEFAULT` de colonne, et un écran ne peut pas se
 * retrouver sans couleur.
 */
export function resolvePalette(config: unknown): Palette {
  const cfg = (config ?? {}) as Record<string, unknown>
  const lire = (role: Exclude<RolePalette, 'boutons'>): string =>
    hexOuNull(cfg[COLONNE_PAR_ROLE[role]]) ?? PALETTE_REFERENCE[role]

  const fondPage = lire('fond_page')
  const marque = lire('marque')
  const cartes = lire('cartes')

  // `boutons` : l'override de l'admin s'il existe, sinon la dérivation depuis
  // la marque. La dérivation vise le FOND DE PAGE de cet écosystème, pas une
  // surface figée : c'est ce qui rend la règle valable sur un écosystème dont
  // le fond ne serait pas celui de la référence.
  const boutons = hexOuNull(cfg[COLONNE_PAR_ROLE.boutons])
    ?? deriveAccentColor(marque, fondPage, PALETTE_REFERENCE.texte_principal)

  return {
    fondPage,
    bandeau: lire('bandeau'),
    cartes,
    bordures: lire('bordures'),
    textePrincipal: lire('texte_principal'),
    texteSecondaire: lire('texte_secondaire'),
    marque,
    boutons,
    boutonsSurvol: accentStrong(boutons),
    boutonsDoux: accentTint(boutons),
    texteSurBoutons: cartes,
    ...COULEURS_FIXES,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. LA GARDE DE CONTRASTE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * LE MINIMUM DE LISIBILITÉ d'un texte, WCAG 2.1 AA.
 *
 * Ce n'est pas un réglage — ni un plafond, ni une alerte, ni un filtre, ni une
 * note (§D.9) : c'est une EXIGENCE, fixée hors de ce produit. Elle se dit donc
 * par ce qu'elle est, et le mot « seuil » n'a pas à revenir ici.
 */
export const MINIMUM_LISIBILITE = 4.5

/**
 * Les paires VÉRIFIÉES avant tout enregistrement.
 *
 * ⚠️ LES BORDURES N'Y SONT PAS, ET C'EST DÉLIBÉRÉ. La bordure de référence vaut
 *    **1,25** contre le fond de page : exiger 3 pour 1 ferait rougir la palette
 *    de l'accueil elle-même, dès le premier jour. Un contrôle qui refuse la
 *    référence qu'il est censé défendre est désactivé le jour même (§E.14).
 *    On ne garde que ce que Youssef a nommé : du texte sur un fond, et le
 *    libellé d'un bouton sur son bouton.
 */
export const PAIRES_VERIFIEES: ReadonlyArray<{
  cle: string
  texte: RolePalette
  fond: RolePalette
}> = [
  { cle: 'principal_sur_fond', texte: 'texte_principal', fond: 'fond_page' },
  { cle: 'principal_sur_cartes', texte: 'texte_principal', fond: 'cartes' },
  { cle: 'principal_sur_bandeau', texte: 'texte_principal', fond: 'bandeau' },
  { cle: 'secondaire_sur_fond', texte: 'texte_secondaire', fond: 'fond_page' },
  { cle: 'secondaire_sur_cartes', texte: 'texte_secondaire', fond: 'cartes' },
  { cle: 'secondaire_sur_bandeau', texte: 'texte_secondaire', fond: 'bandeau' },
  // Le libellé d'un bouton plein : `cartes` posé sur `boutons`.
  { cle: 'libelle_sur_boutons', texte: 'cartes', fond: 'boutons' },
]

export type VerdictPaire = {
  cle: string
  texte: string
  fond: string
  ratio: number
  minimum: number
  passe: boolean
}

/**
 * Vérifie une palette CANDIDATE, avant écriture.
 *
 * Rend TOUTES les paires, celles qui passent comprises : l'écran affiche le
 * ratio de chacune pendant que Youssef choisit, et un refus doit pouvoir dire
 * **laquelle** échoue et **de combien**. Un refus qui ne nomme rien envoie
 * chercher au hasard.
 */
export function verifierContraste(palette: Palette): {
  valide: boolean
  paires: VerdictPaire[]
  echecs: VerdictPaire[]
} {
  const valeurParRole: Record<RolePalette, string> = {
    fond_page: palette.fondPage,
    bandeau: palette.bandeau,
    cartes: palette.cartes,
    bordures: palette.bordures,
    texte_principal: palette.textePrincipal,
    texte_secondaire: palette.texteSecondaire,
    marque: palette.marque,
    boutons: palette.boutons,
  }

  const paires = PAIRES_VERIFIEES.map((p) => {
    const texte = valeurParRole[p.texte]
    const fond = valeurParRole[p.fond]
    const ratio = Math.round(contrastRatio(texte, fond) * 100) / 100
    return { cle: p.cle, texte, fond, ratio, minimum: MINIMUM_LISIBILITE, passe: ratio >= MINIMUM_LISIBILITE }
  })

  const echecs = paires.filter((p) => !p.passe)
  return { valide: echecs.length === 0, paires, echecs }
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. LES VARIABLES CSS — le seul chemin par lequel une couleur atteint l'écran
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Les jetons, tous RÉSOLUS EN LITTÉRAL.
 *
 * ⚠️ AUCUN `color-mix()`, ET C'EST LE CORRECTIF D'UN DÉFAUT MESURÉ.
 *    `globals.css` dérivait `--sk-accent-soft` et `--sk-accent-ink` par
 *    `color-mix(… var(--sk-accent) …)` sur `:root`. Or une propriété
 *    personnalisée est substituée **à l'endroit où elle est déclarée** : les
 *    deux dérivés se figeaient donc sur la valeur de secours de `:root`, et la
 *    surcharge posée plus bas par le shell ne les atteignait jamais. Mesuré
 *    dans un navigateur le 21/09/2026 : l'entrée de menu active sortait en
 *    #2553BB sur #E6EDFD — les dérivés d'un bleu de secours — pendant que le
 *    logo, qui lit `--sk-accent` directement, sortait bien à la couleur de
 *    l'écosystème. Deux bleus côte à côte, à quinze pixels d'écart.
 *    Tout est calculé au serveur et posé en littéral : la classe entière du
 *    défaut disparaît, elle n'est pas contournée.
 */
export function jetonsPalette(palette: Palette): Record<string, string> {
  return {
    // Surfaces
    '--sk-bg': palette.fondPage,
    '--sk-surface': palette.cartes,
    '--sk-surface-2': palette.bandeau,
    '--sk-bandeau': palette.bandeau,

    // Traits
    '--sk-border': palette.bordures,
    '--sk-border-soft': palette.bordureDouce,

    // Textes
    '--sk-text': palette.textePrincipal,
    '--sk-muted': palette.texteSecondaire,
    '--sk-faint': palette.texteTenu,

    // Marque et action
    '--sk-marque': palette.marque,
    '--sk-accent': palette.boutons,
    '--sk-accent-fort': palette.boutonsSurvol,
    '--sk-accent-soft': palette.boutonsDoux,
    '--sk-accent-ink': palette.boutons,
    '--sk-sur-accent': palette.texteSurBoutons,

    // États
    '--sk-success': palette.succes,
    '--sk-success-soft': palette.succesDoux,
    '--sk-success-ink': palette.succes,
    '--sk-amber': palette.avertissement,
    '--sk-amber-soft': palette.avertissementDoux,
    '--sk-red': palette.erreur,
    '--sk-red-soft': palette.erreurDoux,

    // Pied de page de l'accueil — la seule surface foncée du produit
    '--sk-encre': palette.textePrincipal,
    '--sk-sur-encre': palette.surEncre,
    '--sk-sur-encre-tenu': palette.surEncreTenu,
    '--sk-sur-encre-bordure': palette.surEncreBordure,

    // Gabarit d'origine de Next.js, conservé parce que `body` et `@theme` le
    // lisent encore. Il cesse d'être une couleur à part : il EST la palette.
    '--background': palette.fondPage,
    '--foreground': palette.textePrincipal,
  }
}

/**
 * Les jetons sous la forme attendue par l'attribut `style` de React.
 *
 * Posés sur `<html>`, donc sur `:root` lui-même. Un style en ligne l'emporte
 * sur toute feuille, il n'y a pas de second endroit où la valeur pourrait
 * vivre, et il n'y a aucun instant où la page serait peinte sans sa palette.
 */
export function stylePalette(palette: Palette): React.CSSProperties {
  return jetonsPalette(palette) as React.CSSProperties
}
