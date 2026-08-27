import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Token HMAC de DÉSABONNEMENT (D6) — lien one-click des emails de notification.
 *
 * Permet à /api/notifications/unsubscribe de désactiver le canal e-mail
 * CÔTÉ SERVEUR sans authentification (bonne pratique : un lien de désabonnement
 * doit fonctionner sans re-login). La signature HMAC empêche de forger un lien
 * pour un autre utilisateur.
 *
 * Format identique à lib/phone-otp-token.ts : `<payload-b64url>.<sig-b64url>`.
 * Payload : { uid, p:'unsub-email', ev?, exp }. TTL long (180 j) car
 * l'utilisateur peut cliquer longtemps après réception.
 *
 * `ev` (événement) est OPTIONNEL — et doit le rester. Les liens déjà partis
 * dans des boîtes mail avant la généralisation ne le portent pas : ils
 * retombent sur 'new_match_opportunity', le seul événement qui existait alors.
 * Aucun lien envoyé ne cesse de fonctionner. La signature couvre le payload
 * entier, donc `ev` n'est pas forgeable.
 */

const DEFAULT_TTL_SECONDS = 180 * 24 * 60 * 60
const PURPOSE = 'unsub-email'

type UnsubTokenPayload = { uid: string; p: string; ev?: string; exp: number }

/** Événement visé par un token qui n'en porte pas (compat liens historiques). */
const LEGACY_EVENT = 'new_match_opportunity'

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

export function signUnsubToken(
  uid: string,
  event: string = LEGACY_EVENT,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
  const secret = getSecret()
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const payload: UnsubTokenPayload = { uid, p: PURPOSE, ev: event, exp }
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `${payloadB64}.${sign(payloadB64, secret)}`
}

export type UnsubVerifyResult =
  | { ok: true; uid: string; event: string }
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
  // `ev` absent ⇒ lien émis avant la généralisation : il ne pouvait viser que
  // les opportunités. Repli explicite, jamais un échec.
  return { ok: true, uid: payload.uid, event: typeof payload.ev === 'string' ? payload.ev : LEGACY_EVENT }
}
