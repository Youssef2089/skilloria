import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID, createHash } from 'node:crypto'
import { domaineRacine } from '@/lib/subdomain'
import { regleCookieSession, type RegleCookieSession } from '@/lib/session-cookie'

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

const SESSION_COOKIE_BASE_NAME = 'ss_token'
const SESSION_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60 // 30 jours

/** La règle pour CET environnement, lue dans la configuration. */
function regleIci(host: string | null | undefined): RegleCookieSession {
  return regleCookieSession({ host, racine: domaineRacine(), environnement: process.env.VERCEL_ENV })
}

/**
 * Nom du cookie de session. Il N'EST PAS suffixé par écosystème, et c'est VOULU : `microsoft.` et `sap.`
 * partagent le même cookie — changer d'écosystème ne rappelle pas init-session.
 */
export function sessionCookieNameForHost(host: string | null | undefined): string {
  return regleIci(host).nom
}

export function getSessionCookieName(request: NextRequest): string {
  return sessionCookieNameForHost(request.headers.get('host'))
}

/** Re-export pour compat éventuelle (utilisé nulle part actuellement). */
export const SESSION_COOKIE_NAME = SESSION_COOKIE_BASE_NAME

/** Génère un nouveau session token cryptographiquement aléatoire. */
export function generateSessionToken(): string {
  return randomUUID()
}

/**
 * Hash sha256 (hex) du token de session (C2).
 *
 * Modèle de stockage : le COOKIE `ss_token` garde le token BRUT (il est déjà
 * HttpOnly/Secure, donc inaccessible au JS et hors-HTTPS) ; seule la valeur
 * stockée EN BASE (`users.last_session_token`) devient ce hash. Ainsi la
 * colonne est inexploitable même si elle est lue (l'event trigger
 * `ensure_rls` re-GRANT SELECT → un REVOKE ne tient pas ; le hash, lui, ne
 * permet pas de forger le cookie sans inverser sha256).
 *
 * sha256 NON salé est suffisant : le token est un `crypto.randomUUID()`
 * (~122 bits d'entropie), donc non brute-forçable / non dictionnable. NE PAS
 * utiliser bcrypt/argon2 ici (lents, inutiles pour un secret haute entropie,
 * et exécutés à chaque requête authentifiée).
 *
 * Source UNIQUE de vérité : écriture (setSessionToken), comparaison
 * (auth-guard) et lookup inversé (dashboard-routing-guard) passent tous par
 * cette fonction pour hasher l'entrée avant de toucher la BDD.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * UPDATE users SET last_session_token = sha256(<token>). Service-role
 * obligatoire. On reçoit le token BRUT et on stocke son HASH (cf.
 * hashSessionToken) : le cookie conserve le brut, la BDD le hash.
 */
export async function setSessionToken(args: {
  supabaseAdmin: SupabaseClient
  userId: string
  token: string
}): Promise<{ ok: boolean; error?: string }> {
  const { supabaseAdmin, userId, token } = args
  const { error } = await supabaseAdmin
    .from('users')
    .update({ last_session_token: hashSessionToken(token) })
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
 * Règles : celles de `regleCookieSession()` ci-dessus — la portée et `Secure` viennent de la
 * configuration de l'environnement, plus d'un hôte écrit dans le code.
 */
export function buildSessionCookieOptions(request: NextRequest): {
  domain?: string
  secure: boolean
  sameSite: 'lax'
  httpOnly: true
  path: '/'
  maxAge: number
} {
  const regle = regleIci(request.headers.get('host'))

  return {
    ...(regle.domaine ? { domain: regle.domaine } : {}),
    secure: regle.secure,
    sameSite: 'lax',
    httpOnly: true,
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE_S,
  }
}

/** Sérialise les options en string `Set-Cookie` compatible RFC 6265. */
export function serializeSessionCookie(value: string, request: NextRequest): string {
  const opts = buildSessionCookieOptions(request)
  const name = getSessionCookieName(request)
  const parts: string[] = [`${name}=${encodeURIComponent(value)}`]
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
  const name = getSessionCookieName(request)
  const parts: string[] = [`${name}=`]
  if (opts.domain) parts.push(`Domain=${opts.domain}`)
  parts.push(`Path=${opts.path}`)
  parts.push(`Max-Age=0`)
  parts.push(`SameSite=Lax`)
  parts.push(`HttpOnly`)
  if (opts.secure) parts.push(`Secure`)
  return parts.join('; ')
}

/** Lecture du cookie de session (nom suffixé selon env) depuis NextRequest. */
export function readSessionCookieToken(request: NextRequest): string | null {
  const name = getSessionCookieName(request)
  const cookie = request.cookies.get(name)?.value
  return cookie && cookie.length > 0 ? cookie : null
}
