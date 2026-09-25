import { contexteDepuisAuth } from '@/lib/journal/contexte'
import { JournalError } from '@/lib/journal/journaliser'
import { motDePasseChange } from '@/lib/comptes/journal-compte'
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

  const reauthFail = requireReauth(request, auth.user.id)
  if (reauthFail) return reauthFail

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
  if (updErr) {
    console.error('[me/password] updateUser failed', updErr.message)
    const code = updErr.message.toLowerCase().includes('different')
      ? 'password_same_as_old'
      : 'password_change_failed'
    return json({ error: 'Could not change password', code }, 400)
  }

  // LA LIGNE DU GRAND LIVRE — après la bascule (immédiate, chez Supabase
  // Auth), avant l'audit best-effort (§E.68). Un journal qui refuse le DIT :
  // le mot de passe EST changé, et un 200 muet le ferait oublier.
  try {
    await motDePasseChange(auth.supabaseAdmin, contexteDepuisAuth(auth), { userId: auth.user.id })
  } catch (err) {
    if (!(err instanceof JournalError)) throw err
    console.error('[me/password] grand livre en échec après le changement', err.message)
    return json({ error: 'Journal failed', code: 'journal_error' }, 500)
  }

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
