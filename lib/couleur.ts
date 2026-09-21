// lib/couleur.ts
//
// LE CALCUL DES COULEURS, ET RIEN D'AUTRE.
//
// Ce module ne contient AUCUNE couleur : que des fonctions. C'est ce qui le
// rend importable par `lib/palette.ts` (qui, lui, porte les valeurs) sans
// créer de cycle — et c'est aussi ce qui permet à un diagnostic de l'exécuter
// tel quel, sans base et sans réseau (§E.3).
//
// Il a été extrait de `lib/domain-config.ts`, où ces fonctions vivaient avec
// les valeurs qu'elles calculent. Les séparer était la condition pour que la
// palette ait UNE source : sans cela, `palette.ts` et `domain-config.ts`
// s'importaient l'un l'autre.
//
// Les formules sont celles de WCAG 2.1 (luminance relative sur sRGB linéarisé)
// et de la conversion TSL classique. Rien n'y a été modifié pendant
// l'extraction — vérifiable par `git log -p`.

export type Rgb = { r: number; g: number; b: number }
export type Hsl = { h: number; s: number; l: number }

export function parseHex(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const raw = match[1].length === 3
    ? match[1].split('').map(c => c + c).join('')
    : match[1]
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16),
  }
}

export function toHex({ r, g, b }: Rgb): string {
  const channel = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/** Luminance relative WCAG 2.1 (sRGB linéarisé). */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const linear = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/**
 * Ratio de contraste WCAG entre deux couleurs hexadécimales.
 *
 * ⚠️ Rend **1** si l'une des deux est illisible. C'est le ratio du pire cas —
 * donc une garde bâtie dessus REFUSE plutôt qu'elle n'ouvre. Rendre une valeur
 * flatteuse sur une entrée qu'on n'a pas su lire serait §E.22 dans sa forme la
 * plus coûteuse : une garde qui s'ouvre sur une panne.
 */
export function contrastRatio(a: string, b: string): number {
  const rgbA = parseHex(a)
  const rgbB = parseHex(b)
  if (!rgbA || !rgbB) return 1
  const lumA = relativeLuminance(rgbA)
  const lumB = relativeLuminance(rgbB)
  const [high, low] = lumA >= lumB ? [lumA, lumB] : [lumB, lumA]
  return (high + 0.05) / (low + 0.05)
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const delta = max - min
  if (delta === 0) return { h: 0, s: 0, l }

  const s = delta / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === rn) h = 60 * (((gn - bn) / delta) % 6)
  else if (max === gn) h = 60 * ((bn - rn) / delta + 2)
  else h = 60 * ((rn - gn) / delta + 4)
  if (h < 0) h += 360
  return { h, s, l }
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const sector = ((((h % 360) + 360) % 360) / 60)
  const x = c * (1 - Math.abs((sector % 2) - 1))
  let base: [number, number, number]
  if (sector < 1) base = [c, x, 0]
  else if (sector < 2) base = [x, c, 0]
  else if (sector < 3) base = [0, c, x]
  else if (sector < 4) base = [0, x, c]
  else if (sector < 5) base = [x, 0, c]
  else base = [c, 0, x]
  const m = l - c / 2
  return { r: (base[0] + m) * 255, g: (base[1] + m) * 255, b: (base[2] + m) * 255 }
}

/** Cible AAA pour un texte d'accent ; le plancher AA est le filet de sécurité. */
export const RATIO_CIBLE_ACCENT = 7
export const RATIO_PLANCHER_ACCENT = 4.5

/**
 * Abaisse la luminance d'une couleur, à teinte et saturation CONSTANTES,
 * jusqu'à ce qu'elle franchisse `targetRatio` contre `background`.
 *
 * C'est le cœur de l'accessibilité du produit, et le raisonnement compte :
 * un assombrissement à taux fixe ne garantit rien — le même retrait de
 * luminance donne des ratios très différents selon la teinte — alors qu'un
 * abaissement PILOTÉ PAR LE RATIO garantit qu'aucun écosystème futur ne pourra
 * produire une page illisible, quelle que soit la couleur de marque confiée.
 *
 * `repli` est rendu quand la teinte est si claire qu'elle n'atteint jamais la
 * cible. Il est EXIGÉ, sans valeur par défaut : ce module ne contient aucune
 * couleur, et un défaut caché serait précisément le réglage invisible que
 * §E.11 condamne.
 */
export function deriveAccentColor(
  primaryColor: string,
  background: string,
  repli: string,
  targetRatio: number = RATIO_CIBLE_ACCENT,
): string {
  const rgb = parseHex(primaryColor)
  if (!rgb) return repli

  const normalized = toHex(rgb)
  if (contrastRatio(normalized, background) >= targetRatio) return normalized

  const hsl = rgbToHsl(rgb)
  let meilleur = repli
  for (let l = hsl.l; l >= 0.04; l -= 0.01) {
    const candidate = toHex(hslToRgb({ ...hsl, l }))
    const ratio = contrastRatio(candidate, background)
    if (ratio >= targetRatio) return candidate
    if (ratio >= RATIO_PLANCHER_ACCENT) meilleur = candidate
  }
  return meilleur
}

/**
 * Teinte très claire de la même couleur, pour un fond de pastille ou de badge.
 * Saturation plafonnée : une teinte pleine à 94 % de luminance vibre à l'écran.
 */
export function accentTint(accentColor: string, lightness = 0.94): string {
  const rgb = parseHex(accentColor)
  if (!rgb) return accentColor
  const hsl = rgbToHsl(rgb)
  return toHex(hslToRgb({ h: hsl.h, s: Math.min(hsl.s, 0.45), l: lightness }))
}

/** Variante plus dense, pour un état survolé ou pressé. */
export function accentStrong(accentColor: string, delta = 0.07): string {
  const rgb = parseHex(accentColor)
  if (!rgb) return accentColor
  const hsl = rgbToHsl(rgb)
  return toHex(hslToRgb({ ...hsl, l: Math.max(0.04, hsl.l - delta) }))
}
