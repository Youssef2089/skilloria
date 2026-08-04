import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/update-speciality (D7)
 * Body : {
 *   id: uuid,
 *   name?: string,                    // libellé FR (colonne specialities.name)
 *   slug?: string,                    // unique par branche
 *   active?: boolean,
 *   sort_order?: number,
 *   translations?: { en?, es?, de? }  // upsert public.translations (field 'name')
 * }
 *
 * Sert aussi au REORDER (sort_order seul) et à l'activation/désactivation. Le FR
 * est la colonne `name` ; EN/ES/DE upsertent dans public.translations. Une chaîne
 * vide supprime la traduction de la langue. logAudit('speciality_updated').
 * service_role. AUCUN filtre domaine.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const NON_FR_LOCALES = ['en', 'es', 'de'] as const

function slugify(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

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
    .select('id, branch_id, name, slug')
    .eq('id', id)
    .maybeSingle()
  if (spErr) {
    console.error('[admin:update-speciality] lookup failed', spErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!spec) return json({ error: 'Not found', code: 'not_found' }, 404)
  const sp = spec as { id: string; branch_id: string; name: string; slug: string }

  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k)
  const updates: Record<string, unknown> = {}

  if (has('name')) {
    const n = typeof body.name === 'string' ? body.name.trim() : ''
    if (!n || n.length > 100) return json({ error: 'Invalid name', code: 'invalid_name' }, 400)
    updates.name = n
  }

  if (has('active')) {
    if (typeof body.active !== 'boolean') {
      return json({ error: 'Invalid active', code: 'invalid_active' }, 400)
    }
    updates.active = body.active
  }

  if (has('sort_order')) {
    if (typeof body.sort_order !== 'number' || !Number.isInteger(body.sort_order) || body.sort_order < 0) {
      return json({ error: 'Invalid sort_order', code: 'invalid_sort_order' }, 400)
    }
    updates.sort_order = body.sort_order
  }

  if (has('slug')) {
    const wanted = typeof body.slug === 'string' ? slugify(body.slug.trim()) : ''
    if (!wanted) return json({ error: 'Invalid slug', code: 'invalid_slug' }, 400)
    if (wanted !== sp.slug) {
      const { data: clash, error: clashErr } = await auth.supabaseAdmin
        .from('specialities')
        .select('id')
        .eq('branch_id', sp.branch_id)
        .eq('slug', wanted)
        .neq('id', id)
        .maybeSingle()
      if (clashErr) {
        console.error('[admin:update-speciality] slug clash lookup failed', clashErr.message)
        return json({ error: 'Query failed', code: 'db_error' }, 500)
      }
      if (clash) return json({ error: 'Slug already used', code: 'slug_taken' }, 409)
      updates.slug = wanted
    }
  }

  const trToUpsert: { table_name: string; row_id: string; field: string; locale: string; value: string; updated_at: string }[] = []
  const trToDelete: string[] = []
  if (has('translations') && body.translations && typeof body.translations === 'object') {
    const obj = body.translations as Record<string, unknown>
    for (const loc of NON_FR_LOCALES) {
      if (!Object.prototype.hasOwnProperty.call(obj, loc)) continue
      const v = obj[loc]
      const str = typeof v === 'string' ? v.trim().slice(0, 100) : ''
      if (str) {
        trToUpsert.push({
          table_name: 'specialities',
          row_id: id,
          field: 'name',
          locale: loc,
          value: str,
          updated_at: new Date().toISOString(),
        })
      } else {
        trToDelete.push(loc)
      }
    }
  }

  if (Object.keys(updates).length === 0 && trToUpsert.length === 0 && trToDelete.length === 0) {
    return json({ error: 'Nothing to update', code: 'no_changes' }, 400)
  }

  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString()
    const { error: updErr } = await auth.supabaseAdmin.from('specialities').update(updates).eq('id', id)
    if (updErr) {
      console.error('[admin:update-speciality] update failed', updErr.message)
      return json({ error: 'Update failed', code: 'db_error' }, 500)
    }
  }

  if (trToUpsert.length > 0) {
    const { error: trErr } = await auth.supabaseAdmin
      .from('translations')
      .upsert(trToUpsert, { onConflict: 'table_name,row_id,field,locale' })
    if (trErr) console.error('[admin:update-speciality] translations upsert failed', trErr.message)
  }
  if (trToDelete.length > 0) {
    const { error: delErr } = await auth.supabaseAdmin
      .from('translations')
      .delete()
      .eq('table_name', 'specialities')
      .eq('row_id', id)
      .eq('field', 'name')
      .in('locale', trToDelete)
    if (delErr) console.error('[admin:update-speciality] translations delete failed', delErr.message)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'speciality_updated',
    entity_type: 'speciality',
    entity_id: id,
    detail: { fields: Object.keys(updates), translations_set: trToUpsert.map((t) => t.locale), translations_cleared: trToDelete },
  })

  return json({ ok: true, speciality_id: id }, 200)
}
