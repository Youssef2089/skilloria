import { NextRequest } from 'next/server'
import { AuthError, requireAuth, requireOrgRole, type AuthContext } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'
import { isExpertProfileApproved, PROFILE_NOT_VERIFIED_CODE } from '@/lib/expert-verified-guard'
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

const TYPES = ['mission', 'offre', 'sous_traitance'] as const
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
  // D2 : créer une publication = gestion des annonces → editor+ (viewer refusé).
  try { requireOrgRole(auth, 'editor') } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
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

  // ── C2 : GARDE profil approuvé, SCOPÉE sous_traitance ────────────────────
  //  Seuls les besoins de sous-traitance émanent d'un expert (org personnelle).
  //  On exige que SON profil soit approved — même par appel direct à l'API.
  //  Les vraies orgs (mission/offre) n'ont pas de profil expert → non gardées.
  if (input.type === 'sous_traitance'
    && !(await isExpertProfileApproved(auth.supabaseAdmin, auth.user.id))) {
    return json({ error: 'Profile not verified', code: PROFILE_NOT_VERIFIED_CODE }, 403)
  }

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
const VALID_TYPES: readonly AnnonceType[] = ['mission', 'offre', 'sous_traitance']

const EMPTY_CANDIDATURES = {
  total: 0,
  to_review: 0,
  in_progress: 0,
  accepted: 0,
  rejected: 0,
} as const

/**
 * Mapping logique compteurs UI ↔ candidatures.status (Lot refonte dashboard
 * org + clarification entonnoir).
 *
 * 4 buckets EXCLUSIFS qui s'additionnent au TOTAL :
 *   to_review   = 'received' + 'in_review' + 'shortlisted'  (à consulter,
 *                 actions org pas encore prises)
 *   in_progress = 'unlocked'                                (échanges en cours,
 *                 messagerie ouverte)
 *   accepted    = 'selected'                                (candidature acceptée)
 *   rejected    = 'rejected'                                (candidature refusée)
 *   total       = somme des 4 (ne compte ni withdrawn ni archived,
 *                 qui sont hors-funnel produit V1)
 *
 * Codes DB INCHANGÉS (selected, unlocked, …). Renommage uniquement display.
 *
 * Le badge nav "Candidatures" reste indépendant — basé sur `candidature_views`
 * (par item non consulté). Ces deux compteurs cohabitent volontairement.
 */
type CounterAgg = {
  total: number
  to_review: number
  in_progress: number
  accepted: number
  rejected: number
}
function makeEmptyAgg(): CounterAgg {
  return { total: 0, to_review: 0, in_progress: 0, accepted: 0, rejected: 0 }
}
function bumpAgg(agg: CounterAgg, status: string): void {
  if (status === 'received' || status === 'in_review' || status === 'shortlisted') {
    agg.to_review += 1
    agg.total += 1
  } else if (status === 'unlocked') {
    agg.in_progress += 1
    agg.total += 1
  } else if (status === 'selected') {
    agg.accepted += 1
    agg.total += 1
  } else if (status === 'rejected') {
    agg.rejected += 1
    agg.total += 1
  }
  // 'withdrawn' & 'archived' : hors-funnel (ne comptent pas dans total).
}

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
  location: string | null
  work_mode: string | null
  duration: string | null
  start_date: string | null
  seniority: string | null
  confidential: boolean | null
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
        // Lot synthèse parlante : étendu avec location, work_mode, duration,
        // start_date, seniority, confidential — consommé par
        // buildPublicationSynthesis pour la carte AnnonceCard.
        'id, type, title, status, branch_id, speciality_id, budget_min, budget_max, ' +
          'location, work_mode, duration, start_date, seniority, confidential, ' +
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

  // ── Agrégat candidatures par publication (Lot 2c) ─────────────────────
  //  Une seule query batch sur l'ensemble des ids ; mapping en mémoire ensuite.
  const pubIds = rows.map((r) => r.id)
  const aggByPub = new Map<string, CounterAgg>()
  if (pubIds.length > 0) {
    const { data: candRows, error: candErr } = await auth.supabaseAdmin
      .from('candidatures')
      .select('publication_id, status')
      .in('publication_id', pubIds)
    if (candErr) {
      console.error('[publications:GET] candidatures agg failed', candErr.message)
      // best-effort : on continue avec EMPTY_CANDIDATURES
    } else {
      for (const c of (candRows ?? []) as { publication_id: string; status: string }[]) {
        let agg = aggByPub.get(c.publication_id)
        if (!agg) { agg = makeEmptyAgg(); aggByPub.set(c.publication_id, agg) }
        bumpAgg(agg, c.status)
      }
    }
  }

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
      candidatures: aggByPub.get(row.id) ?? { ...EMPTY_CANDIDATURES },
      // Lot synthèse parlante
      location: row.location,
      work_mode: row.work_mode,
      duration: row.duration,
      start_date: row.start_date,
      seniority: row.seniority,
      confidential: !!row.confidential,
    }
  })

  return json({ publications }, 200)
}
