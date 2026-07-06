/**
 * Layout HTML commun aux emails Skilloria — design simple, compatible avec
 * la plupart des clients mail (Gmail, Outlook, Apple Mail).
 *
 * Pas de framework MJML ou de moteur de template — concaténation string
 * suffit pour 2 templates V1. Si on en ajoute beaucoup plus tard,
 * envisager react-email.
 */

import { escapeHtml } from './escape'

// Ré-export pour la découvrabilité : l'échappement des valeurs d'emails vit
// dans ./escape (source unique). Voir interpolate() dans ./locales.
export { escapeHtml } from './escape'

const PRIMARY = '#00B9FF'
const TEXT_PRIMARY = '#0f172a'
const TEXT_SECONDARY = '#64748b'
const BG = '#f8fafc'
const BORDER = '#e2e8f0'

export type EmailLayoutParams = {
  title: string
  bodyHtml: string
  ctaLabel?: string
  ctaUrl?: string
  signature: string
  footer: string
}

export function renderEmailHtml(params: EmailLayoutParams): string {
  const cta =
    params.ctaLabel && params.ctaUrl
      ? `<tr>
          <td align="center" style="padding:24px 0 8px;">
            <a href="${escapeHtml(params.ctaUrl)}"
               style="display:inline-block;padding:12px 24px;background:${PRIMARY};color:#fff;font-weight:500;border-radius:8px;text-decoration:none;font-size:14px;">
              ${escapeText(params.ctaLabel)}
            </a>
          </td>
        </tr>`
      : ''

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeText(params.title)}</title>
</head>
<body style="margin:0;padding:0;background:${BG};font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${TEXT_PRIMARY};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"
               style="max-width:560px;background:#fff;border:1px solid ${BORDER};border-radius:14px;padding:32px 36px;">
          <tr>
            <td style="font-size:18px;font-weight:500;color:${TEXT_PRIMARY};letter-spacing:-.01em;padding-bottom:18px;">
              Skilloria
            </td>
          </tr>
          <tr>
            <td style="font-size:22px;font-weight:500;color:${TEXT_PRIMARY};padding-bottom:14px;line-height:1.3;">
              ${escapeText(params.title)}
            </td>
          </tr>
          <tr>
            <td style="font-size:14px;line-height:1.7;color:${TEXT_PRIMARY};">
              ${params.bodyHtml}
            </td>
          </tr>
          ${cta}
          <tr>
            <td style="font-size:14px;line-height:1.7;color:${TEXT_PRIMARY};padding-top:22px;">
              ${escapeText(params.signature)}<br/>
              ${escapeText(params.footer)}
            </td>
          </tr>
        </table>
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;padding:14px 0;">
          <tr>
            <td style="font-size:11px;color:${TEXT_SECONDARY};text-align:center;line-height:1.5;">
              Skilloria — La marketplace premium des experts certifiés.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/** Version texte brute — fallback pour les clients qui ne rendent pas HTML. */
export function renderEmailText(args: {
  title: string
  bodyText: string
  ctaLabel?: string
  ctaUrl?: string
  signature: string
  footer: string
}): string {
  const parts: string[] = []
  parts.push(args.title)
  parts.push('')
  parts.push(args.bodyText)
  if (args.ctaLabel && args.ctaUrl) {
    parts.push('')
    parts.push(`${args.ctaLabel}: ${args.ctaUrl}`)
  }
  parts.push('')
  parts.push(args.signature)
  parts.push(args.footer)
  parts.push('')
  parts.push('---')
  parts.push('Skilloria — La marketplace premium des experts certifiés.')
  return parts.join('\n')
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Strip HTML tags (pour générer le pendant texte du body) — simpliste, suffisant
 *  pour nos templates où on contrôle la source (juste <strong>). */
export function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
