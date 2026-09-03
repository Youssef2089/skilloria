import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { monthlyPeriodStart } from '@/lib/entitlements'
import { activePublishedOrClause } from '@/lib/publications/expiry'
import { targetRoleForOrgType } from '@/lib/org-target-role'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/collaboration-orgs
 *
 * Les EXPERTS qui utilisent la collaboration entre experts, avec leur offre
 * effective et leur consommation réelle. Alimente /admin/collaboration.
 *
 * Une « organisation personnelle » (organizations.org_type='freelance') est
 * l'espace commercial d'UN expert — pas une entreprise. Elle est volontairement
 * absente de /api/admin/list-orgs (file de validation entreprise) ; c'est ICI
 * qu'elle se regarde, nommée par SON EXPERT (prénom nom + e-mail), jamais par
 * le `company_name` technique de l'org.
 *
 * ┌─ ÉTAT DE RATTACHEMENT — le cœur de cet écran ───────────────────────────┐
 * │ 'linked'   rattachement explicite valide à une offre collaboration.     │
 * │ 'fallback' aucun rattachement (ou échu) → repli sur l'offre             │
 * │            collaboration PAR DÉFAUT. Normal, mais à voir.               │
 * │ 'foreign'  ANOMALIE : l'offre effective n'est PAS une offre de          │
 * │            collaboration (cible client/cabinet/all). Un expert ne doit  │
 * │            JAMAIS hériter d'une offre entreprise.                       │
 * │ 'none'     aucune offre résoluble (catalogue incomplet) → les gates     │
 * │            commerce sont fail-open, donc tout est illimité.             │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ADMIN PLATEFORME : aucun filtre domain_id (intentionnel) ; l'écosystème de
 * chaque expert est renvoyé et affiché.
 *
 * PERFORMANCE (point 11) : AUCUNE requête en N+1. Six lectures à plat, quel
 * que soit le nombre d'experts — les compteurs mensuels sont lus directement
 * dans la table usage_counters (une seule requête) plutôt que via N appels RPC
 * usage_peek, et les annonces actives en une lecture agrégée en mémoire.
 *
 * Garde admin per-route via requireAdmin. service_role.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const MAX_ORGS = 500

type PkgRow = {
  id: string
  name: string
  slug: string
  target_role: string
  is_default: boolean
  active: boolean
}

type Limits = {
  publicationsPerMonth: number | null
  activePublicationsMax: number | null
}

/** 'unlimited' / vide / non-parseable → null (illimité). Miroir de lib/entitlements. */
function parseLimit(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const t = raw.trim().toLowerCase()
  if (t === 'unlimited' || t === '') return null
  const n = parseInt(t, 10)
  return Number.isFinite(n) ? n : null
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  // ── 1. Organisations PERSONNELLES ──────────────────────────────────────────
  //  Le TOTAL EXACT est lu à part (`head: true` → aucun transfert de lignes).
  //  Sans lui, un écran tronqué ne pourrait pas dire de combien il l'est — et
  //  un écran de pilotage qui tronque en silence masque exactement ce qu'il
  //  doit montrer, d'autant que le tri est `created_at DESC` : ce sont les
  //  organisations les plus anciennes, souvent les plus établies, qui sortent
  //  les premières.
  const [{ data: orgRows, error: orgErr }, { count: totalCount }] = await Promise.all([
    auth.supabaseAdmin
      .from('organizations')
      .select('id, company_name, owner_user_id, created_at, package_id, package_valid_until')
      .eq('org_type', 'freelance')
      .order('created_at', { ascending: false })
      .limit(MAX_ORGS),
    auth.supabaseAdmin
      .from('organizations')
      .select('id', { count: 'exact', head: true })
      .eq('org_type', 'freelance'),
  ])
  if (orgErr) {
    console.error('[admin:collaboration-orgs] organizations query failed', orgErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const total = totalCount ?? 0
  const orgs = (orgRows ?? []) as {
    id: string
    company_name: string | null
    owner_user_id: string | null
    created_at: string
    package_id: string | null
    package_valid_until: string | null
  }[]

  if (orgs.length === 0) {
    return json(
      {
        experts: [],
        period_start: monthlyPeriodStart().toISOString().slice(0, 10),
        total,
        truncated: false,
        limit: MAX_ORGS,
      },
      200,
    )
  }

  const orgIds = orgs.map((o) => o.id)
  const ownerIds = orgs.map((o) => o.owner_user_id).filter((v): v is string => !!v)
  const period = monthlyPeriodStart().toISOString().slice(0, 10)

  // ── 2..6. Cinq lectures à plat, en parallèle ───────────────────────────────
  const [usersRes, linksRes, pkgsRes, countersRes, activeRes] = await Promise.all([
    ownerIds.length > 0
      ? auth.supabaseAdmin
          .from('users')
          .select('id, first_name, last_name, email')
          .in('id', ownerIds)
      : Promise.resolve({ data: [], error: null }),
    auth.supabaseAdmin
      .from('organization_domains')
      // TRACE de l'écosystème d'inscription UNIQUEMENT (colonne « Écosystème »).
      // L'abonnement se lit sur `organizations` : cf. la sélection ci-dessus.
      .select('organization_id, domain_id, active, domains(name)')
      .in('organization_id', orgIds),
    auth.supabaseAdmin.from('packages').select('id, name, slug, target_role, is_default, active'),
    auth.supabaseAdmin
      .from('usage_counters')
      .select('organization_id, used')
      .in('organization_id', orgIds)
      .eq('counter_key', 'publications')
      .eq('period_start', period),
    auth.supabaseAdmin
      .from('publications')
      .select('id, organization_id')
      .in('organization_id', orgIds)
      .eq('status', 'published')
      .or(activePublishedOrClause()),
  ])

  if (linksRes.error || pkgsRes.error) {
    console.error(
      '[admin:collaboration-orgs] links/packages query failed',
      linksRes.error?.message ?? pkgsRes.error?.message,
    )
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  // Identité de l'expert. Best-effort : un e-mail manquant ne casse pas la ligne.
  const userById = new Map<string, { first_name: string | null; last_name: string | null; email: string | null }>()
  for (const u of (usersRes.data ?? []) as {
    id: string
    first_name: string | null
    last_name: string | null
    email: string | null
  }[]) {
    userById.set(u.id, { first_name: u.first_name, last_name: u.last_name, email: u.email })
  }

  // Rattachement (org → domaine + package). L'org personnelle en a exactement
  // un (créé par ensure-org) ; si plusieurs, la ligne ACTIVE l'emporte.
  type LinkRow = {
    organization_id: string
    domain_id: string
    active: boolean
    domains: { name?: string | null } | { name?: string | null }[] | null
  }
  const linkByOrg = new Map<string, LinkRow>()
  for (const l of (linksRes.data ?? []) as LinkRow[]) {
    const prev = linkByOrg.get(l.organization_id)
    if (!prev || (!prev.active && l.active)) linkByOrg.set(l.organization_id, l)
  }

  const pkgs = (pkgsRes.data ?? []) as PkgRow[]
  const pkgById = new Map(pkgs.map((p) => [p.id, p]))
  // Offre par défaut de la cible 'collaboration'. 'all' est volontairement
  // exclu : il ne couvre jamais la collaboration (cf. lib/package-default).
  const collaborationDefault =
    pkgs.find((p) => p.target_role === 'collaboration' && p.is_default && p.active) ?? null

  // Compteurs mensuels : une lecture, aucun appel RPC par org.
  const publicationsByOrg = new Map<string, number>()
  for (const c of (countersRes.data ?? []) as { organization_id: string; used: number }[]) {
    publicationsByOrg.set(c.organization_id, c.used ?? 0)
  }

  // Annonces actives à l'instant T (règle 30 j read-time), agrégées en mémoire.
  const activeByOrg = new Map<string, number>()
  for (const p of (activeRes.data ?? []) as { organization_id: string }[]) {
    activeByOrg.set(p.organization_id, (activeByOrg.get(p.organization_id) ?? 0) + 1)
  }

  // ── 7. Limites des offres effectivement rencontrées (une lecture) ──────────
  const effectiveByOrg = new Map<string, { pkg: PkgRow | null; state: string; expiredAt: string | null }>()
  const neededPkgIds = new Set<string>()
  const expectedTarget = targetRoleForOrgType('freelance') // 'collaboration'

  for (const o of orgs) {
    const linked = o.package_id ? (pkgById.get(o.package_id) ?? null) : null
    const expired =
      !!o.package_valid_until && new Date(o.package_valid_until).getTime() <= Date.now()

    let pkg: PkgRow | null = null
    let state: string
    let expiredAt: string | null = null

    if (linked && linked.active && !expired) {
      pkg = linked
      state = 'linked'
    } else {
      // Repli : même résolution que getOrgEntitlements pour une org 'freelance'.
      pkg = collaborationDefault
      state = pkg ? 'fallback' : 'none'
      if (expired) expiredAt = o.package_valid_until ?? null
    }

    // ANOMALIE : l'offre effective n'appartient pas au monde collaboration.
    if (pkg && pkg.target_role !== expectedTarget) state = 'foreign'

    if (pkg) neededPkgIds.add(pkg.id)
    effectiveByOrg.set(o.id, { pkg, state, expiredAt })
  }

  const limitsByPkg = new Map<string, Limits>()
  if (neededPkgIds.size > 0) {
    const { data: feats, error: featErr } = await auth.supabaseAdmin
      .from('package_features')
      .select('package_id, feature_code, value')
      .in('package_id', [...neededPkgIds])
      .in('feature_code', ['publications_per_month', 'active_publications_max'])
    if (featErr) {
      console.warn('[admin:collaboration-orgs] features query failed', featErr.message)
    }
    for (const f of (feats ?? []) as { package_id: string; feature_code: string; value: string }[]) {
      const cur = limitsByPkg.get(f.package_id) ?? {
        publicationsPerMonth: null,
        activePublicationsMax: null,
      }
      if (f.feature_code === 'publications_per_month') cur.publicationsPerMonth = parseLimit(f.value)
      else cur.activePublicationsMax = parseLimit(f.value)
      limitsByPkg.set(f.package_id, cur)
    }
  }

  // ── 8. Assemblage ──────────────────────────────────────────────────────────
  const experts = orgs.map((o) => {
    const u = o.owner_user_id ? userById.get(o.owner_user_id) : undefined
    const link = linkByOrg.get(o.id)
    const dom = Array.isArray(link?.domains) ? link?.domains[0] : link?.domains
    const eff = effectiveByOrg.get(o.id)!
    const limits = eff.pkg
      ? (limitsByPkg.get(eff.pkg.id) ?? { publicationsPerMonth: null, activePublicationsMax: null })
      : { publicationsPerMonth: null, activePublicationsMax: null }

    const fullName = [u?.first_name?.trim(), u?.last_name?.trim()].filter(Boolean).join(' ')

    return {
      organization_id: o.id,
      user_id: o.owner_user_id,
      // Nom de l'EXPERT. Repli sur l'e-mail — jamais sur company_name, qui est
      // un libellé technique de l'organisation personnelle.
      full_name: fullName || null,
      email: u?.email ?? null,
      ecosystem: (dom?.name ?? '').trim() || null,
      created_at: o.created_at,
      package: eff.pkg
        ? { id: eff.pkg.id, name: eff.pkg.name, slug: eff.pkg.slug, target_role: eff.pkg.target_role }
        : null,
      state: eff.state,
      expired_at: eff.expiredAt,
      valid_until: eff.state === 'linked' ? (o.package_valid_until ?? null) : null,
      usage: {
        publications: publicationsByOrg.get(o.id) ?? 0,
        active_published: activeByOrg.get(o.id) ?? 0,
      },
      limits,
    }
  })

  return json(
    {
      experts,
      period_start: period,
      // `total` = nombre réel d'organisations personnelles ; `experts.length`
      // est plafonné à `limit`. L'écran doit dire l'écart, pas le taire.
      total,
      truncated: total > orgs.length,
      limit: MAX_ORGS,
    },
    200,
  )
}
