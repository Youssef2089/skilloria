import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const apiKey = process.env.VONAGE_API_KEY
  const apiSecret = process.env.VONAGE_API_SECRET
  if (!apiKey || !apiSecret) {
    console.error('[verify-phone-otp] VONAGE_API_KEY or VONAGE_API_SECRET missing')
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
    console.error('[verify-phone-otp] Vonage fetch threw', err)
    return json({ error: 'OTP provider unreachable', code: 'vonage_error' }, 502)
  }

  // Vonage Verify v2 : 200 = valid, 400 = invalid_code, 404/410 = expired/used
  if (res.status === 410 || res.status === 404) {
    return json({ error: 'OTP expired or already used', code: 'expired' }, 410)
  }
  if (res.status === 400) {
    return json({ error: 'Invalid OTP code', code: 'invalid_code' }, 400)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error('[verify-phone-otp] Vonage non-OK', { status: res.status, body: text.slice(0, 500) })
    return json({ error: 'OTP provider error', code: 'vonage_error' }, 502)
  }

  // Succès : on flip phone_verified et on stocke le phone (Q-B2.c.4)
  const { error: updErr } = await auth.supabaseAdmin
    .from('users')
    .update({ phone_verified: true, phone })
    .eq('id', auth.user.id)
  if (updErr) {
    console.error('[verify-phone-otp] users update failed', updErr.message)
    return json({ error: 'Could not update user', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.user.domain_id,
    action: 'phone_verified',
    entity_type: 'user',
    entity_id: auth.user.id,
    detail: { phone_e164: phone },
  })

  return json({ phone_verified: true }, 200)
}
