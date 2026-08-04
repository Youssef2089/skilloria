import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/delete-speciality (D7)
 * Body : { id: uuid }
 *
 * Suppression DÉFENSIVE (miroir du garde-fou UI) : si des profils OU des
 * publications référencent la spécialité → 409 { code:'in_use', profiles,
 * publications }. Sinon : suppression + nettoyage de ses lignes
 * public.translations. logAudit('speciality_deleted'). service_role.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id || !UUID_REGEX.test(id)) {
    return json({ error: 'Invalid id', code: 'invalid_id' }, 400)
  }

  const { data: spec, error: spErr } = await auth.supabaseAdmin
    .from('specialities')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (spErr) {
    console.error('[admin:delete-speciality] lookup failed', spErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!spec) return json({ error: 'Not found', code: 'not_found' }, 404)

  const { count: profiles } = await auth.supabaseAdmin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('speciality_id', id)
  const { count: publications } = await auth.supabaseAdmin
    .from('publications')
    .select('id', { count: 'exact', head: true })
    .eq('speciality_id', id)

  if ((profiles ?? 0) > 0 || (publications ?? 0) > 0) {
    return json(
      { error: 'Speciality is in use', code: 'in_use', profiles: profiles ?? 0, publications: publications ?? 0 },
      409,
    )
  }

  await auth.supabaseAdmin
    .from('translations')
    .delete()
    .eq('table_name', 'specialities')
    .eq('row_id', id)

  const { error: delErr } = await auth.supabaseAdmin.from('specialities').delete().eq('id', id)
  if (delErr) {
    console.error('[admin:delete-speciality] delete failed', delErr.message)
    return json({ error: 'Delete failed', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'speciality_deleted',
    entity_type: 'speciality',
    entity_id: id,
    detail: {},
  })

  return json({ ok: true }, 200)
}
