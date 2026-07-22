import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { COVERAGE_TARGETS, covers } from '@/lib/package-default'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/migrate-org-packages
 * Body : { from_package_id: uuid, to_package_id: uuid, preview?: boolean }
 *
 * MIGRATION DE MASSE : déplace toutes les organisations rattachées à l'offre
 * source vers l'offre cible.
 *
 * preview:true → ne modifie RIEN, retourne seulement { count } : le nombre
 * d'organisations qui seraient migrées. L'UI l'affiche avant confirmation.
 *
 * GARDES :
 *  - source ≠ cible                        → 'same_package'
 *  - les deux offres existent              → 'not_found'
 *  - cible ACTIVE                          → 'target_inactive'
 *  - COMPATIBILITÉ de cible : la cible doit couvrir toutes les cibles
 *    commerciales couvertes par la source (même cible, ou cible 'all' qui
 *    couvre tout). Migrer des cabinets vers une offre 'client' leur retirerait
 *    leurs droits → 'incompatible_target'.
 *
 * RÉVERSIBLE : l'opération est rejouable en sens inverse (source ↔ cible) tant
 * que les gardes le permettent. package_valid_until est remis à NULL (l'offre
 * migrée n'hérite pas de l'échéance de l'ancienne).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

type PackageRow = {
  id: string
  name: string
  slug: string
  target_role: string
  active: boolean
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  let body: { from_package_id?: unknown; to_package_id?: unknown; preview?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const fromId = typeof body.from_package_id === 'string' ? body.from_package_id.trim() : ''
  const toId = typeof body.to_package_id === 'string' ? body.to_package_id.trim() : ''
  if (!UUID_REGEX.test(fromId) || !UUID_REGEX.test(toId)) {
    return json({ error: 'Invalid package id', code: 'invalid_id' }, 400)
  }
  if (fromId === toId) {
    return json({ error: 'Source and target are identical', code: 'same_package' }, 400)
  }
  const preview = body.preview === true

  // ── Chargement des deux offres ─────────────────────────────────────────────
  const { data: rows, error: pkgErr } = await auth.supabaseAdmin
    .from('packages')
    .select('id, name, slug, target_role, active')
    .in('id', [fromId, toId])
  if (pkgErr) {
    console.error('[admin:migrate-org-packages] packages lookup failed', pkgErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const pkgs = (rows ?? []) as PackageRow[]
  const from = pkgs.find((p) => p.id === fromId)
  const to = pkgs.find((p) => p.id === toId)
  if (!from || !to) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }

  // ── Gardes ─────────────────────────────────────────────────────────────────
  if (!to.active) {
    return json({ error: 'Target package is inactive', code: 'target_inactive' }, 400)
  }
  // La cible doit couvrir au moins tout ce que couvre la source.
  const uncovered = COVERAGE_TARGETS.filter(
    (t) => covers(from.target_role, t) && !covers(to.target_role, t),
  )
  if (uncovered.length > 0) {
    return json(
      {
        error: 'Target package does not cover the source audience',
        code: 'incompatible_target',
        uncovered,
      },
      400,
    )
  }

  // ── Comptage (preview ET pré-contrôle de l'écriture) ───────────────────────
  const { count, error: cntErr } = await auth.supabaseAdmin
    .from('organization_domains')
    .select('organization_id', { count: 'exact', head: true })
    .eq('package_id', fromId)
  if (cntErr) {
    console.error('[admin:migrate-org-packages] count failed', cntErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const total = count ?? 0

  if (preview) {
    return json(
      {
        ok: true,
        preview: true,
        count: total,
        from: { id: from.id, name: from.name, target_role: from.target_role },
        to: { id: to.id, name: to.name, target_role: to.target_role },
      },
      200,
    )
  }

  if (total === 0) {
    return json({ ok: true, migrated: 0 }, 200)
  }

  // ── Application ────────────────────────────────────────────────────────────
  const now = new Date().toISOString()
  const { data: updated, error: updErr } = await auth.supabaseAdmin
    .from('organization_domains')
    .update({ package_id: toId, package_started_at: now, package_valid_until: null })
    .eq('package_id', fromId)
    .select('organization_id')
  if (updErr) {
    console.error('[admin:migrate-org-packages] update failed', updErr.message)
    return json({ error: 'Migration failed', code: 'db_error' }, 500)
  }
  const migrated = (updated ?? []).length

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'org_packages_migrated',
    entity_type: 'package',
    entity_id: toId,
    detail: {
      from: { id: from.id, slug: from.slug, name: from.name, target_role: from.target_role },
      to: { id: to.id, slug: to.slug, name: to.name, target_role: to.target_role },
      count: migrated,
    },
  })

  return json({ ok: true, migrated }, 200)
}
