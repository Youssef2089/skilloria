import { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/public/cancel-phone-otp  { request_id }
 *
 * Abandon BEST-EFFORT d'une session Vonage Verify v2 quand l'utilisateur clique
 * « Modifier le numéro » (D4). Publique (pré-auth), sans effet de bord serveur :
 * elle ne fait qu'un DELETE /v2/verify/{request_id} vers Vonage.
 *
 * JAMAIS bloquante : toute erreur (env manquant, 4xx, réseau) → 200 { ok:true }.
 * Le nettoyage réel de la session est de toute façon re-tenté par
 * send-phone-otp (previous_request_id) au prochain envoi.
 */

const VONAGE_VERIFY_V2_BASE = 'https://api.nexmo.com/v2/verify'
const REQUEST_TIMEOUT_MS = 10_000
// Même contrainte que send-phone-otp : caractères safe-URL uniquement (anti-injection dans le path).
const VONAGE_REQUEST_ID_REGEX = /^[A-Za-z0-9_-]{8,80}$/

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  let requestId: string | null = null
  try {
    const body = (await request.json()) as { request_id?: unknown }
    const raw = typeof body.request_id === 'string' ? body.request_id.trim() : ''
    requestId = VONAGE_REQUEST_ID_REGEX.test(raw) ? raw : null
  } catch {
    // Corps illisible → rien à annuler, best-effort.
    return json({ ok: true })
  }

  const apiKey = process.env.VONAGE_API_KEY
  const apiSecret = process.env.VONAGE_API_SECRET
  if (!requestId || !apiKey || !apiSecret) {
    return json({ ok: true })
  }

  try {
    const basic = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
    const res = await fetch(`${VONAGE_VERIFY_V2_BASE}/${encodeURIComponent(requestId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Basic ${basic}` },
      signal: ctrl.signal,
    })
    clearTimeout(timeout)
    if (!res.ok && res.status !== 404) {
      console.warn('[public/cancel-phone-otp] DELETE non-OK', res.status)
    }
  } catch (err) {
    console.warn('[public/cancel-phone-otp] DELETE threw', err)
  }
  return json({ ok: true })
}
