// lib/portraits-demo.ts
//
// LES COULEURS DES PORTRAITS DE LA DÉMONSTRATION — et rien d'autre.
//
// ┌─ POURQUOI CE FICHIER EST LE SECOND, ET LE DERNIER, À PORTER DES COULEURS ─┐
// │ La règle du produit est « aucune couleur littérale hors de                 │
// │ lib/palette.ts ». Celui-ci en est l'exception DÉCLARÉE, avec sa raison :   │
// │ ce ne sont pas des couleurs d'INTERFACE, ce sont des couleurs              │
// │ d'ILLUSTRATION — carnations, chevelures, vêtements.                        │
// │                                                                            │
// │ Elles ne se règlent pas par écosystème (un visage ne change pas de teint   │
// │ parce qu'on sert SAP), elles ne portent aucun sens d'état, et elles ne     │
// │ touchent aucune surface de lecture. Les faire entrer dans la palette       │
// │ aurait mélangé deux choses qui n'obéissent pas aux mêmes règles : la       │
// │ garde de contraste n'a rien à dire d'une couleur de cheveux.               │
// │                                                                            │
// │ `scripts/diag-couleurs-litterales.mjs` l'exempte NOMMÉMENT, avec cette     │
// │ raison. Une exemption sans raison est un tampon qu'on remplit sans lire    │
// │ (§G.8).                                                                    │
// └────────────────────────────────────────────────────────────────────────────┘
//
// Extrait de `components/home/theme.ts` au lot palette (21/09/2026), où ces
// 33 valeurs cohabitaient avec le décor de l'accueil et le faisaient paraître
// trois fois plus gros qu'il n'était.
//
// Les portraits sont dessinés en SVG à partir de ces réglages
// (cf. components/home/demo/portraits.ts) : aucun fichier image, aucune requête
// réseau, et aucun visage n'évoque une personne réelle identifiable. Les traits
// sont volontairement schématiques, et la variété — carnations, coiffures,
// lunettes, barbe — sert seulement à distinguer les personnes les unes des
// autres. Rien ici ne dépend de l'écosystème servi.

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
