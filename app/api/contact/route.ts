import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, extractClientIp } from '@/lib/rate-limit'
import { sendEmail } from '@/lib/emails/resend'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Endpoint PUBLIC du formulaire de contact (D3).
 *
 * Pas de `requireAuth` : un visiteur non inscrit doit pouvoir écrire. La défense
 * repose donc sur :
 *   - validation serveur STRICTE de tous les champs (source de vérité) ;
 *   - rate-limit DB atomique par IP (1 / 30 s ET 5 / 1 h) — filet anti-spam ;
 *   - consentement RGPD obligatoire, horodaté dans l'email pour la traçabilité.
 *
 * L'email est une notification INTERNE (vers contact@skilloria.io) : son corps
 * est en français, pas besoin d'i18n. Le `replyTo` est fixé sur l'email du
 * visiteur pour qu'un « Répondre » lui écrive directement.
 */

const CONTACT_TO = 'contact@skilloria.io'

// Client service-role (pattern getSupabaseAdmin) — requis pour le limiteur DB.
// Route publique pré-auth, donc pas de contexte auth.supabaseAdmin. Retourne
// null si l'env manque -> limiteur ignoré (fail-open, cf. POST).
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

function validationError(field: string): Response {
  return json({ error: 'Invalid field', code: 'validation', field }, 400)
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Body = {
  firstName?: unknown
  lastName?: unknown
  company?: unknown
  email?: unknown
  phone?: unknown
  message?: unknown
  consent?: unknown
}

/** Récupère une string bornée et trimée, ou null si absente/hors bornes. */
function readString(raw: unknown, min: number, max: number): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (v.length < min || v.length > max) return null
  return v
}

/** Champ optionnel : '' si absent/vide, null si présent mais hors borne max. */
function readOptional(raw: unknown, max: number): string | null {
  if (raw === undefined || raw === null || raw === '') return ''
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (v.length > max) return null
  return v
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'validation' }, 400)
  }

  // --- Validation serveur STRICTE (source de vérité) ---
  const firstName = readString(body.firstName, 1, 100)
  if (!firstName) return validationError('firstName')

  const lastName = readString(body.lastName, 1, 100)
  if (!lastName) return validationError('lastName')

  const email = readString(body.email, 3, 320)
  if (!email || !EMAIL_RE.test(email)) return validationError('email')

  const message = readString(body.message, 1, 5000)
  if (!message) return validationError('message')

  const company = readOptional(body.company, 200)
  if (company === null) return validationError('company')

  const phone = readOptional(body.phone, 40)
  if (phone === null) return validationError('phone')

  // Consentement RGPD : doit être strictement `true`.
  if (body.consent !== true) return validationError('consent')

  // --- Rate-limit par IP (filet anti-spam) ---
  // x-forwarded-for est falsifiable : signal secondaire uniquement (cf. lib/rate-limit).
  const admin = getSupabaseAdmin()
  const ip = extractClientIp(request)
  if (admin && ip) {
    if (!(await checkRateLimit(admin, 'contact_form_30s', ip, 30, 1))) {
      return json({ error: 'Too many requests', code: 'rate_limited', retry_after_seconds: 30 }, 429)
    }
    if (!(await checkRateLimit(admin, 'contact_form_1h', ip, 3600, 5))) {
      return json({ error: 'Too many requests', code: 'rate_limited', retry_after_seconds: 3600 }, 429)
    }
  } else {
    console.warn('[api/contact] service-role ou IP indisponible — rate-limit ignoré (fail-open)')
  }

  // --- Envoi de la notification interne ---
  const consentAt = new Date().toISOString()
  const subject = `Nouveau message de contact — ${firstName} ${lastName}`

  const rows: Array<[string, string]> = [
    ['Prénom', firstName],
    ['Nom', lastName],
    ['Société', company || '—'],
    ['Email', email],
    ['Téléphone', phone || '—'],
    ['Message', message],
    ['Consentement RGPD accepté le', consentAt],
  ]

  const text = rows.map(([k, v]) => `${k} : ${v}`).join('\n')

  const html = `
    <div style="font-family:Inter,system-ui,sans-serif;font-size:14px;color:#0f172a;line-height:1.6;">
      <h2 style="font-size:18px;margin:0 0 16px;">Nouveau message de contact</h2>
      <table style="border-collapse:collapse;width:100%;max-width:560px;">
        ${rows
          .map(
            ([k, v]) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eef2f6;font-weight:600;color:#475569;vertical-align:top;white-space:nowrap;">${escapeHtml(k)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eef2f6;color:#0f172a;white-space:pre-wrap;">${escapeHtml(v)}</td>
        </tr>`,
          )
          .join('')}
      </table>
    </div>`

  const result = await sendEmail({
    to: CONTACT_TO,
    subject,
    html,
    text,
    replyTo: email,
    tag: 'contact_form',
  })

  if (!result.ok) {
    return json({ error: 'Email delivery failed', code: 'send_failed' }, 502)
  }

  return json({ ok: true }, 200)
}
