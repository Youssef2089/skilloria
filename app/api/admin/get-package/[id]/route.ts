import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/get-package/[id]
 *
 * Détail d'un package (champs éditables + identité) et ses package_features
 * (feature_code, value, reset_period + name/value_type du dictionnaire features).
 * Garde admin per-route via requireAdmin. service_role.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

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
  if (!id || !UUID_REGEX.test(id)) {
    return json({ error: 'Invalid id', code: 'invalid_id' }, 400)
  }

  const { data: pkg, error: pkgErr } = await auth.supabaseAdmin
    .from('packages')
    .select(
      'id, name, slug, target_role, description, price_monthly, price_yearly, currency, is_default, active, scope, max_seats',
    )
    .eq('id', id)
    .maybeSingle()
  if (pkgErr) {
    console.error('[admin:get-package] package query failed', pkgErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!pkg) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }

  const { data: feats, error: featErr } = await auth.supabaseAdmin
    .from('package_features')
    .select('feature_code, value, reset_period')
    .eq('package_id', id)
    .order('feature_code', { ascending: true })
  if (featErr) {
    console.error('[admin:get-package] features query failed', featErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  // Dictionnaire features (name / value_type) pour l'affichage des libellés.
  const codes = ((feats ?? []) as { feature_code: string }[]).map((f) => f.feature_code)
  const dictByCode = new Map<string, { name: string; value_type: string }>()
  if (codes.length > 0) {
    const { data: dict } = await auth.supabaseAdmin
      .from('features')
      .select('code, name, value_type')
      .in('code', codes)
    for (const d of (dict ?? []) as { code: string; name: string; value_type: string }[]) {
      dictByCode.set(d.code, { name: d.name, value_type: d.value_type })
    }
  }

  const features = ((feats ?? []) as { feature_code: string; value: string; reset_period: string | null }[]).map(
    (f) => ({
      feature_code: f.feature_code,
      value: f.value,
      reset_period: f.reset_period,
      name: dictByCode.get(f.feature_code)?.name ?? f.feature_code,
      value_type: dictByCode.get(f.feature_code)?.value_type ?? null,
    }),
  )

  return json({ package: pkg, features }, 200)
}
