/**
 * lib/packages-display.ts — présentation PARTAGÉE du catalogue commerce.
 *
 * POURQUOI
 *   L'ordre des limites, leurs libellés humains et le résumé « 1 publication/
 *   mois · 1 candidat dévoilé… » vivaient recopiés dans TROIS écrans
 *   (/admin/packages, /admin/packages/new, /admin/packages/[id]). Les copies
 *   avaient déjà divergé : seule la liste savait libeller la cible
 *   'collaboration', la fiche affichait « Client » à sa place. Une seule
 *   source, importée partout.
 *
 * CE MODULE NE TRADUIT PAS : il renvoie des CLÉS i18n et des données
 * structurées. Chaque écran appelle son propre `t()` (next-intl typé), ce qui
 * évite de faire transiter un traducteur générique entre modules.
 *
 * AUCUN import : consommé par des composants client ('use client').
 */

/**
 * Les limites du catalogue, dans l'ORDRE d'affichage (formulaires et résumés).
 *  - `labelKey`   : libellé humain du champ  → `packages.<labelKey>`
 *  - `summaryKey` : forme courte pluralisée  → `packages.<summaryKey>`
 * Un code présent en base mais absent d'ici retombe sur le nom du dictionnaire
 * `features` — jamais sur le code brut snake_case.
 */
export const LIMIT_CODES: readonly { code: string; labelKey: string; summaryKey: string }[] = [
  {
    code: 'publications_per_month',
    labelKey: 'feature_label_publications_per_month',
    summaryKey: 'summary_publications',
  },
  {
    code: 'active_publications_max',
    labelKey: 'feature_label_active_publications_max',
    summaryKey: 'summary_active',
  },
  {
    code: 'revealed_candidates_per_publication',
    labelKey: 'feature_label_revealed_candidates_per_publication',
    summaryKey: 'summary_revealed',
  },
  {
    code: 'manual_unlocks_per_month',
    labelKey: 'feature_label_manual_unlocks_per_month',
    summaryKey: 'summary_unlocks',
  },
  { code: 'seats_max', labelKey: 'feature_label_seats_max', summaryKey: 'summary_seats' },
] as const

/** feature_code → clé i18n de libellé humain. */
export const FEATURE_LABEL_KEYS: Record<string, string> = Object.fromEntries(
  LIMIT_CODES.map((l) => [l.code, l.labelKey]),
)

/** Valeur de feature signifiant « pas de limite ». */
export const UNLIMITED = 'unlimited'

export function isUnlimitedValue(raw: string | null | undefined): boolean {
  return (raw ?? '').trim().toLowerCase() === UNLIMITED
}

/**
 * Clé i18n du libellé d'une cible commerciale.
 * `packages.target_client | target_cabinet | target_all | target_collaboration`.
 */
export function targetLabelKey(role: string): string {
  if (role === 'all') return 'target_all'
  if (role === 'collaboration') return 'target_collaboration'
  if (role === 'cabinet') return 'target_cabinet'
  return 'target_client'
}

export type PackageFeatureValue = { feature_code: string; value: string }

/**
 * Décompose les limites d'une offre pour le résumé court : les limites FINIES
 * dans l'ordre canonique, plus l'indication qu'au moins une est illimitée.
 * L'écran assemble ensuite « 2 publications/mois · 1 candidat dévoilé · … ».
 *
 * `parts` vide ⇒ tout est illimité (ou aucune limite déclarée).
 */
export function summarizeLimitParts(features: readonly PackageFeatureValue[]): {
  parts: { summaryKey: string; count: number }[]
  anyUnlimited: boolean
} {
  const byCode = new Map(features.map((f) => [f.feature_code, f.value]))
  const parts: { summaryKey: string; count: number }[] = []
  let anyUnlimited = false
  for (const { code, summaryKey } of LIMIT_CODES) {
    const raw = byCode.get(code)
    if (raw == null) continue
    if (isUnlimitedValue(raw)) {
      anyUnlimited = true
      continue
    }
    const n = parseInt(raw, 10)
    if (!Number.isFinite(n)) continue
    parts.push({ summaryKey, count: n })
  }
  return { parts, anyUnlimited }
}
