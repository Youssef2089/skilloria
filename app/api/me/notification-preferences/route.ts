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

/**
 * Préférences de notification (email / SMS sur nouvelle opportunité).
 *
 * GET   → { email, sms, phone_verified, email_address, phone } pour l'écran de
 *         paramétrage (le SMS est indisponible si le téléphone n'est pas vérifié).
 * PATCH → { email?: boolean, sms?: boolean } — enregistrement immédiat au toggle.
 *
 * Les préférences sont APPLIQUÉES côté serveur au moment de l'envoi (cron
 * dispatch) — le client ne fait que les afficher/mettre à jour. Borné à auth.uid().
 */
export async function GET(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { data, error } = await auth.supabaseAdmin
    .from('users')
    .select('notify_match_email, notify_match_sms, phone, phone_verified, email')
    .eq('id', auth.user.id)
    .maybeSingle()
  if (error || !data) {
    return json({ error: 'Could not load preferences', code: 'db_error' }, 500)
  }
  return json({
    email: data.notify_match_email !== false,
    sms: data.notify_match_sms !== false,
    phone_verified: data.phone_verified === true,
    phone: data.phone ?? null,
    email_address: data.email ?? null,
  })
}

export async function PATCH(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  let body: { email?: unknown; sms?: unknown }
  try {
    body = (await request.json()) as { email?: unknown; sms?: unknown }
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const patch: Record<string, boolean> = {}
  if (typeof body.email === 'boolean') patch.notify_match_email = body.email
  if (typeof body.sms === 'boolean') patch.notify_match_sms = body.sms
  if (Object.keys(patch).length === 0) {
    return json({ error: 'No valid preference provided', code: 'no_op' }, 400)
  }

  const { error: updErr } = await auth.supabaseAdmin
    .from('users')
    .update(patch)
    .eq('id', auth.user.id)
  if (updErr) {
    console.error('[me/notification-preferences] update failed', updErr.message)
    return json({ error: 'Could not update preferences', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.user.domain_id,
    action: 'notification_prefs_updated',
    entity_type: 'user',
    entity_id: auth.user.id,
    detail: patch,
  })

  return json({ ok: true, ...patch }, 200)
}
