import createMiddleware from 'next-intl/middleware'
import { NextRequest } from 'next/server'
import { routing } from './i18n/routing'
import { resolveSubdomainFromHost } from './lib/subdomain'

const handleI18n = createMiddleware(routing)

export function proxy(request: NextRequest) {
  // Résolution mutualisée avec les routes /api publiques (lib/subdomain.ts) :
  // dev → DEV_DOMAIN_SLUG, prod → 1er label du host. Aucun slug figé en dur.
  // Hôte non résolvable → null : x-subdomain vide, getDomainConfig retombera sur
  // le repli NEUTRE (defaultDomainConfig, sans écosystème). En dev sans
  // DEV_DOMAIN_SLUG, resolveSubdomainFromHost lève une erreur actionnable.
  const subdomain = resolveSubdomainFromHost(request.headers.get('host')) ?? ''

  // Injecte x-subdomain sur les headers de requête AVANT next-intl.
  // next-intl copie request.headers via `new Headers(request.headers)` dans son
  // NextResponse.next({ request: { headers } }), donc x-subdomain est transmis
  // aux Server Components (lecture via next/headers) avec la locale.
  request.headers.set('x-subdomain', subdomain)
  // Injecte x-pathname pour la garde routing par rôle du dashboard
  // (cf. app/[locale]/dashboard/layout.tsx). Le pathname n'est pas
  // exposé nativement aux Server Components — middleware = seule façon
  // propre de le passer en aval.
  request.headers.set('x-pathname', request.nextUrl.pathname)

  return handleI18n(request)
}

export const config = {
  matcher: [
    // Toutes les routes sauf assets, favicon et /api
    '/((?!_next/static|_next/image|favicon.ico|api).*)',
  ],
}
