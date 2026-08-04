import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/create-speciality (D7)
 * Body : {
 *   branch_id: uuid,                  // branche parente (domain_id hérité d'elle)
 *   name: string,                     // libellé FR (colonne specialities.name)
 *   slug?: string,                    // unique par branche
 *   active?: boolean,                 // défaut true
 *   sort_order?: number,              // défaut 0
 *   translations?: { en?, es?, de? }  // upsert public.translations (field 'name')
 * }
 *
 * Le domain_id est HÉRITÉ de la branche (jamais fourni par le client). Slug
 * unique par branche. Traductions EN/ES/DE → public.translations (table_name
 * 'specialities', field 'name'). logAudit('speciality_created'). service_role.
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

function parseTranslations(raw: unknown): { en?: string; es?: string; de?: string } {
  const out: { en?: string; es?: string; de?: string } = {}
  if (!raw || typeof raw !== 'object') return out
  const obj = raw as Record<string, unknown>
  for (const loc of NON_FR_LOCALES) {
    const v = obj[loc]
    if (typeof v === 'string' && v.trim()) out[loc] = v.trim().slice(0, 100)
  }
  return out
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

  const branchId = typeof body.branch_id === 'string' ? body.branch_id.trim() : ''
  if (!branchId || !UUID_REGEX.test(branchId)) {
    return json({ error: 'Invalid branch_id', code: 'invalid_branch' }, 400)
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return json({ error: 'Name is required', code: 'invalid_name' }, 400)
  if (name.length > 100) return json({ error: 'Name too long', code: 'invalid_name' }, 400)

  const active = typeof body.active === 'boolean' ? body.active : true
  const sortOrder =
    typeof body.sort_order === 'number' && Number.isInteger(body.sort_order) && body.sort_order >= 0
      ? body.sort_order
      : 0
  const translations = parseTranslations(body.translations)

  // domain_id HÉRITÉ de la branche.
  const { data: branch, error: brErr } = await auth.supabaseAdmin
    .from('branches')
    .select('id, domain_id')
    .eq('id', branchId)
    .maybeSingle()
  if (brErr) {
    console.error('[admin:create-speciality] branch lookup failed', brErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!branch) return json({ error: 'Unknown branch', code: 'invalid_branch' }, 400)
  const domainId = (branch as { domain_id: string }).domain_id

  // Slug unique PAR branche.
  const requested = typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim() : name
  const base = slugify(requested) || 'specialite'
  const { data: taken, error: takenErr } = await auth.supabaseAdmin
    .from('specialities')
    .select('slug')
    .eq('branch_id', branchId)
    .like('slug', `${base}%`)
  if (takenErr) {
    console.error('[admin:create-speciality] slug lookup failed', takenErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const takenSet = new Set(((taken ?? []) as { slug: string }[]).map((r) => r.slug))
  let slug = base
  for (let i = 2; takenSet.has(slug) && i < 200; i++) {
    slug = `${base.slice(0, 46)}-${i}`
  }

  const { data: created, error: insErr } = await auth.supabaseAdmin
    .from('specialities')
    .insert({ branch_id: branchId, domain_id: domainId, name, slug, active, sort_order: sortOrder })
    .select('id')
    .maybeSingle()
  if (insErr || !created) {
    console.error('[admin:create-speciality] insert failed', insErr?.message)
    return json({ error: 'Create failed', code: 'db_error' }, 500)
  }
  const specId = (created as { id: string }).id

  const trRows = (Object.entries(translations) as [string, string][]).map(([locale, value]) => ({
    table_name: 'specialities',
    row_id: specId,
    field: 'name',
    locale,
    value,
    updated_at: new Date().toISOString(),
  }))
  if (trRows.length > 0) {
    const { error: trErr } = await auth.supabaseAdmin
      .from('translations')
      .upsert(trRows, { onConflict: 'table_name,row_id,field,locale' })
    if (trErr) console.error('[admin:create-speciality] translations upsert failed', trErr.message)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'speciality_created',
    entity_type: 'speciality',
    entity_id: specId,
    detail: { branch_id: branchId, domain_id: domainId, name, slug, active, sort_order: sortOrder, translations },
  })

  return json({ ok: true, speciality_id: specId, slug }, 200)
}
