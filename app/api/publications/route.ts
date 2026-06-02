import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'
import { loadTranslations, tBDD } from '@/lib/translations'
import { routing, type Locale } from '@/i18n/routing'
import type {
  Annonce,
  AnnonceBudgetUnit,
  AnnonceStatus,
  AnnonceType,
} from '@/types/annonce'

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


// ============================================================================
// GET /api/publications — liste les publications de l'organisation de l'auth.
// ============================================================================
//
// Retourne `{ publications: Annonce[] }` — DTO Annonce sans aucun champ
// sensible (verification_data / verification_method / review_reason /
// description / skills_required ne sont JAMAIS exposés ici).
//
// branch_label / speciality_label localisés via tBDD (table public.translations,
// même pattern que /api/taxonomy). Locale lue depuis ?locale=, fallback FR.
//
// Compteurs candidatures = 0 pour l'instant (Lot 2 branchera la vraie agg).
//
// Tri : updated_at DESC (modifications récentes en haut).

const VALID_STATUSES: readonly AnnonceStatus[] = [
  'draft',
  'pending_review',
  'published',
  'suspended',
  'expired',
  'archived',
  'rejected',
]
const VALID_TYPES: readonly AnnonceType[] = ['mission', 'offre']

const EMPTY_CANDIDATURES = {
  recues: 0,
  nouvelles: 0,
  en_discussion: 0,
  retenues: 0,
  refusees: 0,
} as const

function normalizeLocale(raw: string | null): Locale {
  return (routing.locales as readonly string[]).includes(raw ?? '')
    ? (raw as Locale)
    : routing.defaultLocale
}

function budgetUnitForType(t: AnnonceType): AnnonceBudgetUnit {
  // V1 : pas de colonne budget_unit en BDD. Convention dérivée :
  //   mission (freelance) → tarif par jour
  //   offre (CDI)         → salaire annuel
  return t === 'mission' ? 'day' : 'year'
}

type PublicationRow = {
  id: string
  type: string
  title: string
  status: string
  branch_id: string | null
  speciality_id: string | null
  budget_min: number | null
  budget_max: number | null
  verification_score: number | null
  created_at: string
  published_at: string | null
  branches: { id: string; name: string } | { id: string; name: string }[] | null
  specialities: { id: string; name: string } | { id: string; name: string }[] | null
}

function pickRel<T>(value: T | T[] | null): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export async function GET(request: NextRequest): Promise<Response> {
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

  const locale = normalizeLocale(new URL(request.url).searchParams.get('locale'))

  // ── SELECT + jointure noms branch/speciality + chargement traductions ──
  const [pubsResult, translations] = await Promise.all([
    auth.supabaseAdmin
      .from('publications')
      .select(
        'id, type, title, status, branch_id, speciality_id, budget_min, budget_max, ' +
          'verification_score, created_at, published_at, ' +
          'branches(id, name), specialities(id, name)',
      )
      .eq('organization_id', orgId)
      .order('updated_at', { ascending: false })
      .limit(500),
    loadTranslations(locale),
  ])

  if (pubsResult.error) {
    console.error('[publications:GET] query failed', pubsResult.error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  const rows = (pubsResult.data ?? []) as unknown as PublicationRow[]

  const publications: Annonce[] = rows.map((row) => {
    const safeType: AnnonceType = (VALID_TYPES as readonly string[]).includes(row.type)
      ? (row.type as AnnonceType)
      : 'mission'
    const safeStatus: AnnonceStatus = (VALID_STATUSES as readonly string[]).includes(row.status)
      ? (row.status as AnnonceStatus)
      : 'draft'
    const branch = pickRel(row.branches)
    const speciality = pickRel(row.specialities)

    return {
      id: row.id,
      type: safeType,
      title: row.title,
      status: safeStatus,
      branch_label: branch
        ? tBDD(translations, 'branches', branch.id, 'name', branch.name)
        : null,
      speciality_label: speciality
        ? tBDD(translations, 'specialities', speciality.id, 'name', speciality.name)
        : null,
      budget_min: row.budget_min,
      budget_max: row.budget_max,
      budget_unit: budgetUnitForType(safeType),
      verification_score: row.verification_score,
      created_at: row.created_at,
      published_at: row.published_at,
      candidatures: { ...EMPTY_CANDIDATURES },
    }
  })

  return json({ publications }, 200)
}
