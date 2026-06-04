import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/me/notifications — liste les notifications du user courant.
 *
 *  Garde : requireAuth → service_role.
 *  Tri : created_at DESC, limite 50.
 *  Retour : { notifications: [...], unread_count: N }
 *
 * POST /api/me/notifications/read-all — flip read_at sur toutes les non-lues.
 *  Idempotent. (Endpoint séparé en sous-route mais on regroupe ici pour
 *  simplicité — voir /[id]/read pour la lecture unitaire.)
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { data, error } = await auth.supabaseAdmin
    .from('notifications')
    .select('id, type, title, body, link_url, entity_id, status, channel, read_at, created_at')
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) {
    console.error('[me/notifications:GET] query failed', error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const notifications = (data ?? []) as Array<{ id: string; type: string; title: string | null; body: string | null; link_url: string | null; entity_id: string | null; status: string; channel: string; read_at: string | null; created_at: string }>
  const unread_count = notifications.filter(n => n.read_at === null).length

  return json({ notifications, unread_count }, 200)
}

/**
 * POST /api/me/notifications/read-all — marque toutes les notifs non-lues comme lues.
 */
export async function POST(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const nowIso = new Date().toISOString()
  const { error } = await auth.supabaseAdmin
    .from('notifications')
    .update({ read_at: nowIso, status: 'read' })
    .eq('user_id', auth.user.id)
    .is('read_at', null)
  if (error) {
    console.error('[me/notifications:POST] read-all failed', error.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }
  return json({ ok: true }, 200)
}
