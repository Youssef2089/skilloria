import type { Locale } from '@/i18n/routing'
import fr from '@/messages/fr.json'
import en from '@/messages/en.json'
import es from '@/messages/es.json'
import de from '@/messages/de.json'

/**
 * lib/notifications/inapp-labels.ts — libellés des notifications de la CLOCHE.
 *
 * POURQUOI CE MODULE
 *   Les titres et corps in-app étaient écrits EN DUR dans les routes, chacun
 *   avec sa propre table `Record<locale, string>` : `titlesByLocale` /
 *   `bodiesByLocale` dans /api/candidatures, `NOTIF_TITLE` / `notifBody` dans
 *   /api/conversations/[id]/messages. Violation de la règle i18n, et surtout :
 *   en créant les textes e-mail de ces MÊMES événements dans messages/*.json,
 *   on se serait retrouvé avec deux vocabulaires pour un seul événement, qui
 *   auraient divergé au premier ajustement de formulation.
 *
 *   Un événement, un vocabulaire, un endroit.
 *
 * Lecture directe des JSON (comme lib/emails/locales.ts et lib/sms/templates.ts)
 * : on est hors arbre React, donc pas de next-intl runtime.
 *
 * TEXTE BRUT, PAS DE HTML. Ces valeurs alimentent `notifications.title` /
 * `notifications.body`, rendues telles quelles par la cloche dans des nœuds
 * texte React — qui échappe. Pas d'échappement ici, contrairement aux e-mails.
 */

type InappRoot = {
  new_message: { title: string; body: string }
  new_candidature_received: { title: string; body: string }
}

const MESSAGES: Record<Locale, { notifications_inapp: InappRoot }> = {
  fr: fr as unknown as { notifications_inapp: InappRoot },
  en: en as unknown as { notifications_inapp: InappRoot },
  es: es as unknown as { notifications_inapp: InappRoot },
  de: de as unknown as { notifications_inapp: InappRoot },
}

export function resolveNotificationLocale(input: string | null | undefined): Locale {
  if (input === 'fr' || input === 'en' || input === 'es' || input === 'de') return input
  return 'fr'
}

function interpolate(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? '')
}

/** Longueur d'aperçu du message dans la cloche. Inchangée (comportement existant). */
const MESSAGE_PREVIEW_LEN = 80

export function newMessageInappLabels(
  localeRaw: string | null | undefined,
  senderName: string,
  content: string,
): { title: string; body: string } {
  const m = MESSAGES[resolveNotificationLocale(localeRaw)].notifications_inapp.new_message
  const preview =
    content.length > MESSAGE_PREVIEW_LEN ? `${content.slice(0, MESSAGE_PREVIEW_LEN)}…` : content
  return {
    title: m.title,
    body: interpolate(m.body, { senderName, preview }),
  }
}

export function newCandidatureInappLabels(
  localeRaw: string | null | undefined,
  publicationTitle: string,
): { title: string; body: string } {
  const m =
    MESSAGES[resolveNotificationLocale(localeRaw)].notifications_inapp.new_candidature_received
  return {
    title: m.title,
    body: interpolate(m.body, { title: publicationTitle }),
  }
}
