import createMiddleware from 'next-intl/middleware'
import { NextRequest } from 'next/server'
import { routing } from './i18n/routing'

const handleI18n = createMiddleware(routing)

export function proxy(request: NextRequest) {
  const hostname = request.headers.get('host') || ''

  // En local on simule le sous-domaine "microsoft"
  const isLocal = hostname.includes('localhost')

  let subdomain = 'microsoft' // valeur par défaut

  if (!isLocal) {
    // Ex: "microsoft.skilloria.io" → on extrait "microsoft"
    const parts = hostname.split('.')
    if (parts.length >= 3) {
      subdomain = parts[0]
    }
  }

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
