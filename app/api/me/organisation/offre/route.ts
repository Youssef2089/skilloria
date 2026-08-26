import { NextRequest } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth-guard'
import { getOrgEntitlements, monthlyPeriodStart } from '@/lib/entitlements'
import { targetRoleForOrgType } from '@/lib/org-target-role'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/me/organisation/offre — offre effective + consommation du mois pour
 * l'organisation de l'appelant (Lot A entreprise, page « Mon offre »).
 *
 * ┌─ POURQUOI UNE ROUTE SERVEUR (et pas du client-direct) ? ────────────────┐
 * │ `usage_peek` est `revoke all from public, anon, authenticated` /        │
 * │ `grant execute to service_role` (cf. 20260709000002_usage_counters).    │
 * │ `getOrgEntitlements` lit aussi packages/package_features en service-    │
 * │ role. Ces deux appels sont donc INAPPELABLES depuis le navigateur.      │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Calqué sur app/api/admin/org-usage/route.ts (même règle de domaine actif
 * unique, même pattern d'appel usage_peek), mais garde = membre de l'org
 * (tout rôle : lire son offre n'est pas une action d'admin), et l'org n'est
 * pas un paramètre — elle vient du contexte d'auth, donc pas d'IDOR possible.
 *
 * Lecture SEULE. Aucune notion de facture / paiement / moyen de paiement :
 * Stripe n'est pas branché et `transactions` est indexée sur user_id.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type Admin = Awaited<ReturnType<typeof requireAuth>>['supabaseAdmin']

async function peek(admin: Admin, orgId: string, key: string, period: string): Promise<number> {
  const { data, error } = await admin.rpc('usage_peek', {
    p_org: orgId,
    p_key: key,
    p_period: period,
  })
  if (error) {
    console.warn('[me/organisation/offre] usage_peek error', key, error.message)
    return 0
  }
  return typeof data === 'number' ? data : 0
}

/**
 * Résout la ligne `packages` correspondant à l'offre effective, UNIQUEMENT pour
 * l'AFFICHAGE (nom, prix, description). Les LIMITES restent celles renvoyées par
 * `getOrgEntitlements` (source autoritaire, fail-open).
 *
 * On ne peut pas retrouver le package par `packageSlug` seul : la contrainte
 * d'unicité est (domain_id, slug, target_role), donc le slug est ambigu. On
 * rejoue donc la même sélection en deux branches que le moteur.
 *
 * Fail-safe : toute erreur → null (la page retombe sur le slug).
 */
async function resolvePackageRow(
  admin: Admin,
  orgId: string,
  linkPackageId: string | null,
  linkValidUntil: string | null,
): Promise<{ name: string; price_monthly: number | null; currency: string } | null> {
  try {
    const linkActive =
      !!linkPackageId && (linkValidUntil == null || new Date(linkValidUntil).getTime() > Date.now())

    if (linkActive) {
      const { data: pkg } = await admin
        .from('packages')
        .select('name, price_monthly, currency, active')
        .eq('id', linkPackageId as string)
        .maybeSingle()
      if (pkg && pkg.active === true) {
        return {
          name: pkg.name as string,
          price_monthly: (pkg.price_monthly as number | null) ?? null,
          currency: (pkg.currency as string) ?? 'EUR',
        }
      }
    }

    // Fallback : package is_default du catalogue pour le target_role de l'org.
    const { data: org } = await admin
      .from('organizations')
      .select('org_type')
      .eq('id', orgId)
      .maybeSingle()
    const targetRole = targetRoleForOrgType((org?.org_type as string | null) ?? null)

    // Cibles de repli : la ligne spécifique, plus 'all' — SAUF pour
    // 'collaboration', qu'une offre entreprise 'all' ne couvre jamais. Même
    // règle que le moteur (lib/entitlements) et que `covers`.
    const fallbackTargets =
      targetRole === 'collaboration' ? ['collaboration'] : [targetRole, 'all']

    const { data: defs } = await admin
      .from('packages')
      .select('name, price_monthly, currency, target_role')
      .is('domain_id', null)
      .in('target_role', fallbackTargets)
      .eq('is_default', true)
      .eq('active', true)
    const candidates = (defs ?? []) as {
      name: string
      price_monthly: number | null
      currency: string
      target_role: string
    }[]
    // La ligne spécifique prime sur la ligne 'all' (même règle que le moteur).
    const def =
      candidates.find((c) => c.target_role === targetRole) ??
      candidates.find((c) => c.target_role === 'all') ??
      null
    return def
      ? { name: def.name, price_monthly: def.price_monthly ?? null, currency: def.currency ?? 'EUR' }
      : null
  } catch (err) {
    console.warn('[me/organisation/offre] resolvePackageRow threw — affichage dégradé', err)
    return null
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const org = auth.organization
  if (!org) {
    return json({ error: 'No organization', code: 'no_organization' }, 403)
  }

  // ── Domaine actif unique (même règle que admin/org-usage) ──────────────────
  const { data: domains, error: domErr } = await auth.supabaseAdmin
    .from('organization_domains')
    .select('domain_id, package_id, package_started_at, package_valid_until')
    .eq('organization_id', org.id)
    .eq('active', true)
  if (domErr) {
    console.error('[me/organisation/offre] org_domains lookup failed', domErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const activeRows = (domains ?? []) as {
    domain_id: string
    package_id: string | null
    package_started_at: string | null
    package_valid_until: string | null
  }[]
  if (activeRows.length === 0) return json({ available: false, reason: 'no_active_domain' }, 200)
  if (activeRows.length > 1) return json({ available: false, reason: 'multiple_active_domains' }, 200)
  const target = activeRows[0]

  // ── Offre effective (fail-open) + conso du mois ────────────────────────────
  const ents = await getOrgEntitlements(auth.supabaseAdmin, org.id, target.domain_id)
  const period = monthlyPeriodStart().toISOString().slice(0, 10)

  const [pkgRow, publicationsUsed, manualUnlocksUsed] = await Promise.all([
    resolvePackageRow(auth.supabaseAdmin, org.id, target.package_id, target.package_valid_until),
    peek(auth.supabaseAdmin, org.id, 'publications', period),
    peek(auth.supabaseAdmin, org.id, 'manual_unlocks', period),
  ])

  return json(
    {
      available: true,
      package: {
        slug: ents.packageSlug,
        // null → la page affiche le slug en repli.
        name: pkgRow?.name ?? null,
        price_monthly: pkgRow?.price_monthly ?? null,
        currency: pkgRow?.currency ?? 'EUR',
      },
      // null = illimité (convention entitlements.ts).
      limits: {
        publicationsPerMonth: ents.limits.publicationsPerMonth,
        activePublicationsMax: ents.limits.activePublicationsMax,
        revealedCandidatesPerPublication: ents.limits.revealedCandidatesPerPublication,
        manualUnlocksPerMonth: ents.limits.manualUnlocksPerMonth,
      },
      usage: {
        publications: publicationsUsed,
        manual_unlocks: manualUnlocksUsed,
      },
      period_start: period,
      package_started_at: target.package_started_at,
      package_valid_until: target.package_valid_until,
    },
    200,
  )
}
