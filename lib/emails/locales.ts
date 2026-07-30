import type { Locale } from '@/i18n/routing'
import { escapeHtml } from './escape'

import fr from '@/messages/fr.json'
import en from '@/messages/en.json'
import es from '@/messages/es.json'
import de from '@/messages/de.json'

/**
 * Accès aux traductions des emails côté serveur.
 *
 * Pourquoi pas `next-intl` ici : les emails sont rendus depuis des routes
 * API (pas un composant React + RequestProvider). On lit donc directement
 * les fichiers JSON par locale. Cohérent avec le pattern recommandé par
 * next-intl pour les usages "hors React tree".
 */

type EmailsRoot = {
  common_footer: string
  common_signature: string
  common_login_cta: string
  welcome: {
    subject: string
    preheader: string
    title: string
    hello: string
    body_p1: string
    body_p2: string
    cta_label: string
  }
  reject: {
    subject: string
    preheader: string
    title: string
    hello: string
    body_p1: string
    body_with_reason_p2: string
    body_p3: string
    cta_label: string
  }
  expert_welcome: {
    subject: string
    preheader: string
    title: string
    hello: string
    body_p1: string
    body_p2: string
    cta_label: string
  }
  expert_reject: {
    subject: string
    preheader: string
    title: string
    hello: string
    body_p1: string
    body_with_reason_p2: string
    body_p3: string
    cta_label: string
  }
  invitation: {
    subject: string
    preheader: string
    title: string
    hello: string
    body_p1: string
    body_role: string
    body_domain_warning: string
    body_expires: string
    cta_label: string
  }
  inactivity_warning: {
    subject: string
    preheader: string
    title: string
    hello: string
    body_p1: string
    body_p2: string
    cta_label: string
  }
  match_digest: {
    subject_one: string
    subject_other: string
    preheader: string
    title: string
    hello: string
    intro_one: string
    intro_other: string
    cta_label: string
    unsubscribe: string
  }
}

const MESSAGES: Record<Locale, { emails: EmailsRoot }> = {
  fr: fr as unknown as { emails: EmailsRoot },
  en: en as unknown as { emails: EmailsRoot },
  es: es as unknown as { emails: EmailsRoot },
  de: de as unknown as { emails: EmailsRoot },
}

/** Résout une locale arbitraire (string | null) en Locale typée avec fallback 'fr'. */
export function resolveLocale(input: string | null | undefined): Locale {
  if (input === 'fr' || input === 'en' || input === 'es' || input === 'de') return input
  return 'fr'
}

/** Récupère le namespace `emails` pour une locale donnée. */
export function getEmailMessages(locale: Locale): EmailsRoot {
  return MESSAGES[locale].emails
}

/**
 * Substitution simple `{key}` par params[key]. Aucune dépendance ICU pour les emails.
 *
 * Sécurité (E1) : chaque VALEUR injectée est échappée via `escapeHtml` (point
 * unique, non contournable). Le TEMPLATE n'est jamais échappé — il contient du
 * HTML légitime (ex. `<strong>{companyName}</strong>`) qui doit rester intact.
 * Seule la valeur substituée l'est. La version texte des emails reste correcte
 * car `stripHtml` redécode le même jeu d'entités.
 */
export function interpolate(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => escapeHtml(params[key] ?? ''))
}

export type { EmailsRoot, Locale }
