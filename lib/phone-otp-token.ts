import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Token HMAC pour attester qu'un OTP téléphone a été vérifié côté serveur
 * pendant le flow d'inscription publique.
 *
 * Pourquoi pas une DB / pourquoi pas re-call Vonage :
 *   - Vonage Verify v2 ne propose pas d'endpoint GET pour récupérer le statut
 *     d'un `request_id` après un POST de code réussi (la session est consommée).
 *   - Pas de table BDD éphémère introduite en B3.2 (spec : 0 modif BDD).
 *
 * Solution : la route `/api/auth/public/verify-phone-otp` signe un token
 * HMAC-SHA256 contenant `{phone, request_id, exp}` après succès Vonage.
 * `register-org` valide la signature + l'expiration + le téléphone match.
 *
 * Format du token : `<payload-base64url>.<signature-base64url>`
 *   payload = JSON({ phone, request_id, exp })
 *   exp     = unix-seconds (15 min par défaut)
 */

const DEFAULT_TTL_SECONDS = 15 * 60

export type PhoneOtpTokenPayload = {
  phone: string
  request_id: string
  exp: number
}

function getSecret(): string {
  const secret = process.env.PHONE_OTP_HMAC_SECRET ?? process.env.SUPABASE_JWT_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('PHONE_OTP_HMAC_SECRET (or SUPABASE_JWT_SECRET fallback) missing or too short')
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

export function signPhoneOtpToken(args: { phone: string; request_id: string; ttlSeconds?: number }): string {
  const secret = getSecret()
  const exp = Math.floor(Date.now() / 1000) + (args.ttlSeconds ?? DEFAULT_TTL_SECONDS)
  const payload: PhoneOtpTokenPayload = { phone: args.phone, request_id: args.request_id, exp }
  const payloadB64 = base64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'))
  const sig = sign(payloadB64, secret)
  return `${payloadB64}.${sig}`
}

export type PhoneOtpTokenVerifyResult =
  | { ok: true; payload: PhoneOtpTokenPayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'phone_mismatch' }

export function verifyPhoneOtpToken(token: string, expectedPhone: string): PhoneOtpTokenVerifyResult {
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

  let payload: PhoneOtpTokenPayload
  try {
    payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8')) as PhoneOtpTokenPayload
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (
    typeof payload.phone !== 'string' ||
    typeof payload.request_id !== 'string' ||
    typeof payload.exp !== 'number'
  ) {
    return { ok: false, reason: 'malformed' }
  }
  if (payload.exp * 1000 < Date.now()) {
    return { ok: false, reason: 'expired' }
  }
  if (payload.phone !== expectedPhone) {
    return { ok: false, reason: 'phone_mismatch' }
  }
  return { ok: true, payload }
}
