import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { requireReauth } from '@/lib/reauth-token'
import { checkRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VONAGE_VERIFY_V2_ENDPOINT = 'https://api.nexmo.com/v2/verify'
const REQUEST_TIMEOUT_MS = 10_000
const BRAND_NAME = 'Skilloria'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type Body = { phone?: unknown }

export async function POST(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  // Mission S3 — changement de téléphone en Paramètres : ré-auth EXIGÉE sur le
  // déclencheur (envoi du SMS). Le verify est ensuite protégé par la possession
  // de l'OTP + le request_id issu de CE send ré-authentifié. Additif : aucune
  // autre route n'appelle ce endpoint, l'inscription utilise /public/*.
  const reauthFail = requireReauth(request, auth.user.id)
  if (reauthFail) return reauthFail

  const apiKey = process.env.VONAGE_API_KEY
  const apiSecret = process.env.VONAGE_API_SECRET
  if (!apiKey || !apiSecret) {
    console.error('[send-phone-otp] VONAGE_API_KEY or VONAGE_API_SECRET missing')
    return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
    return json({ error: 'Invalid phone (E.164 expected)', code: 'invalid_phone' }, 400)
  }
  // Vonage attend le numéro SANS le `+` (E.164 sans le préfixe)
  const phoneVonage = phone.slice(1)

  // Rate-limit serveur/DB par téléphone (clé principale, hachée), AVANT l'envoi
  // Vonage : anti SMS-pumping. 1/60s ET 5/3600s. Fail-open (cf. lib/rate-limit.ts).
  if (!(await checkRateLimit(auth.supabaseAdmin, 'otp_send_60s', phone, 60, 1))) {
    return json({ error: 'Too many requests', code: 'rate_limited', retry_after_seconds: 60 }, 429)
  }
  if (!(await checkRateLimit(auth.supabaseAdmin, 'otp_send_1h', phone, 3600, 5))) {
    return json({ error: 'Too many requests', code: 'rate_limited', retry_after_seconds: 3600 }, 429)
  }

  const basic = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')

  let res: Response
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    res = await fetch(VONAGE_VERIFY_V2_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        brand: BRAND_NAME,
        workflow: [{ channel: 'sms', to: phoneVonage }],
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
  } catch (err) {
    console.error('[send-phone-otp] Vonage fetch threw', err)
    return json({ error: 'OTP provider unreachable', code: 'vonage_error' }, 502)
  }

  const payload = (await res.json().catch(() => null)) as
    | { request_id?: string; title?: string; detail?: string }
    | null

  if (res.status === 429) {
    return json({ error: 'Too many requests', code: 'rate_limited' }, 429)
  }
  if (res.status === 422 || res.status === 400) {
    return json(
      {
        error: payload?.detail ?? 'Vonage rejected the request',
        code: 'vonage_invalid_request',
      },
      400,
    )
  }
  if (!res.ok || !payload?.request_id) {
    console.error('[send-phone-otp] Vonage non-OK', { status: res.status, payload })
    return json({ error: 'OTP provider error', code: 'vonage_error' }, 502)
  }

  return json({ request_id: payload.request_id }, 200)
}
