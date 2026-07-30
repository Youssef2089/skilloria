/**
 * Envoi d'un SMS via l'API Vonage SMS (https://rest.nexmo.com/sms/json).
 *
 * Pourquoi une nouvelle fonction : le reste du projet n'utilise Vonage que via
 * l'API **Verify v2** (OTP à template imposé) — impossible d'y envoyer un texte
 * libre. On réutilise ici les MÊMES identifiants (VONAGE_API_KEY / SECRET) mais
 * l'API SMS générique.
 *
 * Best-effort et typé : jamais d'exception vers l'appelant (le cron ne doit pas
 * planter sur un échec fournisseur). Renvoie { ok, code } ; l'appelant décide de
 * la logique de réessai (cf. cron dispatch, ajout A1).
 *
 * Longueur : un SMS GSM-7 = 160 caractères ; au-delà (ou avec des caractères
 * non-GSM), Vonage segmente et facture plusieurs SMS. On détecte le charset et
 * on transmet `type` en conséquence ; les gabarits sont volontairement courts.
 */

const VONAGE_SMS_URL = 'https://rest.nexmo.com/sms/json'
const REQUEST_TIMEOUT_MS = 10_000

export type SendSmsParams = {
  /** Destinataire en E.164 (+33…). Vonage attend le numéro SANS le '+'. */
  to: string
  /** Corps du message (déjà localisé, court). */
  text: string
  /**
   * Expéditeur affiché. Alphanumérique ≤ 11 caractères (ex. nom de plateforme)
   * ou numéro. Certains pays restreignent l'alphanumérique — configurable via
   * VONAGE_SMS_FROM, sinon dérivé du nom passé.
   */
  from: string
}

export type SendSmsResult =
  | { ok: true; messageId: string }
  | { ok: false; code: 'missing_env' | 'invalid_to' | 'vonage_error' | 'timeout' }

/** Vrai si tous les caractères tiennent dans le jeu GSM-7 de base (+ extension). */
function isGsm7(text: string): boolean {
  // Sous-ensemble suffisant : ASCII imprimable + quelques lettres accentuées
  // couramment dans le jeu GSM-7. Sinon on bascule en unicode (70 c/segment).
  return /^[\x20-\x7E\r\nàäåæçèéìñòöøùü£¥§¿¡ÄÅÆÇÉÑÖØÜ€]*$/.test(text)
}

/** Nettoie un nom de plateforme en expéditeur alphanumérique Vonage (≤ 11 c). */
export function smsSenderFrom(platformName: string): string {
  const env = process.env.VONAGE_SMS_FROM
  if (env && env.trim()) return env.trim().slice(0, 11)
  const cleaned = platformName.replace(/[^A-Za-z0-9]/g, '').slice(0, 11)
  return cleaned || 'Skilloria'
}

export async function sendSms(params: SendSmsParams): Promise<SendSmsResult> {
  const apiKey = process.env.VONAGE_API_KEY
  const apiSecret = process.env.VONAGE_API_SECRET
  if (!apiKey || !apiSecret) {
    console.warn('[sms:vonage] VONAGE_API_KEY or VONAGE_API_SECRET missing — SMS skipped')
    return { ok: false, code: 'missing_env' }
  }

  const to = params.to.startsWith('+') ? params.to.slice(1) : params.to
  if (!/^\d{6,15}$/.test(to)) {
    console.warn('[sms:vonage] invalid recipient', { to })
    return { ok: false, code: 'invalid_to' }
  }

  const type = isGsm7(params.text) ? 'text' : 'unicode'

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(VONAGE_SMS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          api_secret: apiSecret,
          to,
          from: params.from,
          text: params.text,
          type,
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    const payload = (await res.json().catch(() => null)) as
      | { messages?: Array<{ status?: string; 'message-id'?: string; 'error-text'?: string }> }
      | null
    const msg = payload?.messages?.[0]
    // Vonage renvoie 200 avec status '0' = succès ; tout autre status = échec.
    if (!msg || msg.status !== '0') {
      console.warn('[sms:vonage] send failed', {
        status: msg?.status,
        error: msg?.['error-text'],
      })
      return { ok: false, code: 'vonage_error' }
    }
    return { ok: true, messageId: msg['message-id'] ?? '' }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    console.warn('[sms:vonage] send threw', { msg: err instanceof Error ? err.message : String(err) })
    return { ok: false, code: aborted ? 'timeout' : 'vonage_error' }
  }
}
