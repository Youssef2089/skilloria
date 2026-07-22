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

  const orgs = (data ?? []) as { id: string; org_type: string | null }[]

  // ── Offre EFFECTIVE de chaque organisation (vue d'ensemble) ────────────────
  // Même résolution que lib/entitlements.ts : rattachement explicite non expiré,
  // sinon offre par défaut couvrant la cible de l'org (spécifique ou 'all').
  // Best-effort : une erreur ici ne doit pas casser la liste des organisations.
  const packageByOrg = new Map<string, { name: string; expired: boolean; fallback: boolean }>()
  try {
    const orgIds = orgs.map((o) => o.id)

    // Offres du catalogue (nom + cible + statut par défaut), en une lecture.
    const { data: pkgRows } = await auth.supabaseAdmin
      .from('packages')
      .select('id, name, target_role, is_default, active')
    const pkgs = (pkgRows ?? []) as {
      id: string
      name: string
      target_role: string
      is_default: boolean
      active: boolean
    }[]
    const pkgById = new Map(pkgs.map((p) => [p.id, p]))

    /** Offre par défaut couvrant une cible : ligne spécifique, sinon 'all'. */
    const defaultFor = (target: string) =>
      pkgs.find((p) => p.is_default && p.active && p.target_role === target) ??
      pkgs.find((p) => p.is_default && p.active && p.target_role === 'all') ??
      null

    const linkByOrg = new Map<string, { package_id: string | null; package_valid_until: string | null }>()
    if (orgIds.length > 0) {
      const { data: links } = await auth.supabaseAdmin
        .from('organization_domains')
        .select('organization_id, package_id, package_valid_until')
        .eq('domain_id', auth.domain.id)
        .in('organization_id', orgIds)
      for (const l of (links ?? []) as {
        organization_id: string
        package_id: string | null
        package_valid_until: string | null
      }[]) {
        linkByOrg.set(l.organization_id, {
          package_id: l.package_id,
          package_valid_until: l.package_valid_until,
        })
      }
    }

    for (const o of orgs) {
      const link = linkByOrg.get(o.id)
      const linked = link?.package_id ? pkgById.get(link.package_id) : undefined
      const expired =
        !!link?.package_valid_until && new Date(link.package_valid_until).getTime() <= Date.now()

      if (linked && !expired && linked.active) {
        packageByOrg.set(o.id, { name: linked.name, expired: false, fallback: false })
        continue
      }
      // Rattachement expiré : on affiche l'offre échue (mention « expiré » côté
      // UI) — l'admin doit voir ce qui a expiré, pas seulement le repli.
      if (linked && expired) {
        packageByOrg.set(o.id, { name: linked.name, expired: true, fallback: false })
        continue
      }
      // Repli sur l'offre par défaut (mapping esn→cabinet, cf. entitlements).
      const target = o.org_type === 'cabinet' || o.org_type === 'esn' ? 'cabinet' : 'client'
      const def = defaultFor(target)
      if (def) packageByOrg.set(o.id, { name: def.name, expired: false, fallback: true })
    }
  } catch (err) {
    console.warn(
      '[admin:list-orgs] package resolution failed — liste servie sans la colonne Offre',
      err instanceof Error ? err.message : String(err),
    )
  }

  const result = orgs.map((o) => ({ ...o, package: packageByOrg.get(o.id) ?? null }))
  return json({ orgs: result }, 200)
}
