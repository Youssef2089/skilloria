// components/home/theme.ts
//
// Chrome de la page d'accueil publique.
//
// CRITÈRE D'ADMISSION D'UNE COULEUR EN DUR ICI : elle doit être identique sur
// TOUS les écosystèmes (microsoft, sap, salesforce…). Une couleur qui varie d'un
// écosystème à l'autre n'a rien à faire dans ce fichier — elle vient de
// `useDomain().accentColor`, résolu côté serveur.
//
// Deux familles y sont admises :
//   - le CHROME : crème, encre, gris de texte, bordures, surfaces alternées.
//     Ce sont les couleurs de Skilloria, pas celles d'un écosystème.
//   - les couleurs PORTEUSES DE SENS : vert de validation, ambre
//     d'avertissement. Elles signifient « vérifié » ou « attention », jamais
//     « Microsoft ».
//
// La surface et l'encre sont importées de lib/domain-config : elles y servent de
// référence au calcul de contraste de l'accent, et ne doivent exister qu'une fois.

import { PUBLIC_INK, PUBLIC_SURFACE } from '@/lib/domain-config'

export const theme = {
  /** Surfaces alternées, dans l'ordre de lecture de la page. */
  cream: PUBLIC_SURFACE,
  white: '#FFFFFF',
  beige: '#F6F2EA',

  /** Textes. */
  ink: PUBLIC_INK,
  muted: '#6B655C',
  faint: '#8A8377',

  /** Bordures. */
  border: '#E7E2D8',
  borderSoft: '#EFE9DD',

  /** Pied de page sombre. */
  inkSurface: PUBLIC_INK,
  onInk: '#F4F0E8',
  onInkMuted: '#9A938A',
  onInkBorder: '#332F2A',

  /** Porteuses de sens — un état, jamais une marque. */
  success: '#0F6E56',
  successSoft: '#E1F5EE',
  warn: '#8A6100',
  warnSoft: '#FBF0DA',
} as const

/**
 * Pastels des pastilles de produits. Leur rôle est de DISTINGUER les produits les
 * uns des autres, pas de représenter une marque : l'attribution est strictement
 * POSITIONNELLE (`palette[i % palette.length]`), jamais indexée sur un nom de
 * produit. Un écosystème inconnu reçoit donc ses pastilles sans code à écrire.
 */
/**
 * Personnes fictives des démonstrations.
 *
 * Les portraits sont dessinés en SVG à partir de ces réglages (cf. demo/portraits.ts) :
 * aucun fichier image, aucune requête réseau, et aucun visage n'évoque une personne
 * réelle identifiable. Les traits sont volontairement schématiques et la variété
 * (carnations, coiffures, lunettes, barbe) sert seulement à distinguer les personnes
 * les unes des autres. Rien ici ne dépend de l'écosystème servi.
 */
export const portraitPresets = [
  { bg: '#EAF1F7', skin: '#F0D0B8', shade: '#E2BDA3', hair: '#3A2A21', cloth: '#2C5273', hairStyle: 'bun', glasses: false, beard: false },
  { bg: '#EDF3EC', skin: '#E3B18C', shade: '#D09C77', hair: '#2B2118', cloth: '#3A5C3B', hairStyle: 'short', glasses: true, beard: true },
  { bg: '#F7F1E4', skin: '#C68863', shade: '#B0754F', hair: '#1B1712', cloth: '#6E5526', hairStyle: 'long', glasses: false, beard: false },
  { bg: '#F1EEF7', skin: '#8D5524', shade: '#7A4720', hair: '#171310', cloth: '#4C4270', hairStyle: 'short', glasses: false, beard: false },
  { bg: '#F7EEE9', skin: '#F7E0C8', shade: '#E8CBAC', hair: '#8C6A4E', cloth: '#74452F', hairStyle: 'long', glasses: true, beard: false },
  { bg: '#E9F2F2', skin: '#A66A42', shade: '#8F5836', hair: '#241C17', cloth: '#2A5A5A', hairStyle: 'short', glasses: false, beard: true },
] as const

/** Traits communs à tous les portraits. */
export const portraitInk = {
  eye: '#2A2320',
  mouth: '#9A6552',
  frame: '#3A332C',
} as const

export const productPalette = [
  { bg: '#EAF1F7', color: '#2C5273' },
  { bg: '#EDF3EC', color: '#3A5C3B' },
  { bg: '#F7F1E4', color: '#6E5526' },
  { bg: '#F1EEF7', color: '#4C4270' },
  { bg: '#F7EEE9', color: '#74452F' },
  { bg: '#F7EDF1', color: '#6E3350' },
  { bg: '#E9F2F2', color: '#2A5A5A' },
  { bg: '#F2F0EA', color: '#5A5344' },
] as const

/**
 * Rythme horizontal : pleine largeur alignée gauche. Aucun `margin: auto`,
 * aucune largeur maximale qui recentrerait la page.
 */
export const gutter = 'clamp(20px, 5vw, 72px)'

/** Largeur de confort réservée aux blocs de texte long — jamais à une section. */
export const readable = 620

/** Interlettrage des grands titres. */
export const tightTracking = '-0.02em'
