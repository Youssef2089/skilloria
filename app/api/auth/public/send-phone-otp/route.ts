import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, extractClientIp } from '@/lib/rate-limit'
import { normalizeE164 } from '@/lib/phone'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Variante PUBLIQUE de send-phone-otp pour le flow d'inscription
 * organisation (B3.2). Pas de `requireAuth` car l'utilisateur n'existe
 * pas encore.
 *
 * Anti-abus (M1) :
 *   - rate limit serveur/DB atomique par téléphone (non contournable) :
 *     1 SMS / 60s ET 5 SMS / 3600s (cf. lib/rate-limit.ts + migration rate_limiter).
 *   - le cooldown 60s côté UI sert de filet complémentaire.
 *
 * NB : on ne stocke aucun état de session — le couple (request_id, phone)
 * sera scellé par HMAC après vérif réussie (cf. verify-phone-otp + lib/phone-otp-token.ts).
 */

const VONAGE_VERIFY_V2_BASE = 'https://api.nexmo.com/v2/verify'
const REQUEST_TIMEOUT_MS = 10_000
const BRAND_NAME = 'Skilloria'

// Vonage request_id : UUIDv4 sans tirets selon doc, mais on tolère un peu
// plus large pour être robuste. On exige uniquement des caractères safe-URL
// pour éviter toute tentative d'injection dans le path DELETE.
const VONAGE_REQUEST_ID_REGEX = /^[A-Za-z0-9_-]{8,80}$/

// Client service-role (pattern getSupabaseAdmin) — requis pour le limiteur DB.
// Cette route est publique (pré-auth), elle n'a pas de contexte auth.supabaseAdmin.
// Retourne null si l'env manque -> le limiteur est ignoré (fail-open, cf. POST).
function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
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

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  // Normalisation E.164 STRICTE (lib/phone) : le rate-limit et Vonage doivent
  // voir la forme canonique, sinon deux formats du même numéro contournent le
  // limiteur ET l'unicité aval.
  const phone = normalizeE164(body.phone)
  if (!phone) {
    return json({ error: 'Invalid phone (E.164 expected)', code: 'invalid_phone' }, 400)
  }
  const phoneVonage = phone.slice(1)

  // Gardes serveur AVANT tout envoi Vonage, dans cet ordre précis (mêmes
  // fonction rate_limit_check, clés différentes — pas de mécanisme parallèle) :
  //   normalisation E.164 (ci-dessus) → bucket IP → buckets téléphone →
  //   pré-check unicité (D1) → Vonage.
  // Fail-open si le limiteur est indisponible (cf. lib/rate-limit.ts +
  // getSupabaseAdmin null ci-dessus).
  const admin = getSupabaseAdmin()
  if (admin) {
    // Bucket IP (anti-énumération D3) : 10 / 3600s. Un pré-check D1 négatif
    // consomme les buckets → sonder un numéro a un coût. IP introuvable →
    // NE BLOQUE PAS (fail-open, cohérent avec le reste du limiteur).
    const ip = extractClientIp(request)
    if (ip) {
      if (!(await checkRateLimit(admin, 'otp_send_ip_1h', ip, 3600, 10))) {
        return json({ error: 'Too many requests', code: 'rate_limited', retry_after_seconds: 3600 }, 429)
      }
    }
    // Buckets téléphone : 1/60s (inchangé) ET 3/3600s (abaissé de 5 → 3 :
    // 3 envois/heure suffisent à qui se trompe sur SON numéro).
    if (!(await checkRateLimit(admin, 'otp_send_60s', phone, 60, 1))) {
      return json({ error: 'Too many requests', code: 'rate_limited', retry_after_seconds: 60 }, 429)
    }
    if (!(await checkRateLimit(admin, 'otp_send_1h', phone, 3600, 3))) {
      return json({ error: 'Too many requests', code: 'rate_limited', retry_after_seconds: 3600 }, 429)
    }

    // D1 — CONTRÔLE D'UNICITÉ AVANT L'ENVOI DU SMS. Un numéro déjà rattaché à un
    // compte VÉRIFIÉ ne déclenche aucun appel Vonage (pas de SMS facturé, pas de
    // code envoyé à un tiers). Comparaison sur la forme E.164 NORMALISÉE (`phone`).
    // Garde-fou d'expérience : la vérif à la création du compte reste en place
    // (D2, register-expert/register-org). Le message de récupération est côté
    // client (code 'phone_already_used'). Aucune info sur le compte détenteur.
    const { data: phoneOwner } = await admin
      .from('users')
      .select('id')
      .eq('phone', phone)
      .eq('phone_verified', true)
      .maybeSingle()
    if (phoneOwner) {
      return json({ error: 'Phone already used', code: 'phone_already_used' }, 409)
    }
  } else {
    console.warn('[public/send-phone-otp] service-role indisponible — rate-limit + unicité ignorés (fail-open)')
  }

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
