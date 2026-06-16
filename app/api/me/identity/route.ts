import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { requireReauth } from '@/lib/reauth-token'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type Body = { first_name?: unknown; last_name?: unknown }

const NAME_MAX = 80

/**
 * PATCH /api/me/identity — modifier prénom + nom (mission S3, section 1).
 *
 * Ré-auth EXIGÉE (header x-reauth-token). Le nom N'EST PAS un input de la
 * vérification IA expert (cf. lib/verification/ai-expert-verification.ts) :
 * l'édition est autorisée et journalisée, sans re-review (reco V1).
 * Borné à auth.uid() (l'expert n'agit que sur SON compte).
 */
export async function PATCH(request: NextRequest): Promise<Response> {
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

  const first_name = typeof body.first_name === 'string' ? body.first_name.trim() : ''
  const last_name = typeof body.last_name === 'string' ? body.last_name.trim() : ''

  if (first_name.length < 1 || first_name.length > NAME_MAX) {
    return json({ error: 'Invalid first_name', code: 'invalid_first_name' }, 400)
  }
  if (last_name.length < 1 || last_name.length > NAME_MAX) {
    return json({ error: 'Invalid last_name', code: 'invalid_last_name' }, 400)
  }

  const { error: updErr } = await auth.supabaseAdmin
    .from('users')
    .update({ first_name, last_name })
    .eq('id', auth.user.id)
  if (updErr) {
    console.error('[me/identity] users update failed', updErr.message)
    return json({ error: 'Could not update identity', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.user.domain_id,
    action: 'identity_updated',
    entity_type: 'user',
    entity_id: auth.user.id,
    detail: { first_name, last_name },
  })

  return json({ ok: true, first_name, last_name }, 200)
}
