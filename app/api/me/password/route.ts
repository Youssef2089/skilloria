import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { requireReauth } from '@/lib/reauth-token'
import { extractBearerToken, getUserScopedClient } from '@/lib/supabase-user-server'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type Body = { new_password?: unknown }

const PASSWORD_MIN = 8
const PASSWORD_MAX = 200

/**
 * POST /api/me/password — changer le mot de passe (mission S3, section 4).
 *
 * Voie Supabase Auth : `auth.updateUser({ password })` dans la session de
 * l'user (client user-scoped). Ré-auth EXIGÉE en renfort (x-reauth-token) :
 * l'expert vient de re-prouver son ancien mot de passe via /api/me/reauth.
 * Borné à auth.uid().
 */
export async function POST(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  // MOUCHARD TEMP — réception + vérification du token de ré-auth (jamais la valeur)
  const reauthHeader = request.headers.get('x-reauth-token')
  console.log('[MOUCHARD password] x-reauth-token reçu:', Boolean(reauthHeader), 'len:', (reauthHeader || '').length)
  const reauthFail = requireReauth(request, auth.user.id)
  if (reauthFail) {
    // MOUCHARD TEMP — on lit la raison du refus sans consommer la Response renvoyée
    const reason = (await reauthFail.clone().json().catch(() => null)) as { reason?: string; code?: string } | null
    console.log('[MOUCHARD password] ré-auth REFUSÉE → status:', reauthFail.status, 'code:', reason?.code, 'reason:', reason?.reason)
    return reauthFail
  }
  console.log('[MOUCHARD password] ré-auth VÉRIFIÉE: OK') // MOUCHARD TEMP

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const new_password = typeof body.new_password === 'string' ? body.new_password : ''
  if (new_password.length < PASSWORD_MIN || new_password.length > PASSWORD_MAX) {
    return json({ error: 'Password too short', code: 'weak_password' }, 400)
  }

  const accessToken = extractBearerToken(request)
  if (!accessToken) {
    return json({ error: 'Not authenticated', code: 'no_token' }, 401)
  }

  const userClient = await getUserScopedClient(accessToken)
  const { error: updErr } = await userClient.auth.updateUser({ password: new_password })
  // MOUCHARD TEMP — résultat EXACT de updateUser({password}) (message Supabase brut)
  console.log('[MOUCHARD password] updateUser({password}):', updErr ? `ÉCHEC → ${updErr.message}` : 'SUCCÈS')
  if (updErr) {
    console.error('[me/password] updateUser failed', updErr.message)
    const code = updErr.message.toLowerCase().includes('different')
      ? 'password_same_as_old'
      : 'password_change_failed'
    console.log('[MOUCHARD password] sortie → status: 400 code:', code) // MOUCHARD TEMP
    return json({ error: 'Could not change password', code }, 400)
  }
  console.log('[MOUCHARD password] sortie → status: 200 (mot de passe changé)') // MOUCHARD TEMP

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.user.domain_id,
    action: 'password_changed',
    entity_type: 'user',
    entity_id: auth.user.id,
  })

  return json({ ok: true }, 200)
}
