import type { Locale } from '@/i18n/routing'
import fr from '@/messages/fr.json'
import en from '@/messages/en.json'
import es from '@/messages/es.json'
import de from '@/messages/de.json'

/**
 * Gabarits SMS (serveur) — envoyés dans la langue de l'expert (users.locale).
 *
 * Lecture directe des JSON de messages (comme lib/emails/locales.ts) : on est
 * hors arbre React (route cron), donc pas de next-intl runtime. Texte COURT
 * (un SMS = 160 caractères GSM-7 ; au-delà Vonage segmente). Pas d'échappement
 * HTML : un SMS est du texte brut.
 */

type SmsRoot = {
  match_digest: {
    one: string
    other: string
  }
}

const MESSAGES: Record<Locale, { sms_notifications: SmsRoot }> = {
  fr: fr as unknown as { sms_notifications: SmsRoot },
  en: en as unknown as { sms_notifications: SmsRoot },
  es: es as unknown as { sms_notifications: SmsRoot },
  de: de as unknown as { sms_notifications: SmsRoot },
}

function resolveLocale(input: string | null | undefined): Locale {
  if (input === 'fr' || input === 'en' || input === 'es' || input === 'de') return input
  return 'fr'
}

/** Substitution `{key}` sans échappement (texte brut). */
function interpolate(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? '')
}

export type MatchDigestSmsParams = {
  locale: string | null | undefined
  count: number
  /** Nom de la plateforme issu de la config de domaine (jamais figé). */
  platform: string
  /** Lien (court) vers la liste des opportunités. */
  link: string
}

/** Construit le texte du SMS agrégé « X nouvelles missions … sur {platform} ». */
export function renderMatchDigestSms(params: MatchDigestSmsParams): string {
  const locale = resolveLocale(params.locale)
  const m = MESSAGES[locale].sms_notifications.match_digest
  const template = params.count <= 1 ? m.one : m.other
  return interpolate(template, {
    count: String(params.count),
    platform: params.platform,
    link: params.link,
  })
}
