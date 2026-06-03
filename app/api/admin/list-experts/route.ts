import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/list-experts?status=pending|approved|rejected|all
 *
 * Mirror /api/admin/list-orgs. Liste les profils experts pour le back-office.
 *
 * Filtres `status` :
 *   - pending  → verification_status='pending_admin_review'
 *   - approved → verification_status='approved'
 *   - rejected → verification_status='rejected'
 *   - all      → pas de filtre
 *
 * Tri : pending par updated_at DESC, approved/rejected par verified_at DESC.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const VALID_STATUSES = ['pending', 'approved', 'rejected', 'all'] as const
type StatusFilter = (typeof VALID_STATUSES)[number]

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const url = new URL(request.url)
  const statusRaw = url.searchParams.get('status') ?? 'pending'
  const status: StatusFilter = (VALID_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as StatusFilter)
    : 'pending'

  let query = auth.supabaseAdmin
    .from('profiles')
    .select(
      'id, user_id, expert_type, title, seniority, years_experience, ' +
        'verification_status, verification_score, verified_at, verified_by, review_reason, ' +
        'created_at, updated_at, photo_url, ' +
        'users!profiles_user_id_fkey(id, email, first_name, last_name, locale, user_type)',
    )

  if (status === 'pending') {
    query = query.eq('verification_status', 'pending_admin_review').order('updated_at', { ascending: false })
  } else if (status === 'approved') {
    query = query.eq('verification_status', 'approved').order('verified_at', { ascending: false, nullsFirst: false })
  } else if (status === 'rejected') {
    query = query.eq('verification_status', 'rejected').order('verified_at', { ascending: false, nullsFirst: false })
  } else {
    query = query.not('verification_status', 'is', null).order('updated_at', { ascending: false })
  }

  const { data, error } = await query.limit(500)
  if (error) {
    console.error('[admin:list-experts] query failed', error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  return json({ experts: data ?? [] }, 200)
}
