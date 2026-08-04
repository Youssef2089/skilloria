import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/create-branch (D7)
 * Body : {
 *   domain_id: uuid,                 // écosystème (requis, choisi à la création)
 *   name: string,                    // libellé FR (base = colonne branches.name)
 *   slug?: string,                   // sinon dérivé du nom ; unique par domaine
 *   active?: boolean,                // défaut true
 *   sort_order?: number,             // défaut 0
 *   translations?: { en?, es?, de? } // libellés optionnels → public.translations
 * }
 *
 * Le FR est la colonne `name`. Les langues non renseignées retombent sur le FR
 * (résolution tBDD). Slug unique PAR domaine (branches_domain_slug). Les
 * traductions EN/ES/DE sont upsertées idempotemment dans public.translations
 * (table_name 'branches', field 'name'). logAudit('branch_created').
 * Garde admin per-route via requireAdmin. service_role. AUCUN filtre domaine.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const NON_FR_LOCALES = ['en', 'es', 'de'] as const

/** Slugifie un nom : minuscules, accents retirés, non-alphanum → tiret. */
function slugify(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

/** Extrait les traductions EN/ES/DE valides (chaînes non vides) du body. */
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

  const domainId = typeof body.domain_id === 'string' ? body.domain_id.trim() : ''
  if (!domainId || !UUID_REGEX.test(domainId)) {
    return json({ error: 'Invalid domain_id', code: 'invalid_domain' }, 400)
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

  // Le domaine doit exister.
  const { data: dom, error: domErr } = await auth.supabaseAdmin
    .from('domains')
    .select('id')
    .eq('id', domainId)
    .maybeSingle()
  if (domErr) {
    console.error('[admin:create-branch] domain lookup failed', domErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!dom) return json({ error: 'Unknown domain', code: 'invalid_domain' }, 400)

  // Slug unique PAR domaine : on suffixe en cas de collision.
  const requested = typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim() : name
  const base = slugify(requested) || 'branche'
  const { data: taken, error: takenErr } = await auth.supabaseAdmin
    .from('branches')
    .select('slug')
    .eq('domain_id', domainId)
    .like('slug', `${base}%`)
  if (takenErr) {
    console.error('[admin:create-branch] slug lookup failed', takenErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const takenSet = new Set(((taken ?? []) as { slug: string }[]).map((r) => r.slug))
  let slug = base
  for (let i = 2; takenSet.has(slug) && i < 200; i++) {
    slug = `${base.slice(0, 46)}-${i}`
  }

  // Insert de la branche.
  const { data: created, error: insErr } = await auth.supabaseAdmin
    .from('branches')
    .insert({ domain_id: domainId, name, slug, active, sort_order: sortOrder })
    .select('id')
    .maybeSingle()
  if (insErr || !created) {
    console.error('[admin:create-branch] insert failed', insErr?.message)
    return json({ error: 'Create failed', code: 'db_error' }, 500)
  }
  const branchId = (created as { id: string }).id

  // Upsert des traductions EN/ES/DE (idempotent sur la PK composite).
  const trRows = (Object.entries(translations) as [string, string][]).map(([locale, value]) => ({
    table_name: 'branches',
    row_id: branchId,
    field: 'name',
    locale,
    value,
    updated_at: new Date().toISOString(),
  }))
  if (trRows.length > 0) {
    const { error: trErr } = await auth.supabaseAdmin
      .from('translations')
      .upsert(trRows, { onConflict: 'table_name,row_id,field,locale' })
    if (trErr) {
      console.error('[admin:create-branch] translations upsert failed', trErr.message)
      // Non bloquant : la branche existe, le FR suffit ; l'admin peut recompléter.
    }
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'branch_created',
    entity_type: 'branch',
    entity_id: branchId,
    detail: { domain_id: domainId, name, slug, active, sort_order: sortOrder, translations },
  })

  return json({ ok: true, branch_id: branchId, slug }, 200)
}
