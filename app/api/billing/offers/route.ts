import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { billingEnabled } from '@/lib/billing/config'
import { targetRoleForOrgType } from '@/lib/org-target-role'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/billing/offers — LE CATALOGUE ACHETABLE, pour l'organisation appelante.
 *
 * ┌─ POURQUOI UNE ROUTE, ET PAS UNE LISTE DANS L'ÉCRAN ─────────────────────┐
 * │ Les offres, leurs prix et leurs quotas vivent au catalogue et se règlent │
 * │ au back-office. Les écrire dans l'écran les figerait au moment où on les │
 * │ recopie : le jour où Youssef change un plafond, l'écran mentirait.      │
 * │                                                                          │
 * │ `packages` et `package_features` se lisent en service-role : le          │
 * │ navigateur ne peut pas les interroger. D'où cette route.                 │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ CE QUI EST ACHETABLE, ET CE QUI NE L'EST PAS ──────────────────────────┐
 * │ Mêmes règles que la synchronisation vers Stripe — une seule définition   │
 * │ de « vendable », sans quoi l'écran proposerait ce que le paiement        │
 * │ refuserait :                                                             │
 * │   · `price_monthly` NULL → aucun tarif défini, donc rien à vendre        │
 * │     (distinct de 0, qui est un prix) ;                                   │
 * │   · `is_default` → l'offre sur laquelle on RETOMBE, pas celle qu'on      │
 * │     achète ; elle est gratuite par contrainte de base ;                  │
 * │   · `active = false` → retirée de la vente.                              │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Lecture SEULE. Aucun identifiant de paiement n'est renvoyé : ni client, ni
 * abonnement, ni prix Stripe. L'écran n'a besoin que de ce qu'il affiche.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Codes de features — contrat avec le seed du moteur commerce. */
const FEATURES = [
  'publications_per_month',
  'active_publications_max',
  'revealed_candidates_per_publication',
  'manual_unlocks_per_month',
] as const

/** 'unlimited' (ou vide) → null. Même convention que lib/entitlements.ts. */
function parseLimite(brut: string | null | undefined): number | null {
  if (brut == null) return null
  const t = brut.trim().toLowerCase()
  if (t === 'unlimited' || t === '') return null
  const n = parseInt(t, 10)
  return Number.isFinite(n) ? n : null
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  // Le verrou d'abord. Le catalogue achetable n'a aucun sens quand rien n'est
  // achetable : on ne montre pas une vitrine devant une porte fermée.
  if (!billingEnabled()) {
    return json({ error: 'Billing disabled', code: 'billing_disabled' }, 503)
  }

  const org = auth.organization
  if (!org) return json({ error: 'No organization', code: 'no_organization' }, 403)

  const { data: orgRow, error: orgErr } = await auth.supabaseAdmin
    .from('organizations')
    .select('org_type, package_id')
    .eq('id', org.id)
    .maybeSingle()
  if (orgErr) {
    console.error('[billing:offers] organization lookup failed', orgErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  // Cibles de repli : la ligne spécifique, plus 'all' — SAUF pour
  // 'collaboration', qu'une offre entreprise 'all' ne couvre jamais. Même règle
  // que le moteur de droits ; la faire diverger ici vendrait à un expert une
  // offre entreprise.
  const cible = targetRoleForOrgType((orgRow?.org_type as string | null) ?? null)
  const cibles = cible === 'collaboration' ? ['collaboration'] : [cible, 'all']

  const { data: pkgs, error: pkgErr } = await auth.supabaseAdmin
    .from('packages')
    .select('id, slug, name, description, price_monthly, currency, target_role')
    .is('domain_id', null)
    .in('target_role', cibles)
    .eq('active', true)
    .eq('is_default', false)
    .not('price_monthly', 'is', null)
    .order('price_monthly', { ascending: true })
  if (pkgErr) {
    console.error('[billing:offers] packages lookup failed', pkgErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  const offres = (pkgs ?? []) as {
    id: string
    slug: string
    name: string
    description: string | null
    price_monthly: number | null
    currency: string
  }[]

  // Les limites, en UNE requête pour toutes les offres — pas une par offre.
  const parPackage = new Map<string, Record<string, number | null>>()
  if (offres.length > 0) {
    const { data: feats } = await auth.supabaseAdmin
      .from('package_features')
      .select('package_id, feature_code, value')
      .in('package_id', offres.map((o) => o.id))
    for (const f of (feats ?? []) as { package_id: string; feature_code: string; value: string }[]) {
      if (!(FEATURES as readonly string[]).includes(f.feature_code)) continue
      const courant = parPackage.get(f.package_id) ?? {}
      courant[f.feature_code] = parseLimite(f.value)
      parPackage.set(f.package_id, courant)
    }
  }

  return json(
    {
      // L'offre en cours, pour que l'écran ne propose pas de souscrire à ce
      // qu'on a déjà. `null` = l'organisation est sur l'offre par défaut.
      current_package_id: (orgRow?.package_id as string | null) ?? null,
      offers: offres.map((o) => ({
        id: o.id,
        slug: o.slug,
        name: o.name,
        description: o.description,
        price_monthly: o.price_monthly,
        currency: o.currency ?? 'EUR',
        // null = illimité (convention entitlements.ts). Une feature absente
        // reste absente : on n'invente pas une valeur qui n'est pas au catalogue.
        limits: parPackage.get(o.id) ?? {},
      })),
    },
    200,
  )
}
