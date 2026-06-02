import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/publications — crée un BROUILLON.
 *
 * Garde : tout membre actif d'une org peut créer (auth.organization?.id présent).
 * Le status est FORCÉ à 'draft' côté serveur (la RLS publications_member_write
 * l'interdirait de toute façon depuis le client, mais double protection).
 *
 * Champs verification_* / published_at / expires_at / verified_by / verified_at /
 * review_reason ne sont JAMAIS posés ici : ils relèvent du gate (publish) et
 * de l'admin.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type Body = {
  type?: unknown
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

const TYPES = ['mission', 'offre'] as const
type PublicationType = (typeof TYPES)[number]

type ValidatedInput = {
  type: PublicationType
  title: string
  description: string
  skills_required: string[]
  seniority: string | null
  work_mode: string | null
  location: string | null
  duration: string | null
  start_date: string | null
  budget_min: number | null
  budget_max: number | null
  branch_id: string | null
  speciality_id: string | null
  confidential: boolean
}

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

function asNumber(v: unknown): number | null {
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

function asUuid(v: unknown): string | null {
  if (typeof v !== 'string') return null
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v)
    ? v
    : null
}

function asIsoDate(v: unknown): string | null {
  if (typeof v !== 'string') return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? v : null
}

function validate(body: Body): { ok: true; input: ValidatedInput } | { ok: false; error: string } {
  const typeRaw = asString(body.type)
  if (!typeRaw || !(TYPES as readonly string[]).includes(typeRaw)) {
    return { ok: false, error: 'invalid_type' }
  }
  const title = asString(body.title)
  if (!title || title.length < 5 || title.length > 200) {
    return { ok: false, error: 'invalid_title' }
  }
  const description = asString(body.description)
  if (!description || description.length < 20 || description.length > 10_000) {
    return { ok: false, error: 'invalid_description' }
  }
  const budget_min = asNumber(body.budget_min)
  const budget_max = asNumber(body.budget_max)
  if (budget_min != null && budget_min < 0) return { ok: false, error: 'invalid_budget' }
  if (budget_max != null && budget_max < 0) return { ok: false, error: 'invalid_budget' }
  if (budget_min != null && budget_max != null && budget_min > budget_max) {
    return { ok: false, error: 'budget_inverted' }
  }
  return {
    ok: true,
    input: {
      type: typeRaw as PublicationType,
      title,
      description,
      skills_required: asStringArray(body.skills_required, 50, 100),
      seniority: asString(body.seniority),
      work_mode: asString(body.work_mode),
      location: asString(body.location),
      duration: asString(body.duration),
      start_date: asIsoDate(body.start_date),
      budget_min,
      budget_max,
      branch_id: asUuid(body.branch_id),
      speciality_id: asUuid(body.speciality_id),
      confidential: body.confidential === true,
    },
  }
}

export async function POST(request: NextRequest): Promise<Response> {
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

  // ── Body + validation ───────────────────────────────────────────────────
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }
  const v = validate(body)
  if (!v.ok) {
    return json({ error: 'Invalid input', code: v.error }, 400)
  }
  const input = v.input

  // ── INSERT brouillon ────────────────────────────────────────────────────
  const { data: row, error: insertErr } = await auth.supabaseAdmin
    .from('publications')
    .insert({
      organization_id: orgId,
      domain_id: auth.domain.id,
      created_by: auth.user.id,
      type: input.type,
      title: input.title,
      description: input.description,
      skills_required: input.skills_required,
      seniority: input.seniority,
      work_mode: input.work_mode,
      location: input.location,
      duration: input.duration,
      start_date: input.start_date,
      budget_min: input.budget_min,
      budget_max: input.budget_max,
      branch_id: input.branch_id,
      speciality_id: input.speciality_id,
      confidential: input.confidential,
      status: 'draft',
    })
    .select('id, status')
    .single()

  if (insertErr || !row) {
    console.error('[publications:POST] insert failed', insertErr?.message)
    return json({ error: 'Insert failed', code: 'db_error' }, 500)
  }

  // ── Audit best-effort ───────────────────────────────────────────────────
  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'publication_drafted',
    entity_type: 'publication',
    entity_id: row.id as string,
    detail: {
      type: input.type,
      title: input.title,
    },
  })

  return json({ id: row.id, status: row.status }, 201)
}
