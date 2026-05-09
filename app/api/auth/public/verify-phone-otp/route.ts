import { NextRequest } from 'next/server'
import { signPhoneOtpToken } from '@/lib/phone-otp-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Variante PUBLIQUE de verify-phone-otp pour le flow d'inscription
 * organisation (B3.2). Pas de `requireAuth` car l'utilisateur n'existe
 * pas encore.
 *
 * Diff vs version privée :
 *   - Pas d'auth Bearer
 *   - Ne touche pas à `users.phone_verified` (pas de user encore)
 *   - Renvoie un `phone_otp_token` HMAC-SHA256 (TTL 15 min) que
 *     `register-org` validera avant la création du compte.
 *     Cf. lib/phone-otp-token.ts pour le format.
 */

const VONAGE_VERIFY_V2_BASE = 'https://api.nexmo.com/v2/verify'
const REQUEST_TIMEOUT_MS = 10_000

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type Body = { request_id?: unknown; code?: unknown; phone?: unknown }

export async function POST(request: NextRequest): Promise<Response> {
  const apiKey = process.env.VONAGE_API_KEY
  const apiSecret = process.env.VONAGE_API_SECRET
  if (!apiKey || !apiSecret) {
    console.error('[public/verify-phone-otp] VONAGE_API_KEY or VONAGE_API_SECRET missing')
    return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const request_id = typeof body.request_id === 'string' ? body.request_id.trim() : ''
  const code = typeof body.code === 'string' ? body.code.trim() : ''
  const phone = typeof body.phone === 'string' ? body.phone.trim() : ''

  if (!request_id || request_id.length > 200) {
    return json({ error: 'Invalid request_id', code: 'invalid_input' }, 400)
  }
  if (!/^\d{4,6}$/.test(code)) {
    return json({ error: 'Invalid OTP code', code: 'invalid_input' }, 400)
  }
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
    return json({ error: 'Invalid phone (E.164 expected)', code: 'invalid_phone' }, 400)
  }

  const basic = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')

  let res: Response
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    res = await fetch(`${VONAGE_VERIFY_V2_BASE}/${encodeURIComponent(request_id)}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ code }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
  } catch (err) {
    console.error('[public/verify-phone-otp] Vonage fetch threw', err)
    return json({ error: 'OTP provider unreachable', code: 'vonage_error' }, 502)
  }

  if (res.status === 410 || res.status === 404) {
    return json({ error: 'OTP expired or already used', code: 'expired' }, 410)
  }
  if (res.status === 400) {
    return json({ error: 'Invalid OTP code', code: 'invalid_code' }, 400)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error('[public/verify-phone-otp] Vonage non-OK', { status: res.status, body: text.slice(0, 500) })
    return json({ error: 'OTP provider error', code: 'vonage_error' }, 502)
  }

  let phone_otp_token: string
  try {
    phone_otp_token = signPhoneOtpToken({ phone, request_id })
  } catch (err) {
    console.error('[public/verify-phone-otp] signPhoneOtpToken failed', err)
    return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
  }

  return json({ phone_verified: true, phone_otp_token }, 200)
}
