import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import {
  generateSessionToken,
  setSessionToken,
  serializeSessionCookie,
} from '@/lib/session-token'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/me/sessions/revoke-others — « Se déconnecter de tous les autres
 * appareils » (mission S3, section 6).
 *
 * Mécanisme : on fait TOURNER users.last_session_token (nouveau secret) et on
 * ré-émet le cookie httpOnly `ss_token` POUR LE DEVICE COURANT uniquement.
 * Tous les autres devices/onglets, qui détiennent l'ancien token, tombent en
 * 403 `session_superseded` à leur prochain heartbeat (<SessionHeartbeat/> +
 * auth-guard, mécanisme 11F EXISTANT — réutilisé sans le casser).
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

  const newToken = generateSessionToken()
  const setRes = await setSessionToken({
    supabaseAdmin: auth.supabaseAdmin,
    userId: auth.user.id,
    token: newToken,
  })
  if (!setRes.ok) {
    return new Response(
      JSON.stringify({ error: 'Could not rotate session', code: 'db_error' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    )
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.user.domain_id,
    action: 'sessions_revoked_others',
    entity_type: 'user',
    entity_id: auth.user.id,
  })

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'Set-Cookie': serializeSessionCookie(newToken, request),
    },
  })
}
