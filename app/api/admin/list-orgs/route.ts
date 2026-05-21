import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/list-orgs?status=pending|approved|rejected|all
 *
 * Liste des organisations pour le back-office admin (B5).
 *
 * Garde admin per-route via requireAdmin (D2). Données servies depuis le
 * service_role Supabase, donc RLS bypassed (D3 — aucune policy admin).
 *
 * Filtres `status` :
 *   - pending  → verification_status='pending_admin_review'
 *   - approved → verification_status='approved'
 *   - rejected → verification_status='rejected'
 *   - all      → pas de filtre
 *
 * Tri : pending par created_at DESC (nouveaux d'abord) ;
 *       approved/rejected par verified_at DESC (décisions récentes en haut) ;
 *       all par created_at DESC.
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
    .from('organizations')
    .select(
      'id, company_name, logo_url, siren, org_type, verification_status, verification_data, verification_method, created_at, verified_at, verified_by, review_reason',
    )

  if (status === 'pending') {
    query = query.eq('verification_status', 'pending_admin_review')
    query = query.order('created_at', { ascending: false })
  } else if (status === 'approved') {
    query = query.eq('verification_status', 'approved')
    query = query.order('verified_at', { ascending: false, nullsFirst: false })
  } else if (status === 'rejected') {
    query = query.eq('verification_status', 'rejected')
    query = query.order('verified_at', { ascending: false, nullsFirst: false })
  } else {
    // all
    query = query.order('created_at', { ascending: false })
  }

  const { data, error } = await query.limit(500)
  if (error) {
    console.error('[admin:list-orgs] query failed', error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  return json({ orgs: data ?? [] }, 200)
}
