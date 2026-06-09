/**
 * relativeTimeFromNow — temps relatif localisé natif (FR/EN/ES/DE) via
 * Intl.RelativeTimeFormat, style 'short' (compact pour les lignes meta).
 *
 * Source unique : à terme, remplace les copies inline de `relativeFromNow`
 * dispersées dans les cartes (refacto finitions, hors-scope ici).
 *
 * Retourne null si la date est absente/invalide (l'appelant masque alors).
 * Ex. (fr) : "il y a 3 j", "hier", "il y a 2 h". (en) : "3 days ago", "now".
 */

const DIVISIONS: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
]

export function relativeTimeFromNow(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  let duration = (then - Date.now()) / 1000 // secondes, négatif = passé

  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return rtf.format(Math.round(duration), division.unit)
    }
    duration /= division.amount
  }
  return null
}
