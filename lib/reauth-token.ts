import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Token HMAC de RÉ-AUTHENTIFICATION (mission S3, Paramètres expert).
 *
 * Toute opération sensible (changement email / téléphone / mot de passe,
 * suppression du compte) exige que l'expert re-saisisse son mot de passe.
 * La route `POST /api/me/reauth` vérifie ce mot de passe CÔTÉ SERVEUR
 * (supabase.auth.signInWithPassword) puis signe ce token court (5 min).
 * Les routes sensibles exigent ensuite un token valide dans le header
 * `x-reauth-token` AVANT d'agir — non contournable par script/URL.
 *
 * Pourquoi un token HMAC stateless (et pas une colonne BDD) : même logique
 * que lib/phone-otp-token.ts — pas de table éphémère, signature vérifiable
 * sans I/O, durée de vie courte gravée dans le payload.
 *
 * Format : `<payload-base64url>.<signature-base64url>`
 *   payload = JSON({ uid, exp })
 *   exp     = unix-seconds (5 min par défaut)
 *
 * Le token est LIÉ à un user (`uid`) : un grant signé pour A ne peut pas
 * servir une action de B (la route sensible passe son propre auth.user.id
 * comme `expectedUid`).
 */

const DEFAULT_TTL_SECONDS = 5 * 60

export type ReauthTokenPayload = {
  uid: string
  exp: number
}

function getSecret(): string {
  const secret = process.env.REAUTH_HMAC_SECRET ?? process.env.SUPABASE_JWT_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('REAUTH_HMAC_SECRET (or SUPABASE_JWT_SECRET fallback) missing or too short')
  }
  return secret
}

function base64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

function sign(payloadB64: string, secret: string): string {
  return base64urlEncode(createHmac('sha256', secret).update(payloadB64).digest())
}

export function signReauthToken(args: { uid: string; ttlSeconds?: number }): string {
  const secret = getSecret()
  const exp = Math.floor(Date.now() / 1000) + (args.ttlSeconds ?? DEFAULT_TTL_SECONDS)
  const payload: ReauthTokenPayload = { uid: args.uid, exp }
  const payloadB64 = base64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'))
  const sig = sign(payloadB64, secret)
  return `${payloadB64}.${sig}`
}

export type ReauthTokenVerifyResult =
  | { ok: true; payload: ReauthTokenPayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'uid_mismatch' }

export function verifyReauthToken(token: string, expectedUid: string): ReauthTokenVerifyResult {
  if (typeof token !== 'string' || token.length === 0 || token.length > 2000) {
    return { ok: false, reason: 'malformed' }
  }
  const parts = token.split('.')
  if (parts.length !== 2) return { ok: false, reason: 'malformed' }

  const [payloadB64, sigB64] = parts
  const secret = getSecret()
  const expectedSig = sign(payloadB64, secret)

  const a = Buffer.from(sigB64, 'utf8')
  const b = Buffer.from(expectedSig, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' }
  }

  let payload: ReauthTokenPayload
  try {
    payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8')) as ReauthTokenPayload
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (typeof payload.uid !== 'string' || typeof payload.exp !== 'number') {
    return { ok: false, reason: 'malformed' }
  }
  if (payload.exp * 1000 < Date.now()) {
    return { ok: false, reason: 'expired' }
  }
  if (payload.uid !== expectedUid) {
    return { ok: false, reason: 'uid_mismatch' }
  }
  return { ok: true, payload }
}

/**
 * Garde réutilisable pour les routes sensibles : lit le header
 * `x-reauth-token`, le vérifie pour `expectedUid`. Retourne une Response
 * d'erreur (401 `reauth_required`) à renvoyer telle quelle si invalide,
 * ou null si OK (la route continue).
 */
export function requireReauth(request: Request, expectedUid: string): Response | null {
  const token = request.headers.get('x-reauth-token') ?? ''
  const res = verifyReauthToken(token, expectedUid)
  if (res.ok) return null
  return new Response(
    JSON.stringify({ error: 'Re-authentication required', code: 'reauth_required', reason: res.reason }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  )
}
