// lib/domain-config.ts
//
// Configuration de domaine + dérivation de la couleur d'accent.
//
// ACCENT : la plateforme est multi-écosystème (un sous-domaine = un écosystème).
// La couleur d'accent des surfaces publiques ne peut donc pas être une constante.
// Elle est résolue en deux temps, côté serveur uniquement :
//   1. `domain_configs.accent_color` si la marque de l'écosystème impose sa teinte
//      au pixel (migration 20260710000001_domain_accent_color.sql, colonne NULLABLE) ;
//   2. sinon, elle est DÉRIVÉE de `primary_color` en abaissant la luminance à
//      teinte et saturation constantes jusqu'à franchir un seuil de contraste WCAG
//      contre la surface publique.
//
// Le point 2 est ce qui rend la règle durable : un assombrissement à taux fixe ne
// garantit rien (le même retrait de luminance donne des ratios très différents
// selon la teinte), alors qu'un abaissement piloté par le ratio garantit qu'AUCUN
// écosystème futur ne pourra produire une page inaccessible, quelle que soit la
// couleur de marque qu'on lui confie.

export type DomainConfig = {
  id: string
  subdomain: string
  name: string
  ecosystemName: string
  tagline: string
  primaryColor: string
  secondaryColor: string
  /** Accent des surfaces publiques : override de marque, sinon dérivé de primaryColor. */
  accentColor: string
  logoUrl: string | null
  faviconUrl: string | null
  isActive: boolean
  tags: string[]
  ecosystemTerms: {
    expertLabel: string
    communityLabel: string
    specialityLabel: string
    domainSearchLabel: string
  }
  featuredProducts: Array<{ label: string; icon: string }>
}

/**
 * Surface des pages publiques. Chrome Skilloria : identique sur tous les
 * écosystèmes, donc constante légitime. Sert de référence au calcul de contraste.
 */
export const PUBLIC_SURFACE = '#FDFBF7'

/** Encre Skilloria. Chrome, identique sur tous les écosystèmes. */
export const PUBLIC_INK = '#1A1815'

/** Cible AAA pour le texte d'accent ; le plancher AA (4.5) est le filet de sécurité. */
const ACCENT_TARGET_RATIO = 7
const ACCENT_FLOOR_RATIO = 4.5

type Rgb = { r: number; g: number; b: number }
type Hsl = { h: number; s: number; l: number }

function parseHex(hex: string): Rgb | null {
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

function toHex({ r, g, b }: Rgb): string {
  const channel = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/** Luminance relative WCAG 2.1 (sRGB linéarisé). */
function relativeLuminance({ r, g, b }: Rgb): number {
  const linear = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** Ratio de contraste WCAG entre deux couleurs hexadécimales. */
export function contrastRatio(a: string, b: string): number {
  const rgbA = parseHex(a)
  const rgbB = parseHex(b)
  if (!rgbA || !rgbB) return 1
  const lumA = relativeLuminance(rgbA)
  const lumB = relativeLuminance(rgbB)
  const [high, low] = lumA >= lumB ? [lumA, lumB] : [lumB, lumA]
  return (high + 0.05) / (low + 0.05)
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
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

function hslToRgb({ h, s, l }: Hsl): Rgb {
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

/**
 * Dérive l'accent d'un écosystème depuis sa couleur primaire.
 *
 * Teinte et saturation sont conservées (l'accent reste reconnaissable comme la
 * couleur de la marque) ; seule la luminance descend, par pas de 1 %, jusqu'à ce
 * que le contraste contre `background` atteigne `targetRatio`.
 *
 * Exemple sur le domaine par défaut : #0ea5e9 contraste 2,68:1 sur #FDFBF7 —
 * illisible — et ressort à ~#085F87, 7:1, teinte inchangée (H≈199°).
 */
export function deriveAccentColor(
  primaryColor: string,
  background: string = PUBLIC_SURFACE,
  targetRatio: number = ACCENT_TARGET_RATIO,
): string {
  const rgb = parseHex(primaryColor)
  if (!rgb) return PUBLIC_INK

  const normalized = toHex(rgb)
  if (contrastRatio(normalized, background) >= targetRatio) return normalized

  const hsl = rgbToHsl(rgb)
  let fallback = PUBLIC_INK
  for (let l = hsl.l; l >= 0.04; l -= 0.01) {
    const candidate = toHex(hslToRgb({ ...hsl, l }))
    const ratio = contrastRatio(candidate, background)
    if (ratio >= targetRatio) return candidate
    if (ratio >= ACCENT_FLOOR_RATIO) fallback = candidate
  }
  // Teinte si claire qu'elle n'atteint jamais la cible : on garde le meilleur
  // candidat conforme AA, à défaut l'encre (toujours conforme).
  return fallback
}

/**
 * Teinte très claire du même accent, pour les fonds de pastilles et de badges.
 * Saturation plafonnée : une teinte pleine à 94 % de luminance vibre à l'écran.
 */
export function accentTint(accentColor: string, lightness = 0.94): string {
  const rgb = parseHex(accentColor)
  if (!rgb) return PUBLIC_SURFACE
  const hsl = rgbToHsl(rgb)
  return toHex(hslToRgb({ h: hsl.h, s: Math.min(hsl.s, 0.45), l: lightness }))
}

/** Variante plus dense de l'accent, pour les états survolés et pressés. */
export function accentStrong(accentColor: string, delta = 0.07): string {
  const rgb = parseHex(accentColor)
  if (!rgb) return PUBLIC_INK
  const hsl = rgbToHsl(rgb)
  return toHex(hslToRgb({ ...hsl, l: Math.max(0.04, hsl.l - delta) }))
}

/**
 * Résout l'accent d'un domaine : override de marque s'il existe, dérivation sinon.
 * Appelée exclusivement côté serveur (cf. getDomainConfig) — le client reçoit une
 * valeur déjà calculée et ne décide de rien.
 */
export function resolveAccentColor(
  primaryColor: string,
  accentOverride?: string | null,
): string {
  if (accentOverride && parseHex(accentOverride)) return toHex(parseHex(accentOverride)!)
  return deriveAccentColor(primaryColor)
}

const DEFAULT_PRIMARY = '#0ea5e9'

export const defaultDomainConfig: DomainConfig = {
  id: 'default',
  subdomain: 'microsoft',
  name: 'Skilloria 365',
  ecosystemName: 'Microsoft',
  tagline: 'For Microsoft Ecosystem Experts',
  primaryColor: DEFAULT_PRIMARY,
  secondaryColor: '#6366f1',
  accentColor: deriveAccentColor(DEFAULT_PRIMARY),
  logoUrl: null,
  faviconUrl: null,
  isActive: true,
  tags: ['Azure', 'Dynamics 365', 'Power Platform', 'Power BI', 'SharePoint', 'Teams', 'Microsoft 365', 'Copilot', 'Fabric', 'SQL Server'],
  ecosystemTerms: {
    expertLabel: 'experts Microsoft certifiés',
    communityLabel: 'écosystème Microsoft',
    specialityLabel: 'Spécialité Microsoft principale',
    domainSearchLabel: 'Domaine Microsoft recherché',
  },
  featuredProducts: [
    { label: 'Azure', icon: '☁️' },
    { label: 'Business Central', icon: '📊' },
    { label: 'Power BI', icon: '📈' },
    { label: 'Power Platform', icon: '⚡' },
    { label: 'D365 Finance & Ops', icon: '💼' },
    { label: 'SharePoint', icon: '🗂️' },
    { label: 'Copilot Studio', icon: '🤖' },
    { label: 'Azure DevOps', icon: '🔧' },
    { label: 'Dynamics CRM', icon: '🤝' },
    { label: 'Microsoft Fabric', icon: '🧵' },
  ],
}
