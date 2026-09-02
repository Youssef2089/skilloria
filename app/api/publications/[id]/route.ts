import { NextRequest, after } from 'next/server'
import { AuthError, requireAuth, requireOrgRole, type AuthContext } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'
import { loadTranslations } from '@/lib/translations'
import { loadReferentielLabels } from '@/lib/publication-synthesis'
import { routing, type Locale } from '@/i18n/routing'

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
  seniorities?: unknown
  work_mode?: unknown
  location_note?: unknown
  work_zone_codes?: unknown
  duration?: unknown
  start_date?: unknown
  budget_min?: unknown
  budget_max?: unknown
  branch_id?: unknown
  speciality_ids?: unknown
  speciality_other?: unknown
  confidential?: unknown
}

/**
 * SÉNIORITÉS — multiple, bornée au vocabulaire du référentiel.
 *
 * Miroir exact de la route de création : une valeur hors liste est IGNORÉE
 * plutôt que refusée. Le client ne peut pas en fabriquer une utile, et refuser
 * toute la requête pour un intrus rendrait l'édition impossible sans dire
 * pourquoi. La contrainte de base reste la barrière finale.
 *
 * Un tableau VIDE est une valeur légitime : « aucune contrainte de séniorité ».
 * Jamais « ne correspond à personne » (cf. lib/publications/publishable.ts).
 */
const SENIORITES = ['junior', 'confirmed', 'senior', 'expert'] as const
function asSeniorities(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return [...new Set(v.filter((x): x is string =>
    typeof x === 'string' && (SENIORITES as readonly string[]).includes(x)))]
}

function asUuidArray(v: unknown, maxItems: number): string[] {
  if (!Array.isArray(v)) return []
  const out = new Set<string>()
  for (const item of v) {
    if (typeof item === 'string' && UUID_REGEX.test(item)) out.add(item)
    if (out.size >= maxItems) break
  }
  return [...out]
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
  if ('seniorities' in body) {
    updates.seniorities = asSeniorities(body.seniorities)
  }
  if ('work_mode' in body) {
    updates.work_mode = body.work_mode === null ? null : asString(body.work_mode)
  }
  // `location` s'appelle désormais `location_note` : un texte libre d'appoint,
  // qui ne sert PAS à la mise en relation. Ce sont les zones qui la décident.
  if ('location_note' in body) {
    updates.location_note = body.location_note === null ? null : asString(body.location_note)
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
  if ('speciality_ids' in body) {
    updates.speciality_ids = asUuidArray(body.speciality_ids, 20)
  }
  // D6 : précision libre « Autre » (bornée 100).
  if ('speciality_other' in body) {
    const raw = typeof body.speciality_other === 'string' ? body.speciality_other.trim() : ''
    if (raw.length > 100) return { ok: false, error: 'invalid_json' }
    updates.speciality_other = raw.length > 0 ? raw : null
  }
  if ('confidential' in body) {
    updates.confidential = body.confidential === true
  }

  return { ok: true, updates }
}

function normalizeLocale(raw: string | null): Locale {
  return (routing.locales as readonly string[]).includes(raw ?? '')
    ? (raw as Locale)
    : routing.defaultLocale
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
  // D2 : éditer une annonce = gestion des annonces → editor+ (viewer refusé).
  try { requireOrgRole(auth, 'editor') } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
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

  // ── ZONES DE TRAVAIL : des CODES en entrée, des uuid en base ────────────
  // Résolues ici et non dans buildUpdates : cela demande une requête, et
  // buildUpdates est volontairement synchrone. Un code inconnu fait échouer la
  // requête ENTIÈRE — une sélection amputée en silence enverrait l'annonce
  // chercher ailleurs que là où l'organisation croit chercher.
  if ('work_zone_codes' in body) {
    const codes = Array.isArray(body.work_zone_codes)
      ? [...new Set(body.work_zone_codes.filter((c): c is string => typeof c === 'string' && c.length > 0))]
      : []
    if (codes.length === 0) {
      u.updates.work_zone_ids = []
    } else {
      const { data: wzs, error: wzErr } = await auth.supabaseAdmin
        .from('work_zones')
        .select('id, code')
        .eq('active', true)
        .in('code', codes)
      if (wzErr) {
        console.error('[publications:PATCH] lecture des zones en échec', wzErr.message)
        return json({ error: 'Query failed', code: 'db_error' }, 500)
      }
      const trouvees = (wzs ?? []) as Array<{ id: string; code: string }>
      if (trouvees.length !== codes.length) {
        const inconnus = codes.filter((c) => !trouvees.some((t) => t.code === c))
        return json({ error: 'Unknown work zone', code: 'bad_work_zone', unknown: inconnus }, 400)
      }
      u.updates.work_zone_ids = trouvees.map((t) => t.id)
    }
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
    speciality_ids: string[] | null
    speciality_other: string | null
    skills_required: string[] | null
    seniorities: string[] | null
    work_mode: string | null
    location_note: string | null
    work_zone_ids: string[] | null
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
      'id, organization_id, type, title, description, branch_id, speciality_ids, ' +
        'speciality_other, skills_required, seniorities, work_mode, location_note, work_zone_ids, duration, start_date, ' +
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

  // ── LIBELLÉS des référentiels multiples ─────────────────────────────────
  //  Le détail rendait `speciality_id`, et l'écran affichait un nom résolu par
  //  l'ancien embed PostgREST. La clé étrangère est morte avec le passage au
  //  multiple : sans cette résolution, l'écran afficherait des uuid — ou, pire,
  //  rien du tout, ce qui se lit comme « aucune spécialité ».
  const locale = normalizeLocale(new URL(request.url).searchParams.get('locale'))
  const translations = await loadTranslations(locale)
  const labels = await loadReferentielLabels(
    auth.supabaseAdmin as unknown as Parameters<typeof loadReferentielLabels>[0],
    translations,
    [pub],
  )

  // DTO retourné — strip organization_id (déduit du contexte, inutile au client).
  return json(
    {
      publication: {
        id: pub.id,
        type: pub.type,
        title: pub.title,
        description: pub.description,
        branch_id: pub.branch_id,
        speciality_ids: pub.speciality_ids ?? [],
        speciality_labels: (pub.speciality_ids ?? [])
          .map((sid) => labels.specialities?.get(sid))
          .filter((x): x is string => !!x),
        speciality_other: pub.speciality_other,
        skills_required: pub.skills_required ?? [],
        seniorities: pub.seniorities ?? [],
        work_mode: pub.work_mode,
        location_note: pub.location_note,
        work_zone_ids: pub.work_zone_ids ?? [],
        work_zone_labels: (pub.work_zone_ids ?? [])
          .map((zid) => labels.workZones?.get(zid))
          .filter((x): x is string => !!x),
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
