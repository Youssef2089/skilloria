// scripts/lib/correspondance-couleurs.mjs
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ LES QUATRE-VINGTS TEINTES DU PRODUIT, ET LE JETON DE CHACUNE.            ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ┌─ CE QUE CE FICHIER EST, ET CE QU'IL N'EST PAS ──────────────────────────┐
// │ CE N'EST PAS UNE PALETTE. La palette vit dans `lib/palette.ts`, et c'est │
// │ le seul fichier d'interface autorisé à écrire une couleur (§D.12).      │
// │                                                                          │
// │ C'est un DICTIONNAIRE DE MIGRATION : il dit, pour chaque hexadécimal    │
// │ trouvé dans le produit au 21/09/2026, quel jeton porte la même          │
// │ intention. Il sert une fois par espace, puis il ne sert plus. Il est     │
// │ versionné parce qu'une correspondance décidée à la main doit pouvoir    │
// │ être relue, contestée et rejouée — pas refaite de mémoire à chaque lot.  │
// └──────────────────────────────────────────────────────────────────────────┘
//
// CE NE SONT PAS QUATRE-VINGTS INTENTIONS. C'est une palette d'outil — la
// gamme « ardoise » de Tailwind, plus ses rouges, ses verts, ses ambres et
// quelques bleus — posée écran par écran pendant des mois, sans que personne
// ne décide jamais qu'il y en aurait quatre-vingts.
//
// ⚠️ CE QU'UNE CORRESPONDANCE MÉCANIQUE NE DÉCIDE PAS.
//    `#94a3b8` devient `--sk-faint` parce que c'est LA MÊME COULEUR. Mais
//    `--sk-faint` vaut **3,63** de contraste, et §D.12 lui interdit de porter
//    une information. La conversion préserve l'apparence ; elle ne dit rien de
//    ce que le texte raconte. Les usages se relisent APRÈS, un par un — c'est
//    une lecture humaine, et il n'y a pas de raccourci (§E.38).

/**
 * hexadécimal (minuscules) → nom de jeton `--sk-*`.
 *
 * Regroupé par intention, avec la famille d'origine entre parenthèses, pour
 * qu'une correspondance contestable se voie au premier coup d'œil.
 */
export const CORRESPONDANCE = {
  // ── SURFACES ────────────────────────────────────────────────────────────
  '#fff': 'surface',
  '#ffffff': 'surface',
  '#f8fafc': 'surface-2',   // ardoise 50
  '#f1f5f9': 'surface-2',   // ardoise 100
  '#eef2f6': 'surface-2',
  '#eef2f7': 'surface-2',

  // ── TEXTE ───────────────────────────────────────────────────────────────
  '#0f172a': 'text',        // ardoise 900
  '#1e293b': 'text',        // ardoise 800
  '#334155': 'text',        // ardoise 700
  '#374151': 'text',        // gris 700
  '#475569': 'muted',       // ardoise 600
  '#64748b': 'muted',       // ardoise 500
  '#94a3b8': 'faint',       // ardoise 400  ⚠️ voir l'avertissement en tête
  '#cbd5e1': 'faint',       // ardoise 300

  // ── BORDURES ────────────────────────────────────────────────────────────
  '#e2e8f0': 'border',      // ardoise 200
  '#e5e7eb': 'border',      // gris 200

  // ── ERREUR ──────────────────────────────────────────────────────────────
  '#7f1d1d': 'red',
  '#991b1b': 'red',
  '#b91c1c': 'red',
  '#dc2626': 'red',
  '#fca5a5': 'red-soft',
  '#fecaca': 'red-soft',
  '#fee2e2': 'red-soft',
  '#fef2f2': 'red-soft',
  '#fff7f7': 'red-soft',

  // ── SUCCÈS ──────────────────────────────────────────────────────────────
  '#14532d': 'success',
  '#166534': 'success',
  '#15803d': 'success',
  '#16a34a': 'success',
  '#059669': 'success',
  '#065f46': 'success',
  '#86efac': 'success-soft',
  '#a7f3d0': 'success-soft',
  '#bbf7d0': 'success-soft',
  '#dcfce7': 'success-soft',
  '#ecfdf5': 'success-soft',
  '#f0fdf4': 'success-soft',

  // ── AVERTISSEMENT ───────────────────────────────────────────────────────
  '#713f12': 'amber',
  '#78350f': 'amber',
  '#854d0e': 'amber',
  '#92400e': 'amber',
  '#a16207': 'amber',
  '#b45309': 'amber',
  '#ca8a04': 'amber',
  '#d97706': 'amber',
  '#ea580c': 'amber',
  '#f59e0b': 'amber',
  '#fcd34d': 'amber-soft',
  '#fde047': 'amber-soft',
  '#fde68a': 'amber-soft',
  '#fed7aa': 'amber-soft',
  '#fef3c7': 'amber-soft',
  '#fef9c3': 'amber-soft',
  '#fefce8': 'amber-soft',
  '#fffbeb': 'amber-soft',
  '#fff7ed': 'amber-soft',

  // ── ACCENT ──────────────────────────────────────────────────────────────
  //  Tous les bleus du produit — l'ancienne marque (#00b9ff), le bleu de
  //  Tailwind, l'indigo, le cyan. Ils disaient tous « c'est cliquable » ou
  //  « c'est de l'information ». C'est ce que l'accent dit, et il est réglable
  //  par écosystème — c'était précisément le point du lot palette.
  '#00b9ff': 'accent',
  '#0078d4': 'accent',
  '#005a9e': 'accent',
  '#0ea5e9': 'accent',
  '#0369a1': 'accent',
  '#0c4a6e': 'accent',
  '#155e75': 'accent',
  '#1e3a5f': 'accent',
  '#1e3a8a': 'accent',
  '#1e40af': 'accent',
  '#2563eb': 'accent',
  '#3730a3': 'accent',
  '#5b21b6': 'accent',
  '#7dd3fc': 'accent-soft',
  '#bae6fd': 'accent-soft',
  '#bfdbfe': 'accent-soft',
  '#c7d2fe': 'accent-soft',
  '#dbeafe': 'accent-soft',
  '#ecfeff': 'accent-soft',
  '#ede9fe': 'accent-soft',
  '#eef2ff': 'accent-soft',
  '#eff6ff': 'accent-soft',
  '#f0f9ff': 'accent-soft',
}

/**
 * LES SUFFIXES D'OPACITÉ COLLÉS, QU'IL FAUT TRAITER AVANT LE RESTE.
 *
 * `#dcfce730` est un hexadécimal à HUIT chiffres : six de couleur, deux
 * d'opacité. Le convertir en `var(--sk-success-soft)30` produirait très
 * exactement le piège §E.50 — un suffixe collé à un jeton, que le navigateur
 * ignore SANS RIEN DIRE. On écrit un `color-mix`.
 */
export const AVEC_OPACITE = /#([0-9a-fA-F]{6})([0-9a-fA-F]{2})\b/g

/** Les six chiffres → le jeton, ou `null` si la teinte n'est pas connue. */
export function jetonDe(hex) {
  const t = hex.toLowerCase()
  return CORRESPONDANCE[t] ?? null
}
