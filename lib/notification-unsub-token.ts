import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Token HMAC de DÉSABONNEMENT (D6) — lien one-click des emails de notification.
 *
 * Permet à /api/notifications/unsubscribe de désactiver `notify_match_email`
 * CÔTÉ SERVEUR sans authentification (bonne pratique : un lien de désabonnement
 * doit fonctionner sans re-login). La signature HMAC empêche de forger un lien
 * pour un autre utilisateur.
 *
 * Format identique à lib/phone-otp-token.ts : `<payload-b64url>.<sig-b64url>`.
 * Payload : { uid, p:'unsub-email', exp }. TTL long (180 j) car l'utilisateur
 * peut cliquer longtemps après réception.
 */

const DEFAULT_TTL_SECONDS = 180 * 24 * 60 * 60
const PURPOSE = 'unsub-email'

type UnsubTokenPayload = { uid: string; p: string; exp: number }

function getSecret(): string {
  const secret = process.env.REAUTH_HMAC_SECRET ?? process.env.SUPABASE_JWT_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('REAUTH_HMAC_SECRET (or SUPABASE_JWT_SECRET fallback) missing or too short')
  }
  return secret
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}
function sign(payloadB64: string, secret: string): string {
  return b64urlEncode(createHmac('sha256', secret).update(payloadB64).digest())
}

export function signUnsubToken(uid: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  const secret = getSecret()
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const payload: UnsubTokenPayload = { uid, p: PURPOSE, exp }
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `${payloadB64}.${sign(payloadB64, secret)}`
}

export type UnsubVerifyResult =
  | { ok: true; uid: string }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' }

export function verifyUnsubToken(token: string): UnsubVerifyResult {
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
  let payload: UnsubTokenPayload
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8')) as UnsubTokenPayload
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (typeof payload.uid !== 'string' || payload.p !== PURPOSE || typeof payload.exp !== 'number') {
    return { ok: false, reason: 'malformed' }
  }
  if (payload.exp * 1000 < Date.now()) return { ok: false, reason: 'expired' }
  return { ok: true, uid: payload.uid }
}
