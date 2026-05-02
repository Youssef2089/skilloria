import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthError } from '@/lib/auth-guard'

/**
 * Helper packages flexibles — Lot B6 du sprint archi-orga.
 *
 * Trois fonctions exportées :
 *   - loadOrgPackage()       : retourne le package actif (org, domain)
 *   - consumeQuota()         : décide si un user peut consommer 1 unité d'une feature
 *   - checkSeatsAvailable()  : V1 = blocage strict si dépassement de max_seats
 *
 * NON appelé par les routes existantes (freelance/CDI ne consomment pas
 * encore de quota). Sera branché en B5 sur les routes mission/payment/match.
 *
 * V1 — Limites du stub :
 *   - Pas de table `quota_consumption` encore : `consumeQuota()` ne fait que
 *     lire la limite et retourner `{ limit, scope, can_consume_now: true }`.
 *     Le compteur réel (incrément) sera branché en B5 sur les routes qui
 *     créent des entités quotables (mission, message, etc.).
 *   - `feature_value` parsé en number si possible, sinon traité comme illimité
 *     (ex. "unlimited", "true").
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type PackageScope = 'organization' | 'user' | 'organization_per_seat'

export type PackageRow = {
  id: string
  slug: string
  name: string
  scope: PackageScope
  included_domain_ids: string[] | null
  max_seats: number | null
}

export type PackageFeatureRow = {
  feature_code: string
  value: string
  reset_period: string | null
}

export type ConsumeQuotaContext = {
  supabaseAdmin: SupabaseClient
  user: { id: string }
  organization: { id: string } | null
  feature_code: string
  /** Domaine actif (org peut avoir un package par domaine). */
  domain_id?: string | null
}

export type QuotaDecision = {
  allowed: boolean
  scope: PackageScope | null
  /** `null` si feature pas trouvée ou illimitée. */
  limit: number | null
  /** `true` si la feature est explicitement "unlimited" / "true". */
  unlimited: boolean
  /** Code d'erreur si `allowed=false`. */
  reason?:
    | 'no_package'
    | 'feature_missing'
    | 'limit_reached_TODO_B5'
}

// ─── Helpers internes ────────────────────────────────────────────────────────

function parseFeatureValue(raw: string): { numeric: number | null; unlimited: boolean } {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed === 'unlimited' || trimmed === 'true' || trimmed === '-1') {
    return { numeric: null, unlimited: true }
  }
  const n = Number(trimmed)
  if (Number.isFinite(n) && n >= 0) {
    return { numeric: n, unlimited: false }
  }
  return { numeric: null, unlimited: false }
}

// ─── 1. loadOrgPackage ───────────────────────────────────────────────────────

/**
 * Retourne le package actif lié au couple (org, domain).
 *
 * - Cherche d'abord dans `organization_domains` la ligne (org, domain) active
 *   pour récupérer `package_id`.
 * - Si `domain_id` est omis : prend la 1ère ligne active de l'org
 *   (V1 = 1 org peut avoir N domaines, mais en pratique 1 seul à l'inscription).
 * - Renvoie `null` si pas de package attaché (ex. juste après register-org).
 */
export async function loadOrgPackage(
  supabaseAdmin: SupabaseClient,
  organization_id: string,
  domain_id?: string | null,
): Promise<PackageRow | null> {
  let q = supabaseAdmin
    .from('organization_domains')
    .select('package_id')
    .eq('organization_id', organization_id)
    .eq('active', true)
    .not('package_id', 'is', null)
    .limit(1)

  if (domain_id) q = q.eq('domain_id', domain_id)

  const { data: linkRow, error: linkErr } = await q.maybeSingle()
  if (linkErr) {
    console.error('[packages:loadOrgPackage] organization_domains lookup error', linkErr.message)
    return null
  }
  if (!linkRow?.package_id) return null

  const { data: pkg, error: pkgErr } = await supabaseAdmin
    .from('packages')
    .select('id, slug, name, scope, included_domain_ids, max_seats')
    .eq('id', linkRow.package_id)
    .eq('active', true)
    .maybeSingle()
  if (pkgErr || !pkg) {
    console.error('[packages:loadOrgPackage] packages lookup error', pkgErr?.message)
    return null
  }

  return {
    id: pkg.id as string,
    slug: pkg.slug as string,
    name: pkg.name as string,
    scope: ((pkg.scope as string) ?? 'user') as PackageScope,
    included_domain_ids: (pkg.included_domain_ids as string[] | null) ?? null,
    max_seats: (pkg.max_seats as number | null) ?? null,
  }
}

async function loadFeature(
  supabaseAdmin: SupabaseClient,
  package_id: string,
  feature_code: string,
): Promise<PackageFeatureRow | null> {
  const { data, error } = await supabaseAdmin
    .from('package_features')
    .select('feature_code, value, reset_period')
    .eq('package_id', package_id)
    .eq('feature_code', feature_code)
    .maybeSingle()
  if (error || !data) return null
  return {
    feature_code: data.feature_code as string,
    value: data.value as string,
    reset_period: (data.reset_period as string | null) ?? null,
  }
}

// ─── 2. consumeQuota ─────────────────────────────────────────────────────────

/**
 * Décide si le user (et son org éventuelle) peut consommer 1 unité d'une feature.
 *
 * Logique :
 *   - Si user n'a PAS d'org → freelance/CDI → on lit son package via une logique
 *     V2 (table `user_packages` ?) ; pour V1 on retourne `allowed: true,
 *     unlimited: true` tant que la stack freelance/CDI n'a pas de quota.
 *   - Si user a une org → loadOrgPackage(), puis loadFeature(feature_code).
 *   - Selon `scope` :
 *     - 'user'                    → quota individuel (compteur par user)
 *     - 'organization'            → quota partagé (compteur par org)
 *     - 'organization_per_seat'   → limit_effective = limit × max_seats
 *   - V1 : on vérifie uniquement la **limite déclarée** (pas le compteur réel).
 *     Le compteur réel sera implémenté en B5 sur les routes qui créent les
 *     entités quotables (mission, message, etc.). Cf. TODO B5.
 *
 * Erreur typée : si appelé sans org là où une org est attendue, retourne
 * `{ allowed: false, reason: 'no_package' }` — laisse au caller le soin
 * de transformer en HTTP 403 si besoin.
 */
export async function consumeQuota(ctx: ConsumeQuotaContext): Promise<QuotaDecision> {
  const { supabaseAdmin, organization, feature_code } = ctx

  // Path freelance/CDI (pas d'org) : V1 = pas de quota → autorise.
  if (!organization) {
    return {
      allowed: true,
      scope: null,
      limit: null,
      unlimited: true,
    }
  }

  const pkg = await loadOrgPackage(supabaseAdmin, organization.id, ctx.domain_id ?? null)
  if (!pkg) {
    return {
      allowed: false,
      scope: null,
      limit: null,
      unlimited: false,
      reason: 'no_package',
    }
  }

  const feature = await loadFeature(supabaseAdmin, pkg.id, feature_code)
  if (!feature) {
    return {
      allowed: false,
      scope: pkg.scope,
      limit: null,
      unlimited: false,
      reason: 'feature_missing',
    }
  }

  const { numeric, unlimited } = parseFeatureValue(feature.value)
  if (unlimited) {
    return { allowed: true, scope: pkg.scope, limit: null, unlimited: true }
  }

  // Limite effective selon le scope
  let effectiveLimit = numeric ?? 0
  if (pkg.scope === 'organization_per_seat' && pkg.max_seats && pkg.max_seats > 0) {
    effectiveLimit = (numeric ?? 0) * pkg.max_seats
  }

  // [TODO B5] Lire le compteur réel et comparer.
  // Pour l'instant : on autorise tant que la limite est > 0.
  if (effectiveLimit <= 0) {
    return {
      allowed: false,
      scope: pkg.scope,
      limit: 0,
      unlimited: false,
      reason: 'limit_reached_TODO_B5',
    }
  }

  return {
    allowed: true,
    scope: pkg.scope,
    limit: effectiveLimit,
    unlimited: false,
  }
}

// ─── 3. checkSeatsAvailable ──────────────────────────────────────────────────

/**
 * V1 — Blocage strict si dépassement de max_seats (Q7).
 *
 * Throw `AuthError(403, 'seats_exhausted')` si le nombre de membres actifs
 * de l'org atteint déjà `max_seats`. Sinon ne fait rien.
 *
 * Appelé typiquement avant d'envoyer une invitation
 * (POST /api/auth/invitations en B4) ou avant d'accepter une invitation.
 *
 * `max_seats=null` → pas de limite seats → no-op.
 * `max_seats <= 0` → throw immédiat.
 */
export async function checkSeatsAvailable(args: {
  supabaseAdmin: SupabaseClient
  organization_id: string
  max_seats: number | null
}): Promise<void> {
  const { supabaseAdmin, organization_id, max_seats } = args

  if (max_seats === null) return // pas de limite

  if (max_seats <= 0) {
    throw new AuthError(403, {
      error: 'No seats available in current plan',
      code: 'seats_exhausted',
    })
  }

  const { count, error } = await supabaseAdmin
    .from('organization_members')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organization_id)
    .eq('status', 'active')

  if (error) {
    console.error('[packages:checkSeatsAvailable] count error', error.message)
    // Best-effort : si on n'arrive pas à compter, on ne bloque pas
    // (préfère faux-négatif au blocage incorrect d'un admin).
    return
  }

  if ((count ?? 0) >= max_seats) {
    throw new AuthError(403, {
      error: 'No seats available in current plan',
      code: 'seats_exhausted',
    })
  }
}
