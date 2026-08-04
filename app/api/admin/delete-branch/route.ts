import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/delete-branch (D7)
 * Body : { id: uuid }
 *
 * Suppression DÉFENSIVE (défense en profondeur, miroir du garde-fou UI) :
 *   - si des profils OU des publications référencent la branche, OU si elle
 *     porte encore des spécialités → 409 { code:'in_use', profiles, publications,
 *     specialities }. On ne supprime jamais une branche référencée.
 *   - sinon : suppression de la branche + de ses lignes public.translations.
 * logAudit('branch_deleted'). service_role. AUCUN filtre domaine.
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

  const { data: branch, error: brErr } = await auth.supabaseAdmin
    .from('branches')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (brErr) {
    console.error('[admin:delete-branch] branch lookup failed', brErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!branch) return json({ error: 'Not found', code: 'not_found' }, 404)

  const { count: profiles } = await auth.supabaseAdmin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('branch_id', id)
  const { count: publications } = await auth.supabaseAdmin
    .from('publications')
    .select('id', { count: 'exact', head: true })
    .eq('branch_id', id)
  const { count: specialities } = await auth.supabaseAdmin
    .from('specialities')
    .select('id', { count: 'exact', head: true })
    .eq('branch_id', id)

  if ((profiles ?? 0) > 0 || (publications ?? 0) > 0 || (specialities ?? 0) > 0) {
    return json(
      {
        error: 'Branch is in use',
        code: 'in_use',
        profiles: profiles ?? 0,
        publications: publications ?? 0,
        specialities: specialities ?? 0,
      },
      409,
    )
  }

  // Traductions d'abord (pas de FK, nettoyage explicite), puis la branche.
  await auth.supabaseAdmin
    .from('translations')
    .delete()
    .eq('table_name', 'branches')
    .eq('row_id', id)

  const { error: delErr } = await auth.supabaseAdmin.from('branches').delete().eq('id', id)
  if (delErr) {
    console.error('[admin:delete-branch] delete failed', delErr.message)
    return json({ error: 'Delete failed', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'branch_deleted',
    entity_type: 'branch',
    entity_id: id,
    detail: {},
  })

  return json({ ok: true }, 200)
}
