import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/me/notifications/[id]/read — marque UNE notification comme lue.
 *
 *  Garde : requireAuth + user_id match (idempotent).
 *  Effet : read_at = now() + status = 'read'.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: RouteContext): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { id } = await ctx.params
  if (!id || !UUID_REGEX.test(id)) {
    return json({ error: 'Invalid id', code: 'invalid_id' }, 400)
  }

  const nowIso = new Date().toISOString()
  const { error } = await auth.supabaseAdmin
    .from('notifications')
    .update({ read_at: nowIso, status: 'read' })
    .eq('id', id)
    .eq('user_id', auth.user.id)         // garde : ne touche QUE ses propres notifs
  if (error) {
    console.error('[me/notifications/[id]/read:POST] update failed', error.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }
  return json({ ok: true, read_at: nowIso }, 200)
}
