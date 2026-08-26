import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { applyDefaultTransfer, isTargetRole } from '@/lib/package-default'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/create-package
 * Body : {
 *   name: string,                          // requis, affiché
 *   slug?: string,                         // sinon dérivé du nom ; suffixé si collision
 *   target_role: 'client'|'cabinet'|'all'|'collaboration',
 *     // 'all'           = UNE offre couvrant les deux cibles ENTREPRISE
 *     // 'collaboration' = offre de sous-traitance entre experts (monde disjoint,
 *     //                   jamais couvert par 'all')
 *   price_monthly?: number|string|null,    // vide/null = gratuit
 *   price_yearly?:  number|string|null,
 *   currency?: string,                     // défaut EUR
 *   active?: boolean,                      // défaut true
 *   is_default?: boolean,                  // applique l'invariant de couverture
 *   features?: { feature_code, value }[],  // entier >= 0 ou 'unlimited'
 * }
 *
 * CONTRÔLE TOTAL DE L'ADMIN : aucune valeur n'est imposée. L'offre peut être
 * créée active ou non, par défaut ou non, avec les limites voulues.
 *
 * ORDRE : (1) requireAdmin → (2) valide TOUT (rien n'est écrit avant) →
 * (3) slug unique par cible → (4) insert package → (5) insert features →
 * (6) snapshot package_history (création) → (7) transfert du défaut si demandé
 * — via la RPC atomique set_default_package (lib/package-default) → (8)
 * logAudit 'package_created'.
 *
 * COHÉRENCE : is_default exige active — une offre par défaut inactive laisserait
 * une cible sans offre à l'inscription → 400 'default_requires_active'.
 * Si le transfert du défaut est refusé (couverture rompue), l'offre reste créée
 * mais NON par défaut : la réponse le signale (default_applied:false + code).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Prix : number>=0, null, ou chaîne numérique>=0/vide(→null). Sinon invalide. */
function validatePrice(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v === null || v === undefined) return { ok: true, value: null }
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

/** Value de feature : entier>=0 (normalisé) ou 'unlimited'. */
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

/** Slugifie un nom : minuscules, accents retirés, non-alphanum → tiret. */
function slugify(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritiques combinants
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

/**
 * reset_period déduite de la NATURE de la feature (convention du seed Lot 1) :
 * *_per_month → 'monthly', sinon 'never'.
 */
function resetPeriodFor(code: string): string {
  return code.endsWith('_per_month') ? 'monthly' : 'never'
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

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  // ── (2) Validation COMPLÈTE avant toute écriture ───────────────────────────
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return json({ error: 'Name is required', code: 'invalid_name' }, 400)
  if (name.length > 100) return json({ error: 'Name too long', code: 'invalid_name' }, 400)

  const targetRole = body.target_role
  if (!isTargetRole(targetRole)) {
    return json({ error: 'Invalid target_role', code: 'invalid_target_role' }, 400)
  }

  const pm = validatePrice(body.price_monthly)
  if (!pm.ok) return json({ error: 'Invalid price_monthly', code: 'invalid_price' }, 400)
  const py = validatePrice(body.price_yearly)
  if (!py.ok) return json({ error: 'Invalid price_yearly', code: 'invalid_price' }, 400)

  const currency =
    typeof body.currency === 'string' && /^[A-Za-z]{3}$/.test(body.currency.trim())
      ? body.currency.trim().toUpperCase()
      : 'EUR'

  const active = typeof body.active === 'boolean' ? body.active : true
  const wantDefault = body.is_default === true

  // Une offre par défaut doit être active (sinon cible orpheline à l'inscription).
  if (wantDefault && !active) {
    return json({ error: 'A default package must be active', code: 'default_requires_active' }, 400)
  }

  const features: { feature_code: string; value: string; reset_period: string }[] = []
  if (body.features !== undefined) {
    if (!Array.isArray(body.features)) {
      return json({ error: 'Invalid features', code: 'invalid_features' }, 400)
    }
    const seen = new Set<string>()
    for (const raw of body.features) {
      const item = raw as { feature_code?: unknown; value?: unknown }
      const code = typeof item.feature_code === 'string' ? item.feature_code.trim() : ''
      if (!code) return json({ error: 'Invalid feature_code', code: 'invalid_features' }, 400)
      if (seen.has(code)) {
        return json({ error: 'Duplicate feature', code: 'duplicate_feature', feature_code: code }, 400)
      }
      seen.add(code)
      const vr = validateFeatureValue(item.value)
      if (!vr.ok) {
        return json({ error: 'Invalid feature value', code: 'invalid_feature_value', feature_code: code }, 400)
      }
      features.push({ feature_code: code, value: vr.value, reset_period: resetPeriodFor(code) })
    }
  }

  // Les feature_code doivent exister au dictionnaire (pas d'invention de droit).
  if (features.length > 0) {
    const { data: known, error: knownErr } = await auth.supabaseAdmin
      .from('features')
      .select('code')
      .in('code', features.map((f) => f.feature_code))
    if (knownErr) {
      console.error('[admin:create-package] features dictionary lookup failed', knownErr.message)
      return json({ error: 'Query failed', code: 'db_error' }, 500)
    }
    const knownCodes = new Set(((known ?? []) as { code: string }[]).map((f) => f.code))
    const unknown = features.find((f) => !knownCodes.has(f.feature_code))
    if (unknown) {
      return json(
        { error: 'Unknown feature', code: 'unknown_feature', feature_code: unknown.feature_code },
        400,
      )
    }
  }

  // ── (3) Slug unique PAR CIBLE (UNIQUE domain_id, slug, target_role) ────────
  const requested = typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim() : name
  const base = slugify(requested) || 'offre'

  const { data: taken, error: takenErr } = await auth.supabaseAdmin
    .from('packages')
    .select('slug')
    .is('domain_id', null)
    .eq('target_role', targetRole)
    .like('slug', `${base}%`)
  if (takenErr) {
    console.error('[admin:create-package] slug lookup failed', takenErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const takenSet = new Set(((taken ?? []) as { slug: string }[]).map((r) => r.slug))
  let slug = base
  for (let i = 2; takenSet.has(slug) && i < 200; i++) {
    slug = `${base.slice(0, 46)}-${i}`
  }

  // ── (4) Insert du package ──────────────────────────────────────────────────
  // is_default posé à false ici : le statut est acquis par TRANSFERT en (7),
  // seul chemin qui garantit l'invariant de couverture.
  const { data: created, error: insErr } = await auth.supabaseAdmin
    .from('packages')
    .insert({
      domain_id: null,
      name,
      slug,
      target_role: targetRole,
      scope: 'organization',
      price_monthly: pm.value,
      price_yearly: py.value,
      currency,
      is_default: false,
      active,
    })
    .select('*')
    .maybeSingle()
  if (insErr || !created) {
    console.error('[admin:create-package] insert failed', insErr?.message)
    return json({ error: 'Create failed', code: 'db_error' }, 500)
  }
  const pkg = created as { id: string; name: string; slug: string; target_role: string }

  // ── (5) Insert des limites ─────────────────────────────────────────────────
  if (features.length > 0) {
    const { error: featErr } = await auth.supabaseAdmin
      .from('package_features')
      .insert(features.map((f) => ({ ...f, package_id: pkg.id })))
    if (featErr) {
      console.error('[admin:create-package] features insert failed', featErr.message)
      // L'offre sans limites serait interprétée « tout illimité » par
      // entitlements (fail-open) : on retire la coquille plutôt que de laisser
      // une offre trop permissive au catalogue.
      await auth.supabaseAdmin.from('packages').delete().eq('id', pkg.id)
      return json({ error: 'Create failed', code: 'db_error' }, 500)
    }
  }

  // ── (6) Snapshot de création dans package_history ──────────────────────────
  await auth.supabaseAdmin.from('package_history').insert({
    package_id: pkg.id,
    snapshot: { package: created, features },
    changed_by: auth.user.id,
    change_reason: `package created (${targetRole})`,
  })

  // ── (7) Statut par défaut : transfert soumis à l'invariant de couverture ───
  let defaultApplied = false
  let defaultRefusedCode: string | null = null
  if (wantDefault) {
    const transfer = await applyDefaultTransfer(auth.supabaseAdmin, {
      packageId: pkg.id,
      targetRole,
      userId: auth.user.id,
      changeReason: `default transfer on creation (${targetRole}) → ${slug}`,
    })
    if (transfer.ok) {
      defaultApplied = true
    } else {
      // L'offre reste créée : on ne perd pas la saisie de l'admin. Seul le
      // statut par défaut est refusé, et l'UI l'annonce explicitement.
      defaultRefusedCode = transfer.code
    }
  }

  // ── (8) Audit ──────────────────────────────────────────────────────────────
  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'package_created',
    entity_type: 'package',
    entity_id: pkg.id,
    detail: {
      name,
      slug,
      target_role: targetRole,
      price_monthly: pm.value,
      price_yearly: py.value,
      currency,
      active,
      features,
      default_requested: wantDefault,
      default_applied: defaultApplied,
      default_refused_code: defaultRefusedCode,
    },
  })

  return json(
    {
      ok: true,
      package_id: pkg.id,
      slug,
      default_applied: defaultApplied,
      ...(defaultRefusedCode ? { default_refused_code: defaultRefusedCode } : {}),
    },
    200,
  )
}
