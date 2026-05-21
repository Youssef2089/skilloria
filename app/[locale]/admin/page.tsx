import { redirect } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'

/**
 * /admin → redirection SERVEUR vers /admin/organisations (B5c).
 *
 * Pas de 'use client' : Server Component → redirect() de next-intl côté
 * serveur. Locale préservée (param explicite). Pas de flash de loading
 * (contrairement à un router.replace côté client).
 *
 * NB : la garde admin est faite dans `app/[locale]/admin/layout.tsx`. Une
 * fois redirigé vers /admin/organisations, le layout vérifie le user_type
 * et bascule sur /connexion ou / si pas admin.
 */
export default async function AdminIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  redirect({ href: '/admin/organisations', locale: locale as Locale })
}
