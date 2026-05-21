import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/get-org/[id]
 *
 * Détail complet d'une organisation pour la fiche admin (B5).
 *
 * Retourne :
 *   - org : champs organizations + review_reason
 *   - contact : nom/poste/email/linkedin du membre admin le plus ancien
 *     (role_in_org='admin', status='active', ORDER BY joined_at ASC LIMIT 1)
 *   - verification : extrait de verification_data (méthode, score, notes,
 *     had_rejection, rejected_by, last_provider)
 *
 * Garde admin via requireAdmin. service_role.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: RouteContext): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { id } = await ctx.params
  if (!id || !/^[a-f0-9-]{36}$/i.test(id)) {
    return json({ error: 'Invalid id', code: 'invalid_id' }, 400)
  }

  // ── Org row ─────────────────────────────────────────────────────────────
  const { data: org, error: orgErr } = await auth.supabaseAdmin
    .from('organizations')
    .select(
      'id, company_name, logo_url, siren, vat_number, org_type, country, email_domain, website_url, verification_status, verification_method, verification_data, verified_at, verified_by, review_reason, created_at',
    )
    .eq('id', id)
    .maybeSingle()

  if (orgErr) {
    console.error('[admin:get-org] org lookup failed', orgErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!org) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }

  // ── Contact = membre admin le plus ancien ──────────────────────────────
  const { data: memberRow, error: memberErr } = await auth.supabaseAdmin
    .from('organization_members')
    .select('user_id, joined_at, users(id, first_name, last_name, email, job_title, linkedin_url, civility, locale)')
    .eq('organization_id', id)
    .eq('role_in_org', 'admin')
    .eq('status', 'active')
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (memberErr) {
    console.error('[admin:get-org] member lookup failed', memberErr.message)
  }

  const userRow = memberRow?.users
    ? Array.isArray(memberRow.users)
      ? memberRow.users[0]
      : memberRow.users
    : null

  const contact = userRow
    ? {
        id: (userRow as { id: string }).id,
        first_name: (userRow as { first_name: string | null }).first_name ?? null,
        last_name: (userRow as { last_name: string | null }).last_name ?? null,
        email: (userRow as { email: string }).email,
        job_title: (userRow as { job_title: string | null }).job_title ?? null,
        linkedin_url: (userRow as { linkedin_url: string | null }).linkedin_url ?? null,
        civility: (userRow as { civility: string | null }).civility ?? null,
        locale: (userRow as { locale: string | null }).locale ?? null,
      }
    : null

  // ── Extraction verification_data ────────────────────────────────────────
  const vd =
    (org.verification_data as
      | {
          score?: number
          notes?: string
          last_provider?: string
          attempts_count?: number
          had_rejection?: boolean
          rejected_by?: string[]
        }
      | null) ?? null

  const verification = {
    method: org.verification_method as string | null,
    status: org.verification_status as string | null,
    score: typeof vd?.score === 'number' ? vd.score : null,
    notes: vd?.notes ?? null,
    last_provider: vd?.last_provider ?? null,
    attempts_count: vd?.attempts_count ?? null,
    had_rejection: vd?.had_rejection ?? false,
    rejected_by: vd?.rejected_by ?? [],
  }

  return json({ org, contact, verification }, 200)
}
