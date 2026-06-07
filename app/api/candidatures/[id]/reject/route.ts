import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'
import { markCandidatureViewedServerSide } from '@/lib/candidature-views'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/candidatures/[id]/reject — l'ORG refuse la candidature.
 *
 * Garde (service_role) :
 *  - requireAuth + auth.organization?.id présent
 *  - ownership : candidature → publication.organization_id == auth.org.id
 *
 * Garde de transition (cf. décision Lot 2c, point 3) :
 *  - reject autorisé SEULEMENT depuis 'received' | 'in_review' | 'shortlisted'
 *  - refusé depuis 'unlocked' | 'rejected' | 'withdrawn' | 'archived' (déjà
 *    rejected → 409 — pas d'idempotence demandée, on log explicite)
 *
 * Body : { reason?: string (max 2000) }
 *
 * Effet : UPDATE candidature SET status='rejected', status_reason=$reason.
 * Aucune notif expert en V1 (à confirmer côté produit pour éviter de
 * « jeter le sel sur la blessure » sans contexte).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const ALLOWED_PREVIOUS_STATUSES: readonly string[] = ['received', 'in_review', 'shortlisted']
const MAX_REASON_LEN = 2000

type Body = { reason?: unknown }

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: RouteContext): Promise<Response> {
  // ── Auth + org ──────────────────────────────────────────────────────────
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

  const { id: candidatureId } = await ctx.params
  if (!candidatureId || !UUID_REGEX.test(candidatureId)) {
    return json({ error: 'Invalid id', code: 'invalid_id' }, 400)
  }

  // ── Body ────────────────────────────────────────────────────────────────
  let body: Body = {}
  try {
    const raw = await request.text()
    if (raw.length > 0) body = JSON.parse(raw) as Body
  } catch {
    return json({ error: 'Invalid JSON', code: 'invalid_json' }, 400)
  }
  const reasonRaw = asString(body.reason)
  if (reasonRaw && reasonRaw.length > MAX_REASON_LEN) {
    return json({ error: 'reason too long', code: 'invalid_reason' }, 400)
  }
  const reason = reasonRaw

  // ── Ownership + lookup ─────────────────────────────────────────────────
  const { data: cand, error: candErr } = await auth.supabaseAdmin
    .from('candidatures')
    .select(
      'id, publication_id, domain_id, status, ' +
        'publications!inner(id, organization_id)',
    )
    .eq('id', candidatureId)
    .maybeSingle()
  if (candErr) {
    console.error('[candidatures/[id]/reject:POST] lookup failed', candErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!cand) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }
  type Joined = {
    id: string
    publication_id: string
    domain_id: string
    status: string
    publications: { id: string; organization_id: string } | { id: string; organization_id: string }[]
  }
  const candRow = cand as unknown as Joined
  const pub = Array.isArray(candRow.publications) ? candRow.publications[0] : candRow.publications
  if (!pub || pub.organization_id !== orgId) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }

  // ── Garde de transition ────────────────────────────────────────────────
  if (!ALLOWED_PREVIOUS_STATUSES.includes(candRow.status)) {
    return json(
      { error: 'Invalid status transition', code: 'invalid_transition', current: candRow.status },
      409,
    )
  }

  // ── UPDATE ─────────────────────────────────────────────────────────────
  const { error: updErr } = await auth.supabaseAdmin
    .from('candidatures')
    .update({ status: 'rejected', status_reason: reason })
    .eq('id', candidatureId)
    .in('status', ALLOWED_PREVIOUS_STATUSES)  // anti-race
  if (updErr) {
    console.error('[candidatures/[id]/reject:POST] update failed', updErr.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  // ── Audit best-effort ──────────────────────────────────────────────────
  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: candRow.domain_id,
    action: 'candidature_rejected',
    entity_type: 'candidature',
    entity_id: candidatureId,
    detail: {
      publication_id: candRow.publication_id,
      has_reason: reason !== null,
    },
  })

  // Lot badges par item : agir = vu (best-effort, idempotent).
  await markCandidatureViewedServerSide(auth.supabaseAdmin, auth.user.id, candidatureId)

  return json(
    {
      ok: true,
      candidature: {
        id: candidatureId,
        status: 'rejected',
        status_reason: reason,
      },
    },
    200,
  )
}
