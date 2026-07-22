import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/update-package
 * Body : {
 *   package_id: uuid,
 *   name?: string,                        // non vide, <= 100 car.
 *   price_monthly?: number|null|string,   // numeric >= 0 ou null
 *   price_yearly?:  number|null|string,
 *   active?: boolean,
 *   features?: { feature_code: string, value: string|number }[],  // entier>=0 ou 'unlimited'
 *   change_reason?: string
 * }
 *
 * ÉDITION SEULE (Lot 3) : aucune création/suppression de package ni de feature.
 *  - Un feature_code absent de package_features pour CE package → 400 'unknown_feature'
 *    (aucun insert implicite).
 *  - Value : entier >= 0 OU la chaîne 'unlimited' — rien d'autre → 400 'invalid_feature_value'.
 *  - Prix : numeric >= 0 ou null → sinon 400 'invalid_price'.
 *
 * ORDRE : (1) requireAdmin → (2) charge package + features actuels → (3) valide
 * → (4) SNAPSHOT complet dans package_history AVANT toute modif → (5) applique.
 * Garde admin per-route via requireAdmin. service_role.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

type Body = {
  package_id?: unknown
  name?: unknown
  price_monthly?: unknown
  price_yearly?: unknown
  active?: unknown
  features?: unknown
  change_reason?: unknown
}

/** Prix : number>=0, null, ou chaîne numérique>=0/vide(→null). Sinon invalide. */
function validatePrice(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v === null) return { ok: true, value: null }
  if (typeof v === 'number') {
    return Number.isFinite(v) && v >= 0 ? { ok: true, value: v } : { ok: false }
  }
  if (typeof v === 'string') {
    const t = v.trim()
    if (t === '') return { ok: true, value: null }
    const n = Number(t)
    if (Number.isFinite(n) && n >= 0) return { ok: true, value: n }
  }
  return { ok: false }
}

/** Value de feature : entier>=0 (normalisé en décimal canonique) ou 'unlimited'. */
function validateFeatureValue(v: unknown): { ok: true; value: string } | { ok: false } {
  if (typeof v === 'number') {
    return Number.isInteger(v) && v >= 0 ? { ok: true, value: String(v) } : { ok: false }
  }
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase()
    if (t === 'unlimited') return { ok: true, value: 'unlimited' }
    if (/^\d+$/.test(t)) return { ok: true, value: String(parseInt(t, 10)) }
  }
  return { ok: false }
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const packageId = typeof body.package_id === 'string' ? body.package_id.trim() : ''
  if (!packageId || !UUID_REGEX.test(packageId)) {
    return json({ error: 'Invalid package_id', code: 'invalid_id' }, 400)
  }

  // ── (2) Charge le package + ses features actuels (pour snapshot + validation) ─
  const { data: pkg, error: pkgErr } = await auth.supabaseAdmin
    .from('packages')
    .select('*')
    .eq('id', packageId)
    .maybeSingle()
  if (pkgErr) {
    console.error('[admin:update-package] package lookup failed', pkgErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!pkg) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }

  const { data: currentFeats, error: featErr } = await auth.supabaseAdmin
    .from('package_features')
    .select('id, feature_code, value, reset_period')
    .eq('package_id', packageId)
  if (featErr) {
    console.error('[admin:update-package] features lookup failed', featErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const existingCodes = new Set(
    ((currentFeats ?? []) as { feature_code: string }[]).map((f) => f.feature_code),
  )

  // ── (3) Validation ─────────────────────────────────────────────────────────
  const has = (k: keyof Body) => Object.prototype.hasOwnProperty.call(body, k)

  const packageUpdates: Record<string, unknown> = {}

  // Le NOM est éditable (l'admin renomme une offre sans la recréer). La CIBLE
  // ne l'est pas : la changer retirerait leurs droits aux organisations déjà
  // rattachées — l'admin crée une nouvelle offre puis migre les organisations.
  if (has('name')) {
    const n = typeof body.name === 'string' ? body.name.trim() : ''
    if (!n || n.length > 100) return json({ error: 'Invalid name', code: 'invalid_name' }, 400)
    packageUpdates.name = n
  }
  if (has('price_monthly')) {
    const r = validatePrice(body.price_monthly)
    if (!r.ok) return json({ error: 'Invalid price_monthly', code: 'invalid_price' }, 400)
    packageUpdates.price_monthly = r.value
  }
  if (has('price_yearly')) {
    const r = validatePrice(body.price_yearly)
    if (!r.ok) return json({ error: 'Invalid price_yearly', code: 'invalid_price' }, 400)
    packageUpdates.price_yearly = r.value
  }
  if (has('active')) {
    if (typeof body.active !== 'boolean') {
      return json({ error: 'Invalid active', code: 'invalid_active' }, 400)
    }
    packageUpdates.active = body.active
  }

  const featureUpdates: { feature_code: string; value: string }[] = []
  if (has('features')) {
    if (!Array.isArray(body.features)) {
      return json({ error: 'Invalid features', code: 'invalid_features' }, 400)
    }
    for (const raw of body.features) {
      const item = raw as { feature_code?: unknown; value?: unknown }
      const code = typeof item.feature_code === 'string' ? item.feature_code.trim() : ''
      if (!code) return json({ error: 'Invalid feature_code', code: 'invalid_features' }, 400)
      // Édition seule : aucun insert implicite d'une feature absente.
      if (!existingCodes.has(code)) {
        return json({ error: 'Unknown feature for this package', code: 'unknown_feature', feature_code: code }, 400)
      }
      const vr = validateFeatureValue(item.value)
      if (!vr.ok) {
        return json({ error: 'Invalid feature value', code: 'invalid_feature_value', feature_code: code }, 400)
      }
      featureUpdates.push({ feature_code: code, value: vr.value })
    }
  }

  if (Object.keys(packageUpdates).length === 0 && featureUpdates.length === 0) {
    return json({ error: 'Nothing to update', code: 'no_changes' }, 400)
  }

  // ── (4) SNAPSHOT complet AVANT modif (package + features) ───────────────────
  const changeReason =
    typeof body.change_reason === 'string' && body.change_reason.trim().length > 0
      ? body.change_reason.trim().slice(0, 200)
      : null
  const { error: histErr } = await auth.supabaseAdmin.from('package_history').insert({
    package_id: packageId,
    snapshot: { package: pkg, features: currentFeats ?? [] },
    changed_by: auth.user.id,
    change_reason: changeReason,
  })
  if (histErr) {
    // On refuse d'appliquer sans trace : le snapshot est la garantie d'auditabilité.
    console.error('[admin:update-package] history snapshot failed', histErr.message)
    return json({ error: 'Snapshot failed', code: 'db_error' }, 500)
  }

  // ── (5) Application ─────────────────────────────────────────────────────────
  if (Object.keys(packageUpdates).length > 0) {
    packageUpdates.updated_at = new Date().toISOString()
    const { error: updErr } = await auth.supabaseAdmin
      .from('packages')
      .update(packageUpdates)
      .eq('id', packageId)
    if (updErr) {
      console.error('[admin:update-package] package update failed', updErr.message)
      return json({ error: 'Update failed', code: 'db_error' }, 500)
    }
  }

  for (const fu of featureUpdates) {
    const { error: fuErr } = await auth.supabaseAdmin
      .from('package_features')
      .update({ value: fu.value })
      .eq('package_id', packageId)
      .eq('feature_code', fu.feature_code)
    if (fuErr) {
      console.error('[admin:update-package] feature update failed', fu.feature_code, fuErr.message)
      return json({ error: 'Feature update failed', code: 'db_error' }, 500)
    }
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'package_updated',
    entity_type: 'package',
    entity_id: packageId,
    detail: {
      package_fields: Object.keys(packageUpdates),
      features: featureUpdates,
      change_reason: changeReason,
    },
  })

  return json({ ok: true, package_id: packageId }, 200)
}
