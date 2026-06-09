/**
 * Palette décorative des cartes casting (home). Système SÉPARÉ de useDomain :
 * le chrome (sidebar, « Voir tout », badge IA) reste multi-tenant via
 * useDomain ; ces couleurs ne servent QUE de décor de carte.
 *
 * Assignation STABLE par carte (hash du seed → index fixe) : pas de
 * clignotement au reorder du feed. Seed = publication.id (toujours présent).
 *
 * Couleur liée à la marque de l'entreprise = évolution future ; ici c'est un
 * set fixe, lisible, contrasté.
 */

export type CastingPalette = {
  /** Fond du bandeau (teinte douce). */
  banner: string
  /** Couleur pleine : CTA + accents. */
  solid: string
  /** Texte sur `solid`. */
  onSolid: string
}

const PALETTES: CastingPalette[] = [
  { banner: '#EEF2FF', solid: '#4F46E5', onSolid: '#ffffff' }, // indigo
  { banner: '#ECFDF5', solid: '#059669', onSolid: '#ffffff' }, // emerald
  { banner: '#FFF7ED', solid: '#EA580C', onSolid: '#ffffff' }, // orange
  { banner: '#FDF4FF', solid: '#C026D3', onSolid: '#ffffff' }, // fuchsia
  { banner: '#ECFEFF', solid: '#0891B2', onSolid: '#ffffff' }, // cyan
  { banner: '#FEF2F2', solid: '#E11D48', onSolid: '#ffffff' }, // rose
  { banner: '#FEFCE8', solid: '#CA8A04', onSolid: '#ffffff' }, // amber
  { banner: '#F0F9FF', solid: '#0284C7', onSolid: '#ffffff' }, // sky
]

/** djb2 — hash stable et déterministe (pas de Math.random). */
function hashSeed(seed: string): number {
  let h = 5381
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0
  }
  return h
}

export function paletteFor(seed: string): CastingPalette {
  return PALETTES[hashSeed(seed || 'x') % PALETTES.length]
}
