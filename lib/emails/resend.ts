import { Resend } from 'resend'

/**
 * Helper d'envoi d'email via Resend.
 *
 * Best-effort : si `RESEND_API_KEY` ou `RESEND_FROM_EMAIL` ne sont pas
 * configurées, ou si Resend retourne une erreur, on log un warning et on
 * retourne `{ ok: false, code }` SANS jeter d'exception. Le caller (route
 * admin approve/reject) continue son flow normalement — un email raté ne
 * doit jamais bloquer la mise à jour BDD (cf. décision B5 point 1).
 *
 * Le SDK `resend@6.10.0` est déjà installé dans package.json.
 */

const REQUEST_TIMEOUT_MS = 10_000

export type SendEmailParams = {
  to: string
  subject: string
  html: string
  text: string
  /** Preheader (texte caché en haut, prévisualisé par les clients mail). */
  preheader?: string
  /** Tag optionnel pour le tracking côté Resend (ex: 'org_approved'). */
  tag?: string
  /**
   * Adresse de réponse (Resend v6 : champ `replyTo`). Ex : le formulaire de
   * contact fixe `replyTo` sur l'email du visiteur pour qu'un « Répondre »
   * depuis la boîte contact@ écrive directement au visiteur.
   */
  replyTo?: string
}

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; code: 'missing_env' | 'invalid_to' | 'resend_error' | 'timeout' }

function isValidEmail(email: string): boolean {
  if (!email || email.length > 320) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL
  if (!apiKey || !from) {
    console.warn('[emails:resend] RESEND_API_KEY or RESEND_FROM_EMAIL missing — email skipped', {
      tag: params.tag,
    })
    return { ok: false, code: 'missing_env' }
  }

  if (!isValidEmail(params.to)) {
    console.warn('[emails:resend] invalid recipient', { to: params.to, tag: params.tag })
    return { ok: false, code: 'invalid_to' }
  }

  const client = new Resend(apiKey)

  // Preheader = ligne 0px height en haut du HTML pour la preview client mail.
  const finalHtml = params.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;line-height:0;font-size:1px;">${escapeHtml(params.preheader)}</div>${params.html}`
    : params.html

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const { data, error } = await client.emails.send({
        from,
        to: [params.to],
        subject: params.subject,
        html: finalHtml,
        text: params.text,
        replyTo: params.replyTo,
        tags: params.tag ? [{ name: 'kind', value: params.tag }] : undefined,
      })
      clearTimeout(timeout)
      if (error) {
        console.warn('[emails:resend] send failed', {
          tag: params.tag,
          msg: (error as { message?: string }).message ?? String(error),
        })
        return { ok: false, code: 'resend_error' }
      }
      if (!data?.id) {
        console.warn('[emails:resend] no id returned', { tag: params.tag })
        return { ok: false, code: 'resend_error' }
      }
      return { ok: true, id: data.id }
    } finally {
      clearTimeout(timeout)
    }
  } catch (err) {
    console.warn('[emails:resend] send threw', {
      tag: params.tag,
      msg: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, code: 'resend_error' }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
