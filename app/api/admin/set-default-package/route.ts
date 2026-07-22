import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/set-default-package
 * Body : { package_id: uuid }
 *
 * TRANSFERT du statut « package par défaut » (jamais une décoche).
 *
 * INVARIANT garanti côté serveur : à tout moment il existe EXACTEMENT UN
 * package par défaut ACTIF par target_role (client, cabinet). Le seul geste
 * possible est « définir X comme défaut » : l'ancien défaut de la MÊME cible
 * passe is_default=false et X passe is_default=true. On ne peut pas retirer le
 * défaut sans le transférer — l'UI n'expose donc aucune case à cocher libre.
 *
 * Refus (400, code explicite) :
 *  - X inactif                → 'package_inactive' (un défaut doit être actif)
 *  - X est déjà le défaut     → 'already_default'  (no-op poli)
 *
 * ORDRE : (1) requireAdmin → (2) charge X + l'ancien défaut de la même cible
 * → (3) valide → (4) SNAPSHOT des DEUX packages dans package_history AVANT
 * modif → (5) applique (ancien false PUIS nouveau true) → (6) vérification
 * post-état + rollback best-effort si l'invariant est cassé → (7) audit.
 *
 * NB : c'est ce champ is_default que lit lib/entitlements.ts pour rattacher les
 * NOUVELLES inscriptions. Les organisations déjà rattachées ne bougent pas.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/** Motif automatique horodaté du transfert (colonne change_reason, 200 max). */
function transferReason(fromSlug: string | null, toSlug: string, role: string): string {
  return `default transfer (${role}): ${fromSlug ?? 'none'} → ${toSlug}`.slice(0, 200)
}

type PackageRow = {
  id: string
  name: string
  slug: string
  target_role: string
  is_default: boolean
  active: boolean
}

export async function POST(request: NextRequest): Promise<Response> {
  // ── (1) Garde admin ────────────────────────────────────────────────────────
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  let body: { package_id?: unknown }
  try {
    body = (await request.json()) as { package_id?: unknown }
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const packageId = typeof body.package_id === 'string' ? body.package_id.trim() : ''
  if (!packageId || !UUID_REGEX.test(packageId)) {
    return json({ error: 'Invalid package_id', code: 'invalid_id' }, 400)
  }

  // ── (2) Charge le package cible ────────────────────────────────────────────
  const { data: target, error: tgtErr } = await auth.supabaseAdmin
    .from('packages')
    .select('*')
    .eq('id', packageId)
    .maybeSingle()
  if (tgtErr) {
    console.error('[admin:set-default-package] package lookup failed', tgtErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!target) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }
  const targetPkg = target as PackageRow

  // ── (3) Validation de l'invariant ──────────────────────────────────────────
  if (targetPkg.is_default) {
    // No-op poli : on refuse plutôt que d'écrire une trace d'audit vide.
    return json({ error: 'Already the default package', code: 'already_default' }, 400)
  }
  if (!targetPkg.active) {
    // Un package par défaut DOIT être actif : sinon les nouvelles inscriptions
    // seraient rattachées à une offre désactivée.
    return json({ error: 'Package is inactive', code: 'package_inactive' }, 400)
  }

  // Ancien défaut de la MÊME cible (0 ou 1 ligne attendue).
  const { data: previousRows, error: prevErr } = await auth.supabaseAdmin
    .from('packages')
    .select('*')
    .eq('target_role', targetPkg.target_role)
    .eq('is_default', true)
  if (prevErr) {
    console.error('[admin:set-default-package] previous default lookup failed', prevErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const previous = ((previousRows ?? []) as PackageRow[]).filter((p) => p.id !== packageId)

  // ── (4) SNAPSHOT des DEUX packages AVANT modif ─────────────────────────────
  const changeReason = transferReason(previous[0]?.slug ?? null, targetPkg.slug, targetPkg.target_role)
  const historyRows = [targetPkg, ...previous].map((p) => ({
    package_id: p.id,
    snapshot: { package: p },
    changed_by: auth.user.id,
    change_reason: changeReason,
  }))
  const { error: histErr } = await auth.supabaseAdmin.from('package_history').insert(historyRows)
  if (histErr) {
    // On refuse d'appliquer sans trace : le snapshot est la garantie d'auditabilité.
    console.error('[admin:set-default-package] history snapshot failed', histErr.message)
    return json({ error: 'Snapshot failed', code: 'db_error' }, 500)
  }

  // ── (5) Application : on retire l'ancien défaut PUIS on pose le nouveau ─────
  // Ordre volontaire — un instant sans défaut est préférable à deux défauts
  // concurrents (lib/entitlements retomberait alors sur un choix arbitraire).
  const now = new Date().toISOString()
  if (previous.length > 0) {
    const { error: unsetErr } = await auth.supabaseAdmin
      .from('packages')
      .update({ is_default: false, updated_at: now })
      .eq('target_role', targetPkg.target_role)
      .eq('is_default', true)
      .neq('id', packageId)
    if (unsetErr) {
      console.error('[admin:set-default-package] unset previous failed', unsetErr.message)
      return json({ error: 'Update failed', code: 'db_error' }, 500)
    }
  }

  const { error: setErr } = await auth.supabaseAdmin
    .from('packages')
    .update({ is_default: true, updated_at: now })
    .eq('id', packageId)
  if (setErr) {
    console.error('[admin:set-default-package] set new default failed', setErr.message)
    // Rollback best-effort : on restaure l'ancien défaut pour ne pas laisser la
    // cible sans package par défaut.
    if (previous.length > 0) {
      await auth.supabaseAdmin
        .from('packages')
        .update({ is_default: true, updated_at: now })
        .eq('id', previous[0].id)
    }
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  // ── (6) Vérification post-état : exactement 1 défaut pour cette cible ───────
  const { data: afterRows, error: afterErr } = await auth.supabaseAdmin
    .from('packages')
    .select('id, slug, active')
    .eq('target_role', targetPkg.target_role)
    .eq('is_default', true)
  if (afterErr) {
    console.error('[admin:set-default-package] post-check failed', afterErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const after = (afterRows ?? []) as { id: string }[]
  if (after.length !== 1 || after[0].id !== packageId) {
    console.error('[admin:set-default-package] INVARIANT BROKEN', {
      target_role: targetPkg.target_role,
      defaults: after.map((r) => r.id),
    })
    return json({ error: 'Default invariant broken', code: 'invariant_broken' }, 500)
  }

  // ── (7) Audit ──────────────────────────────────────────────────────────────
  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'package_default_changed',
    entity_type: 'package',
    entity_id: packageId,
    detail: {
      target_role: targetPkg.target_role,
      new_default: { id: targetPkg.id, slug: targetPkg.slug, name: targetPkg.name },
      previous_default:
        previous.length > 0
          ? { id: previous[0].id, slug: previous[0].slug, name: previous[0].name }
          : null,
      change_reason: changeReason,
    },
  })

  return json(
    {
      ok: true,
      package_id: packageId,
      target_role: targetPkg.target_role,
      previous_default_id: previous[0]?.id ?? null,
    },
    200,
  )
}
