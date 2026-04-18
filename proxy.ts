 import { NextRequest, NextResponse } from 'next/server'

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

  // On transmet le sous-domaine via un header
  const response = NextResponse.next()
  response.headers.set('x-subdomain', subdomain)
  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
