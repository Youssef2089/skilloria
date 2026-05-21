import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

/**
 * Helpers de gestion du token de session unique (11F).
 *
 * Cycle de vie :
 *   - Login réussi (côté client → appel /api/auth/init-session) :
 *     `generateSessionToken()` puis `setSessionToken(userId, token)` →
 *     pose le secret en BDD + Set-Cookie httpOnly côté navigateur.
 *   - Logout (côté client → /api/auth/logout) :
 *     `clearSessionToken(userId)` → vide BDD + invalide cookie.
 *   - À chaque requête authentifiée : auth-guard lit le cookie
 *     `ss_token` et compare avec `users.last_session_token`.
 *     Mismatch → 403 `session_superseded` (D2).
 *
 * Le token est un secret DISTINCT du JWT Supabase (access_token).
 * Génération : crypto.randomUUID() v4 (entropie 122 bits, suffisant
 * comme secret aléatoire opaque).
 *
 * Backward-compat (D4) : un user avec `last_session_token=NULL` passe
 * auth-guard sans erreur — il aura son token au prochain login.
 */

export const SESSION_COOKIE_NAME = 'ss_token'
const SESSION_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60 // 30 jours

/** Génère un nouveau session token cryptographiquement aléatoire. */
export function generateSessionToken(): string {
  return randomUUID()
}

/** UPDATE users SET last_session_token = <token>. Service-role obligatoire. */
export async function setSessionToken(args: {
  supabaseAdmin: SupabaseClient
  userId: string
  token: string
}): Promise<{ ok: boolean; error?: string }> {
  const { supabaseAdmin, userId, token } = args
  const { error } = await supabaseAdmin
    .from('users')
    .update({ last_session_token: token })
    .eq('id', userId)
  if (error) {
    console.error('[session-token] setSessionToken update failed', {
      userId,
      msg: error.message,
    })
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/** UPDATE users SET last_session_token = NULL. */
export async function clearSessionToken(args: {
  supabaseAdmin: SupabaseClient
  userId: string
}): Promise<{ ok: boolean; error?: string }> {
  const { supabaseAdmin, userId } = args
  const { error } = await supabaseAdmin
    .from('users')
    .update({ last_session_token: null })
    .eq('id', userId)
  if (error) {
    console.error('[session-token] clearSessionToken update failed', {
      userId,
      msg: error.message,
    })
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/**
 * Options du cookie de session — calculées dynamiquement à partir du host
 * de la requête (cf. correction utilisateur 11F : scope sur le domaine
 * parent en prod pour suivre l'user cross-subdomain).
 *
 * Règles :
 *   - Host se termine par `.skilloria.io` OU est `skilloria.io` →
 *     Domain=.skilloria.io (cookie partagé entre microsoft./sap./etc.)
 *   - Sinon (localhost, *.vercel.app preview, autre) → pas de Domain
 *     (cookie scope host courant)
 *   - Secure : true si le host n'est pas localhost (HTTP en local OK)
 */
export function buildSessionCookieOptions(request: NextRequest): {
  domain?: string
  secure: boolean
  sameSite: 'lax'
  httpOnly: true
  path: '/'
  maxAge: number
} {
  const host = (request.headers.get('host') ?? '').toLowerCase().split(':')[0]
  const isSkillariaProd = host === 'skilloria.io' || host.endsWith('.skilloria.io')
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')

  return {
    ...(isSkillariaProd ? { domain: '.skilloria.io' } : {}),
    secure: !isLocal,
    sameSite: 'lax',
    httpOnly: true,
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE_S,
  }
}

/** Sérialise les options en string `Set-Cookie` compatible RFC 6265. */
export function serializeSessionCookie(value: string, request: NextRequest): string {
  const opts = buildSessionCookieOptions(request)
  const parts: string[] = [`${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`]
  if (opts.domain) parts.push(`Domain=${opts.domain}`)
  parts.push(`Path=${opts.path}`)
  parts.push(`Max-Age=${opts.maxAge}`)
  parts.push(`SameSite=Lax`)
  parts.push(`HttpOnly`)
  if (opts.secure) parts.push(`Secure`)
  return parts.join('; ')
}

/** Sérialise un `Set-Cookie` qui INVALIDE le cookie (logout). */
export function serializeClearedSessionCookie(request: NextRequest): string {
  const opts = buildSessionCookieOptions(request)
  const parts: string[] = [`${SESSION_COOKIE_NAME}=`]
  if (opts.domain) parts.push(`Domain=${opts.domain}`)
  parts.push(`Path=${opts.path}`)
  parts.push(`Max-Age=0`)
  parts.push(`SameSite=Lax`)
  parts.push(`HttpOnly`)
  if (opts.secure) parts.push(`Secure`)
  return parts.join('; ')
}

/** Lecture du cookie ss_token depuis une NextRequest. */
export function readSessionCookieToken(request: NextRequest): string | null {
  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value
  return cookie && cookie.length > 0 ? cookie : null
}
