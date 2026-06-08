import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type Body = { locale?: unknown }

// Doit rester aligné avec i18n/routing.ts (locales) — FR par défaut.
const SUPPORTED = ['fr', 'en', 'es', 'de'] as const

/**
 * PATCH /api/me/locale — persister la préférence de langue (mission S3,
 * section 5). Écrit users.locale (jusqu'ici jamais rempli) : alimente AUSSI
 * la langue des emails serveur (lib/emails/locales.ts lit cette colonne).
 *
 * Le switch d'URL (next-intl) reste géré côté client (LanguageSwitcher) —
 * cette route ne fait QUE persister la préférence, sans le casser.
 * Pas de ré-auth (opération non sensible). Borné à auth.uid().
 */
export async function PATCH(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const locale = typeof body.locale === 'string' ? body.locale.trim().toLowerCase() : ''
  if (!(SUPPORTED as readonly string[]).includes(locale)) {
    return json({ error: 'Unsupported locale', code: 'invalid_locale' }, 400)
  }

  const { error: updErr } = await auth.supabaseAdmin
    .from('users')
    .update({ locale })
    .eq('id', auth.user.id)
  if (updErr) {
    console.error('[me/locale] users update failed', updErr.message)
    return json({ error: 'Could not update locale', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.user.domain_id,
    action: 'locale_updated',
    entity_type: 'user',
    entity_id: auth.user.id,
    detail: { locale },
  })

  return json({ ok: true, locale }, 200)
}
