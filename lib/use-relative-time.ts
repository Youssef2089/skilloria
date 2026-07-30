'use client'

import { useTranslations } from 'next-intl'

/**
 * useRelativeTime — formatage COMPACT et i18n du temps relatif (Phase 3b).
 *
 * Source unique consommée par NotificationBell, MissionCard, MessagesInbox,
 * CandidatureCard, CandidatureDetailPanel, AnnonceCard, freelance/mon-profil.
 * Remplace les 7 implémentations locales qui ne géraient que fr vs anglais
 * (es/de affichaient « just now »). Suffixes + « à l'instant » via le namespace
 * i18n `relative_time` (parité 4 langues).
 *
 * Rendu : « 3j » / « 2h » / « 5min » / « à l'instant » (selon la locale).
 */
export function useRelativeTime(): (iso: string | null | undefined) => string {
  const t = useTranslations('relative_time')
  return (iso) => {
    if (!iso) return ''
    const then = new Date(iso).getTime()
    if (Number.isNaN(then)) return ''
    const diffMs = Math.max(0, Date.now() - then)
    const sec = Math.round(diffMs / 1000)
    const min = Math.round(sec / 60)
    const hr = Math.round(min / 60)
    const day = Math.round(hr / 24)
    if (day >= 1) return `${day}${t('suffix_day')}`
    if (hr >= 1) return `${hr}${t('suffix_hour')}`
    if (min >= 1) return `${min}${t('suffix_minute')}`
    return t('now')
  }
}
