import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { signAvatarUrl } from '@/lib/avatar'

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

  // Mode comptes : renvoie le nombre exact de profils par statut (head count,
  // pas de limite de lignes), pour alimenter les compteurs des 4 onglets.
  // Sémantique alignée sur le filtrage de la liste ci-dessous :
  //   pending = 'pending_admin_review', approved/rejected idem,
  //   all = verification_status NON nul (mêmes profils que l'onglet "Tous").
  if (url.searchParams.get('counts') === '1') {
    const base = () =>
      auth.supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true })
    const [pending, approved, rejected, all] = await Promise.all([
      base().eq('verification_status', 'pending_admin_review'),
      base().eq('verification_status', 'approved'),
      base().eq('verification_status', 'rejected'),
      base().not('verification_status', 'is', null),
    ])
    const firstErr = pending.error || approved.error || rejected.error || all.error
    if (firstErr) {
      console.error('[admin:list-experts] counts failed', firstErr.message)
      return json({ error: 'Query failed', code: 'db_error' }, 500)
    }
    return json(
      {
        counts: {
          pending: pending.count ?? 0,
          approved: approved.count ?? 0,
          rejected: rejected.count ?? 0,
          all: all.count ?? 0,
        },
      },
      200,
    )
  }

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

  // M3 : photo_url est un chemin storage. Admin voit tout -> on signe
  // systématiquement (URL signée 300s) quand une photo est présente. Seule la
  // VALEUR change ; les autres champs et la condition d'accès restent identiques.
  const rows = (data ?? []) as unknown as Array<Record<string, unknown> & { user_id: string; photo_url: string | null }>
  const experts = await Promise.all(
    rows.map(async (r) => ({
      ...r,
      photo_url: r.photo_url ? await signAvatarUrl(auth.supabaseAdmin, r.user_id) : null,
    })),
  )

  return json({ experts }, 200)
}
