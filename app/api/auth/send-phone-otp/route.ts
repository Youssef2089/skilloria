import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { requireReauth } from '@/lib/reauth-token'
import { checkRateLimit } from '@/lib/rate-limit'
import { normalizeE164 } from '@/lib/phone'
import { lireRefusVonage } from '@/lib/otp/vonage-refus'

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

  // NORMALISATION E.164 STRICTE — la MÊME que la route publique, et elle
  // manquait ici.
  //
  //  Cette route se contentait de `/^\+[1-9]\d{6,14}$/`. Deux conséquences, et
  //  aucune n'était visible :
  //   ① un numéro structurellement E.164 mais NON ATTRIBUABLE (`+3312345678`)
  //     partait chez Vonage, qui le refusait — et l'écran affichait une panne ;
  //   ② surtout, le numéro n'était pas CANONICALISÉ. Deux écritures du même
  //     numéro donnaient deux chaînes distinctes : la clé de rate-limit et
  //     l'index unique `users(phone) where phone_verified` devenaient
  //     contournables par simple variation de format — exactement le trou que
  //     lib/phone existe pour fermer (cf. son en-tête).
  //
  //  Le parcours des paramètres du compte passe par ici. Il a donc vécu six
  //  mois sans la garde que l'inscription avait.
  const phone = normalizeE164(body.phone)
  if (!phone) {
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

  // MÊME lecture des refus que la route publique, par le MÊME module. Deux
  // tables d'erreurs recopiées auraient divergé — c'est exactement ce que ce
  // lot ferme, et le dépôt en portait déjà la preuve : un correctif appliqué à
  // l'inscription expert et jamais rétroporté à l'inscription organisation.
  if (!res.ok || !payload?.request_id) {
    const refus = lireRefusVonage(res.status, payload)
    console.error('[send-phone-otp] Vonage refus', {
      status: res.status,
      code: refus.code,
      detail: refus.detailFournisseur,
    })
    return json({ error: 'OTP provider refused', code: refus.code }, refus.status)
  }

  // `request_id` N'EST PAS UNE LIVRAISON — cf. la route publique. Verify v2 est
  // asynchrone : la demande est acceptée, le message peut être bloqué ensuite.
  return json({ request_id: payload.request_id, livraison_confirmee: false }, 200)
}
