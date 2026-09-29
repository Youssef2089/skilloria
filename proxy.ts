import createMiddleware from 'next-intl/middleware'
import { NextRequest } from 'next/server'
import { routing } from './i18n/routing'
import { resolveSubdomainFromHost } from './lib/subdomain'

const handleI18n = createMiddleware(routing)

export function proxy(request: NextRequest) {
  // LA CONFIGURATION EST VÉRIFIÉE ICI, À CHAQUE PAGE : localhost → DEV_DOMAIN_SLUG ; production
  // ET staging → `<écosystème>.<racine>`, la racine venant de NEXT_PUBLIC_DOMAINE_RACINE (§E.83).
  // Une configuration absente LÈVE une erreur actionnable : ce n'est pas « aucun écosystème ».
  //
  // ⚠️ LE PROXY N'INJECTE PLUS `x-subdomain` (§E.85, 29/09/2026). Chaque lecteur — pages,
  //    gardes, routes — relit l'ADRESSE par `sousDomaineDeLaRequete` (lib/subdomain.ts). Un
  //    en-tête nommé `x-subdomain` n'est plus lu nulle part : ni le proxy ni le navigateur
  //    n'ont à en transporter une copie.
  resolveSubdomainFromHost(request.headers.get('host'))
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
