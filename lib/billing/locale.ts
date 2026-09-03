import type { NextRequest } from 'next/server'
import { routing } from '@/i18n/routing'

/**
 * lib/billing/locale.ts — la langue du parcours de paiement.
 *
 * Stripe traduit lui-même ses écrans hébergés : lui passer la bonne langue
 * évite d'écrire la moindre clé i18n pour le tunnel de paiement, dans les
 * quatre langues du projet.
 *
 * Même logique que la locale de scoring IA des publications : en-tête explicite
 * `x-locale` d'abord (posé par le client), puis `Accept-Language`, puis le repli
 * projet. La liste des langues vient de `i18n/routing` — jamais recopiée : une
 * cinquième langue ajoutée là doit être comprise ici sans qu'on y touche.
 */

const LOCALES = routing.locales as readonly string[]

export type BillingLocale = (typeof routing.locales)[number]

export function localeFromRequest(request: NextRequest): BillingLocale {
  const explicit = request.headers.get('x-locale')?.trim().toLowerCase()
  if (explicit && LOCALES.includes(explicit)) return explicit as BillingLocale

  const first = (request.headers.get('accept-language') ?? '')
    .split(',')[0]
    ?.trim()
    .toLowerCase()
    .slice(0, 2)
  if (first && LOCALES.includes(first)) return first as BillingLocale

  return routing.defaultLocale
}

/** Locale d'une chaîne quelconque (paramètre d'URL), avec repli projet. */
export function normalizeLocale(raw: string | null | undefined): BillingLocale {
  const t = (raw ?? '').trim().toLowerCase()
  return LOCALES.includes(t) ? (t as BillingLocale) : routing.defaultLocale
}
