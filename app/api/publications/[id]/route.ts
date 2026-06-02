import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * PATCH /api/publications/[id] — édite un brouillon (ou une publi
 * suspendue / archivée).
 *
 * Garde : appartenance org active (RLS publications_member_write joue en
 * défense en profondeur). On REFUSE l'édition si status hors
 * ('draft','suspended','archived') — cf. statuts gérés par l'org côté client
 * (alignement RLS).
 *
 * Champs INTOUCHABLES par cette route : status, verification_score,
 * verification_method, verification_data, verified_by, verified_at,
 * review_reason, published_at, expires_at, created_by, organization_id,
 * domain_id. Le caller ne peut influencer QUE des champs métier édituables.
 *
 * Sémantique PATCH : champ présent → mis à jour ; champ absent → inchangé.
 * `null` explicite efface (sauf pour title/description qui restent NOT NULL).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const EDITABLE_STATUSES = ['draft', 'suspended', 'archived'] as const
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

type Body = {
  title?: unknown
  description?: unknown
  skills_required?: unknown
  seniority?: unknown
  work_mode?: unknown
  location?: unknown
  duration?: unknown
  start_date?: unknown
  budget_min?: unknown
  budget_max?: unknown
  branch_id?: unknown
  speciality_id?: unknown
  confidential?: unknown
}

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

function asNumberOrNull(v: unknown): number | null {
  if (v === null) return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function asStringArray(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const item of v) {
    if (typeof item !== 'string') continue
    const t = item.trim()
    if (t.length === 0 || t.length > maxLen) continue
    out.push(t)
    if (out.length >= maxItems) break
  }
  return out
}

function asUuidOrNull(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v === null) return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false }
  return UUID_REGEX.test(v) ? { ok: true, value: v } : { ok: false }
}

function asIsoDateOrNull(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v === null) return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false }
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? { ok: true, value: v } : { ok: false }
}

/**
 * Construit l'objet d'update partiel.
 * Retourne { ok: true, updates } OU { ok: false, error: <code i18n> }.
 */
function buildUpdates(body: Body): { ok: true; updates: Record<string, unknown> } | { ok: false; error: string } {
  const updates: Record<string, unknown> = {}

  if ('title' in body) {
    const s = asString(body.title)
    if (!s || s.length < 5 || s.length > 200) return { ok: false, error: 'invalid_title' }
    updates.title = s
  }
  if ('description' in body) {
    const s = asString(body.description)
    if (!s || s.length < 20 || s.length > 10_000) return { ok: false, error: 'invalid_description' }
    updates.description = s
  }
  if ('skills_required' in body) {
    updates.skills_required = asStringArray(body.skills_required, 50, 100)
  }
  if ('seniority' in body) {
    updates.seniority = body.seniority === null ? null : asString(body.seniority)
  }
  if ('work_mode' in body) {
    updates.work_mode = body.work_mode === null ? null : asString(body.work_mode)
  }
  if ('location' in body) {
    updates.location = body.location === null ? null : asString(body.location)
  }
  if ('duration' in body) {
    updates.duration = body.duration === null ? null : asString(body.duration)
  }
  if ('start_date' in body) {
    const d = asIsoDateOrNull(body.start_date)
    if (!d.ok) return { ok: false, error: 'invalid_json' }
    updates.start_date = d.value
  }
  // Budget : vérifie chaque borne + cohérence min<=max si les deux sont fournis
  // (ou hérités via la ligne actuelle — on simplifie en exigeant les deux dans
  // le body si l'un est édité ; sinon on ne re-vérifie pas la cohérence ici).
  if ('budget_min' in body) {
    const n = asNumberOrNull(body.budget_min)
    if (n !== null && n < 0) return { ok: false, error: 'invalid_budget' }
    updates.budget_min = n
  }
  if ('budget_max' in body) {
    const n = asNumberOrNull(body.budget_max)
    if (n !== null && n < 0) return { ok: false, error: 'invalid_budget' }
    updates.budget_max = n
  }
  if ('budget_min' in body && 'budget_max' in body) {
    const a = updates.budget_min as number | null
    const b = updates.budget_max as number | null
    if (a !== null && b !== null && a > b) return { ok: false, error: 'budget_inverted' }
  }
  if ('branch_id' in body) {
    const r = asUuidOrNull(body.branch_id)
    if (!r.ok) return { ok: false, error: 'invalid_json' }
    updates.branch_id = r.value
  }
  if ('speciality_id' in body) {
    const r = asUuidOrNull(body.speciality_id)
    if (!r.ok) return { ok: false, error: 'invalid_json' }
    updates.speciality_id = r.value
  }
  if ('confidential' in body) {
    updates.confidential = body.confidential === true
  }

  return { ok: true, updates }
}

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, ctx: RouteContext): Promise<Response> {
  // ── Auth + appartenance org active ──────────────────────────────────────
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const orgId = auth.organization?.id
  if (!orgId) {
    return json({ error: 'No organization', code: 'org_required' }, 403)
  }

  // ── Id de route ─────────────────────────────────────────────────────────
  const { id } = await ctx.params
  if (!id || !UUID_REGEX.test(id)) {
    return json({ error: 'Invalid id', code: 'not_found' }, 404)
  }

  // ── Body ────────────────────────────────────────────────────────────────
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const u = buildUpdates(body)
  if (!u.ok) {
    return json({ error: 'Invalid input', code: u.error }, 400)
  }
  if (Object.keys(u.updates).length === 0) {
    return json({ error: 'No editable fields', code: 'invalid_json' }, 400)
  }

  // ── Pré-check ownership + status éditable ───────────────────────────────
  const { data: pub, error: fetchErr } = await auth.supabaseAdmin
    .from('publications')
    .select('id, organization_id, status')
    .eq('id', id)
    .maybeSingle()

  if (fetchErr) {
    console.error('[publications:PATCH] fetch failed', fetchErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!pub) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }
  if ((pub.organization_id as string) !== orgId) {
    return json({ error: 'Forbidden', code: 'forbidden' }, 403)
  }
  const currentStatus = pub.status as string
  if (!(EDITABLE_STATUSES as readonly string[]).includes(currentStatus)) {
    return json(
      { error: 'Status not editable', code: 'wrong_status', current_status: currentStatus },
      409,
    )
  }

  // ── UPDATE (status / verification_* JAMAIS touchés ici) ─────────────────
  const { data: updated, error: updateErr } = await auth.supabaseAdmin
    .from('publications')
    .update(u.updates)
    .eq('id', id)
    .select('id, status')
    .single()

  if (updateErr || !updated) {
    console.error('[publications:PATCH] update failed', updateErr?.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'publication_edited',
    entity_type: 'publication',
    entity_id: id,
    detail: { fields: Object.keys(u.updates) },
  })

  return json({ id: updated.id, status: updated.status }, 200)
}
