import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { signPhoneOtpToken } from '@/lib/phone-otp-token'
import {
  lireRefusVonage,
  identifiantsVonageAbsents,
  vonageInjoignable,
  limiteurIndisponible,
  jetonTelephoneNonSignable,
  reponseErreurOtp,
} from '@/lib/otp/vonage-refus'
import {
  evaluerLimite,
  extractClientIp,
  OTP_VERIFY_FENETRE_S,
  OTP_VERIFY_MAX,
  OTP_VERIFY_IP_FENETRE_S,
  OTP_VERIFY_IP_MAX,
} from '@/lib/rate-limit'
import { normalizeE164 } from '@/lib/phone'

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

// Client service-role (pattern getSupabaseAdmin) — requis pour le limiteur DB.
// Route publique (pré-auth) : pas de contexte auth.supabaseAdmin.
// Retourne null si l'env manque -> la vérification est REFUSÉE (fail-closed, cf. POST).
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

type Body = { request_id?: unknown; code?: unknown; phone?: unknown }

export async function POST(request: NextRequest): Promise<Response> {
  const apiKey = process.env.VONAGE_API_KEY
  const apiSecret = process.env.VONAGE_API_SECRET
  if (!apiKey || !apiSecret) return reponseErreurOtp('public/verify-phone-otp', identifiantsVonageAbsents())

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const request_id = typeof body.request_id === 'string' ? body.request_id.trim() : ''
  const code = typeof body.code === 'string' ? body.code.trim() : ''
  // Normalisation E.164 STRICTE : le jeton HMAC est signé sur la forme
  // canonique — register-org/register-expert re-vérifieront ce même canonique.
  const phone = normalizeE164(body.phone)

  if (!request_id || request_id.length > 200) {
    return json({ error: 'Invalid request_id', code: 'invalid_input' }, 400)
  }
  if (!/^\d{4,6}$/.test(code)) {
    return json({ error: 'Invalid OTP code', code: 'invalid_input' }, 400)
  }
  if (!phone) {
    return json({ error: 'Invalid phone (E.164 expected)', code: 'invalid_phone' }, 400)
  }

  // ── Rate-limit anti-force-brute, AVANT l'appel Vonage "check" ──────────────
  //
  // FAIL-CLOSED, ET C'EST L'INVERSE DE L'ENVOI (M1).
  //   Ici la limite n'est pas un garde-fou de coût : elle EST la défense. Un
  //   code fait 4 à 6 chiffres. Laisser passer quand le limiteur est
  //   indisponible, c'est offrir un nombre illimité d'essais — le seul moment
  //   où cette limite compte vraiment est précisément celui où on l'ignorait.
  //
  // Deux clés, la MÊME fonction `rate_limit_check` (aucun mécanisme parallèle) :
  //   • (request_id + téléphone) : la cible.
  //   • IP : empêche de balayer les request_id depuis un même point.
  //     Une IP INTROUVABLE ne bloque pas — l'absence d'un signal n'est pas la
  //     panne d'une garde (certains proxys ne posent aucun en-tête).
  //
  // La réponse est la MÊME dans tous les cas de refus : jamais un mot sur la
  // justesse du code. Un attaquant ne doit rien apprendre d'un refus.
  const refus = () =>
    json({ error: 'Too many requests', code: 'rate_limited', retry_after_seconds: OTP_VERIFY_FENETRE_S }, 429)

  const admin = getSupabaseAdmin()
  // FAIL-CLOSED, et il le reste — mais il ne se dit plus « trop d'essais » : sans clé de service, le limiteur
  // ne tourne pas, et c'est une configuration absente, pas un abus de la personne (§E.86, §E.22).
  if (!admin) return reponseErreurOtp('public/verify-phone-otp', limiteurIndisponible())

  const ip = extractClientIp(request)
  if (ip && (await evaluerLimite(admin, 'otp_verify_ip', ip, OTP_VERIFY_IP_FENETRE_S, OTP_VERIFY_IP_MAX)) !== 'autorise') {
    return refus()
  }
  if (
    (await evaluerLimite(admin, 'otp_verify', `${request_id}:${phone}`, OTP_VERIFY_FENETRE_S, OTP_VERIFY_MAX)) !==
    'autorise'
  ) {
    return refus()
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
    return reponseErreurOtp('public/verify-phone-otp', vonageInjoignable(err))
  }

  if (res.status === 410 || res.status === 404) {
    return json({ error: 'OTP expired or already used', code: 'expired' }, 410)
  }
  if (res.status === 400) {
    return json({ error: 'Invalid OTP code', code: 'invalid_code' }, 400)
  }
  if (!res.ok) {
    // Le MÊME module que l'envoi : 401, crédit, compte suspendu ne sont pas une « panne passagère ».
    const payload = (await res.json().catch(() => null)) as { type?: string; title?: string; detail?: string } | null
    return reponseErreurOtp('public/verify-phone-otp', lireRefusVonage(res.status, payload))
  }

  let phone_otp_token: string
  try {
    phone_otp_token = signPhoneOtpToken({ phone, request_id })
  } catch (err) {
    // Le code était JUSTE : c'est le secret du jeton (PHONE_OTP_HMAC_SECRET) qui manque au déploiement.
    return reponseErreurOtp('public/verify-phone-otp', jetonTelephoneNonSignable(err))
  }

  return json({ phone_verified: true, phone_otp_token }, 200)
}
