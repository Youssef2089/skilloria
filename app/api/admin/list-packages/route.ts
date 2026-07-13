import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/list-packages
 *
 * Catalogue complet (actifs ET inactifs) pour le back-office commerce, avec les
 * features de chaque package. Garde admin per-route via requireAdmin. service_role.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { data: packages, error: pkgErr } = await auth.supabaseAdmin
    .from('packages')
    .select(
      'id, name, slug, target_role, price_monthly, price_yearly, currency, is_default, active, scope',
    )
    .order('target_role', { ascending: true })
    .order('price_monthly', { ascending: true, nullsFirst: true })

  if (pkgErr) {
    console.error('[admin:list-packages] packages query failed', pkgErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  const pkgRows = (packages ?? []) as { id: string }[]
  const ids = pkgRows.map((p) => p.id)

  const featByPkg = new Map<string, { feature_code: string; value: string; reset_period: string | null }[]>()
  if (ids.length > 0) {
    const { data: feats, error: featErr } = await auth.supabaseAdmin
      .from('package_features')
      .select('package_id, feature_code, value, reset_period')
      .in('package_id', ids)
      .order('feature_code', { ascending: true })
    if (featErr) {
      console.error('[admin:list-packages] features query failed', featErr.message)
      return json({ error: 'Query failed', code: 'db_error' }, 500)
    }
    for (const f of (feats ?? []) as {
      package_id: string
      feature_code: string
      value: string
      reset_period: string | null
    }[]) {
      const arr = featByPkg.get(f.package_id) ?? []
      arr.push({ feature_code: f.feature_code, value: f.value, reset_period: f.reset_period })
      featByPkg.set(f.package_id, arr)
    }
  }

  const result = pkgRows.map((p) => ({ ...p, features: featByPkg.get(p.id) ?? [] }))
  return json({ packages: result }, 200)
}
