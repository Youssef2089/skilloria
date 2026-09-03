import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import {
  covers,
  isTargetRole,
  uncoveredTargets,
  type CoverageTarget,
  type DefaultRow,
} from '@/lib/package-default'
import { targetRoleForOrgType } from '@/lib/org-target-role'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/update-package
 * Body : {
 *   package_id: uuid,
 *   name?: string,                        // non vide, <= 100 car.
 *   target_role?: 'client'|'cabinet'|'all'|'collaboration',
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
 * GARDES FONCTIONNELLES (rien n'est écrit si l'une refuse) :
 *  - CIBLE modifiable, mais un RÉTRÉCISSEMENT est refusé s'il laisse des
 *    organisations rattachées hors de la nouvelle cible
 *    → 400 'orgs_would_be_orphaned' { count, org_type }.
 *    Élargir (client → all) est toujours autorisé.
 *  - Si l'offre est le DÉFAUT, rétrécir sa cible ne doit pas laisser une cible
 *    sans défaut → 400 'target_uncovered' (même sémantique que la RPC ;
 *    calcul délégué à lib/package-default).
 *  - DÉSACTIVER l'offre par défaut est refusé → 400 'default_requires_active'
 *    (une inscription doit toujours trouver une offre).
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
  target_role?: unknown
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
  // l'est aussi, mais sous les gardes plus bas : jamais au prix d'organisations
  // rattachées hors de la nouvelle cible, ni d'une cible privée de son défaut.
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
    // DÉSACTIVER L'OFFRE PAR DÉFAUT EST REFUSÉ : une inscription doit toujours
    // trouver une offre. L'admin désigne d'abord un autre défaut (transfert),
    // ce qui libère celle-ci.
    if (body.active === false && (pkg as { is_default: boolean }).is_default) {
      return json(
        { error: 'The default package must stay active', code: 'default_requires_active' },
        400,
      )
    }
    packageUpdates.active = body.active
  }

  // ── CIBLE : modifiable, mais jamais au prix d'organisations orphelines ─────
  if (has('target_role')) {
    if (!isTargetRole(body.target_role)) {
      return json({ error: 'Invalid target_role', code: 'invalid_target_role' }, 400)
    }
    const currentTarget = (pkg as { target_role: string }).target_role
    const nextTarget = body.target_role

    if (nextTarget !== currentTarget) {
      // (a) Organisations RATTACHÉES que la nouvelle cible ne couvrirait plus.
      //     Élargir (client → all) ne retire jamais personne : le calcul le
      //     constate de lui-même, aucun cas particulier à coder.
      //     Le rattachement se lit sur `organizations` : l'abonnement y a été
      //     hissé (cf. 20260903000000_abonnement_sur_organisation.sql).
      const { data: links, error: linkErr } = await auth.supabaseAdmin
        .from('organizations')
        .select('id')
        .eq('package_id', packageId)
      if (linkErr) {
        console.error('[admin:update-package] org links lookup failed', linkErr.message)
        return json({ error: 'Query failed', code: 'db_error' }, 500)
      }
      const orgIds = ((links ?? []) as { id: string }[]).map((l) => l.id)

      if (orgIds.length > 0) {
        const { data: orgs, error: orgErr } = await auth.supabaseAdmin
          .from('organizations')
          .select('id, org_type')
          .in('id', orgIds)
        if (orgErr) {
          console.error('[admin:update-package] orgs lookup failed', orgErr.message)
          return json({ error: 'Query failed', code: 'db_error' }, 500)
        }

        // Mapping org_type → cible commerciale : SOURCE UNIQUE partagée avec
        // lib/entitlements (une org personnelle d'expert relève de la cible
        // 'collaboration', jamais de 'client' — sinon convertir une offre
        // collaboration en offre client passerait sans rien signaler).
        const orphansByType = new Map<string, number>()
        for (const o of (orgs ?? []) as { org_type: string | null }[]) {
          const mapped = targetRoleForOrgType(o.org_type) as CoverageTarget
          if (!covers(nextTarget, mapped)) {
            orphansByType.set(o.org_type ?? mapped, (orphansByType.get(o.org_type ?? mapped) ?? 0) + 1)
          }
        }
        const orphanCount = [...orphansByType.values()].reduce((a, b) => a + b, 0)
        if (orphanCount > 0) {
          return json(
            {
              error: 'Organizations would be orphaned by this target change',
              code: 'orgs_would_be_orphaned',
              count: orphanCount,
              org_type: [...orphansByType.keys()].join(', '),
            },
            400,
          )
        }
      }

      // (b) COUVERTURE DU DÉFAUT : si CETTE offre est le défaut, rétrécir sa
      //     cible peut laisser l'autre cible orpheline. Même règle que la RPC,
      //     calculée par lib/package-default (aucune duplication).
      if ((pkg as { is_default: boolean }).is_default) {
        const { data: defRows, error: defErr } = await auth.supabaseAdmin
          .from('packages')
          .select('id, target_role')
          .eq('is_default', true)
          .eq('active', true)
        if (defErr) {
          console.error('[admin:update-package] defaults lookup failed', defErr.message)
          return json({ error: 'Query failed', code: 'db_error' }, 500)
        }
        // État résultant : cette ligne porte déjà la NOUVELLE cible.
        const resulting = ((defRows ?? []) as DefaultRow[]).map((r) =>
          r.id === packageId ? { ...r, target_role: nextTarget } : r,
        )
        const uncovered = uncoveredTargets(resulting)
        if (uncovered.length > 0) {
          return json(
            { error: 'Target change would leave an audience uncovered', code: 'target_uncovered', uncovered },
            400,
          )
        }
      }

      packageUpdates.target_role = nextTarget
    }
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
