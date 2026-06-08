import { NextRequest, after } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Matching IA via `after()` (~10-15s) après l'envoi de la response, dans le
// cas (dormant) où le PATCH cible une publication déjà 'published'.
export const maxDuration = 60

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

  // ── Matching réconcilié — déclencheur ANNONCE (post-édition) ─────────────
  // Non-bloquant POUR L'ORG : exécution via `after()`. On déclenche la
  // réconciliation UNIQUEMENT si la publi est en statut 'published' (édition
  // d'un draft/suspended/archivé n'a aucun effet sur le feed expert). Côté
  // EDITABLE_STATUSES actuel = draft/suspended/archived ; branche dormante
  // aujourd'hui mais wirée pour le jour où l'édition d'un 'published'
  // deviendra possible.
  if (updated.status === 'published') {
    after(async () => {
      try {
        const { runMatchingForPublication } = await import('@/lib/matching')
        const v = await runMatchingForPublication({
          supabaseAdmin: auth.supabaseAdmin,
          publicationId: id,
        })
        console.log('[publications:PATCH] matching done', { id, status: v.status, proposals: v.proposals.length })
      } catch (err) {
        console.error('[publications:PATCH] matching threw (after)', err)
      }
    })
  }

  return json({ id: updated.id, status: updated.status }, 200)
}


// ============================================================================
// GET /api/publications/[id] — détail d'UNE publication owner-scoped.
// ============================================================================
//
// Sert à pré-remplir le formulaire d'édition côté front.
//
// Garde : ownership stricte. Si la ligne existe mais appartient à une autre
// org → 403 forbidden (PAS 404, pour ne pas révéler l'existence). Si la
// ligne n'existe pas → 404.
//
// DTO COMPLET (champs éditables + métadonnées status/score) — pas de masquage,
// c'est la propre publi de l'org. JAMAIS de verification_data, verified_*,
// review_reason, expires_at (réservés à la fiche admin).

export async function GET(request: NextRequest, ctx: RouteContext): Promise<Response> {
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

  const { id } = await ctx.params
  if (!id || !UUID_REGEX.test(id)) {
    return json({ error: 'Invalid id', code: 'not_found' }, 404)
  }

  type PublicationDetailRow = {
    id: string
    organization_id: string
    type: string
    title: string
    description: string
    branch_id: string | null
    speciality_id: string | null
    skills_required: string[] | null
    seniority: string | null
    work_mode: string | null
    location: string | null
    duration: string | null
    start_date: string | null
    budget_min: number | null
    budget_max: number | null
    confidential: boolean
    status: string
    verification_score: number | null
    created_at: string
    updated_at: string
    published_at: string | null
  }

  const fetchResult = await auth.supabaseAdmin
    .from('publications')
    .select(
      'id, organization_id, type, title, description, branch_id, speciality_id, ' +
        'skills_required, seniority, work_mode, location, duration, start_date, ' +
        'budget_min, budget_max, confidential, status, verification_score, ' +
        'created_at, updated_at, published_at',
    )
    .eq('id', id)
    .maybeSingle()

  if (fetchResult.error) {
    console.error('[publications:GET id] fetch failed', fetchResult.error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const pub = fetchResult.data as unknown as PublicationDetailRow | null
  if (!pub) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }
  if (pub.organization_id !== orgId) {
    return json({ error: 'Forbidden', code: 'forbidden' }, 403)
  }

  // DTO retourné — strip organization_id (déduit du contexte, inutile au client).
  return json(
    {
      publication: {
        id: pub.id,
        type: pub.type,
        title: pub.title,
        description: pub.description,
        branch_id: pub.branch_id,
        speciality_id: pub.speciality_id,
        skills_required: pub.skills_required ?? [],
        seniority: pub.seniority,
        work_mode: pub.work_mode,
        location: pub.location,
        duration: pub.duration,
        start_date: pub.start_date,
        budget_min: pub.budget_min,
        budget_max: pub.budget_max,
        confidential: pub.confidential,
        status: pub.status,
        verification_score: pub.verification_score,
        created_at: pub.created_at,
        updated_at: pub.updated_at,
        published_at: pub.published_at,
      },
    },
    200,
  )
}
