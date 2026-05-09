import { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Variante PUBLIQUE de send-phone-otp pour le flow d'inscription
 * organisation (B3.2). Pas de `requireAuth` car l'utilisateur n'existe
 * pas encore.
 *
 * Anti-abus :
 *   - rate limit best-effort par IP (Map en mémoire process, fenêtre 60s)
 *   - le cooldown 60s côté UI sert également de filet
 *
 * NB : on ne stocke aucun état serveur — le couple (request_id, phone)
 * sera scellé par HMAC après vérif réussie (cf. verify-phone-otp + lib/phone-otp-token.ts).
 */

const VONAGE_VERIFY_V2_BASE = 'https://api.nexmo.com/v2/verify'
const REQUEST_TIMEOUT_MS = 10_000
const BRAND_NAME = 'Skilloria'
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 3 // 3 SMS / minute / IP

// Vonage request_id : UUIDv4 sans tirets selon doc, mais on tolère un peu
// plus large pour être robuste. On exige uniquement des caractères safe-URL
// pour éviter toute tentative d'injection dans le path DELETE.
const VONAGE_REQUEST_ID_REGEX = /^[A-Za-z0-9_-]{8,80}$/

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function rateLimitOk(ip: string): boolean {
  const now = Date.now()
  const rec = rateLimitMap.get(ip)
  if (!rec || rec.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (rec.count >= RATE_LIMIT_MAX) return false
  rec.count += 1
  return true
}

function clientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return request.headers.get('x-real-ip') ?? 'unknown'
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type Body = { phone?: unknown; previous_request_id?: unknown }

export async function POST(request: NextRequest): Promise<Response> {
  const apiKey = process.env.VONAGE_API_KEY
  const apiSecret = process.env.VONAGE_API_SECRET
  if (!apiKey || !apiSecret) {
    console.error('[public/send-phone-otp] VONAGE_API_KEY or VONAGE_API_SECRET missing')
    return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
  }

  const ip = clientIp(request)
  if (!rateLimitOk(ip)) {
    return json({ error: 'Too many requests', code: 'rate_limited' }, 429)
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
  const phoneVonage = phone.slice(1)

  const previousRequestIdRaw = typeof body.previous_request_id === 'string'
    ? body.previous_request_id.trim()
    : ''
  const previousRequestId = VONAGE_REQUEST_ID_REGEX.test(previousRequestIdRaw)
    ? previousRequestIdRaw
    : null

  const basic = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')

  // Annulation silencieuse de la session précédente (B3.2.fix2).
  //
  // Vonage Verify v2 garde une session active ~5 min sur un numéro après un
  // POST /v2/verify (même si l'user a saisi un mauvais code). Sans annulation,
  // un nouveau POST /v2/verify retourne 409 "Concurrent verifications to the
  // same number are not allowed" → l'user voit "Service SMS indisponible".
  //
  // DELETE /v2/verify/{request_id} :
  //   - 204 : annulé
  //   - 404 : session déjà expirée → on continue
  //   - 4xx (notamment <30s post-création) : on log + on continue
  //
  // Doc : https://developer.vonage.com/en/api/verify.v2
  if (previousRequestId) {
    try {
      const cancelCtrl = new AbortController()
      const cancelTimeout = setTimeout(() => cancelCtrl.abort(), REQUEST_TIMEOUT_MS)
      const cancelRes = await fetch(
        `${VONAGE_VERIFY_V2_BASE}/${encodeURIComponent(previousRequestId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Basic ${basic}` },
          signal: cancelCtrl.signal,
        },
      )
      clearTimeout(cancelTimeout)
      if (!cancelRes.ok && cancelRes.status !== 404) {
        console.warn(
          '[public/send-phone-otp] cancel previous request failed',
          cancelRes.status,
        )
      }
    } catch (err) {
      console.warn('[public/send-phone-otp] cancel previous request threw', err)
    }
  }

  let res: Response
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    res = await fetch(VONAGE_VERIFY_V2_BASE, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        brand: BRAND_NAME,
        // Vonage Verify v2 : par défaut 4 chiffres, on force 6 pour
        // correspondre aux 6 cases du front (cf. inscription/organisation/page.tsx).
        // Doc : https://developer.vonage.com/en/api/verify.v2 — placement racine.
        code_length: 6,
        workflow: [{ channel: 'sms', to: phoneVonage }],
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
  } catch (err) {
    console.error('[public/send-phone-otp] Vonage fetch threw', err)
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
    console.error('[public/send-phone-otp] Vonage non-OK', { status: res.status, payload })
    return json({ error: 'OTP provider error', code: 'vonage_error' }, 502)
  }

  return json({ request_id: payload.request_id }, 200)
}
