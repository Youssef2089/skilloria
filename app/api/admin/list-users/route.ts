import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/list-users — LE PARC DE COMPTES, pas une file d'attente.
 *
 * FRONTIÈRE AVEC LES ÉCRANS EXISTANTS
 *   /admin/organisations et /admin/experts sont des FILES DE VALIDATION,
 *   pilotées par le `verification_status` d'une entité métier (organizations /
 *   profiles). Elles répondent à « dois-je approuver ceci ? ».
 *   Cette route part de `users` : elle décrit le COMPTE (identité, accès,
 *   session, rôle, cycle de vie). Population strictement plus large — un
 *   compte client, un membre invité, un administrateur et un expert sans
 *   profil n'apparaissaient jusqu'ici sur AUCUN écran du back-office.
 *
 * PAGINATION RÉELLE, JAMAIS DE TRONCATURE MUETTE
 *   `list-experts` et `list-orgs` plafonnaient à 500 lignes sans dire ni le
 *   total ni la troncature : le compteur mentait en silence. Ici on renvoie
 *   `total` (count exact sur la requête FILTRÉE, pas sur la table) et
 *   `has_more`. Le client affiche « 50 sur 1 248 » et pagine.
 *
 * DONNÉES PERSONNELLES — CE QU'ON NE SERT PAS (décision produit)
 *   • `phone` : un administrateur n'a besoin d'aucun numéro pour suspendre ou
 *     révoquer. On sert `phone_verified` (booléen), pas le numéro.
 *   • `last_session_token` : c'est un secret d'authentification. Il ne quitte
 *     jamais le serveur, même hashé.
 *   • CV, contenu de profil, messages, candidatures : la fiche expert existe
 *     déjà et a ses propres gardes. Pas de duplication du dévoilement.
 *
 * MULTI-ÉCOSYSTÈME : aucun filtre `domain_id` (cf. lib/admin-guard.ts — c'est
 * intentionnel), et l'écosystème de CHAQUE compte est servi pour que l'admin
 * plateforme distingue les domaines. Aucun slug en dur.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const VALID_USER_TYPES = ['expert_freelance', 'expert_cdi', 'client', 'cabinet', 'admin'] as const
const VALID_STATUSES = ['draft', 'active', 'in_review', 'suspended', 'rejected', 'archived'] as const
/**
 * Filtre « état de vérification » — porte sur `profiles.verification_status`,
 * une colonne d'une AUTRE table. Il est résolu EN AMONT (liste d'ids injectée
 * dans la requête principale) et non après coup sur la page courante : filtrer
 * après la pagination donnerait un `total` qui compte plus large que la liste
 * affichée. C'est exactement le compteur qui contredit sa liste, déjà corrigé
 * trois fois ailleurs sur ce projet.
 */
const VALID_VERIFICATIONS = ['approved', 'pending_admin_review', 'rejected'] as const

const PER_PAGE_DEFAULT = 50
const PER_PAGE_MAX = 200

function parsePositiveInt(raw: string | null, fallback: number, max: number): number {
  const n = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(n, max)
}

type UserRow = {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  user_type: string | null
  status: string | null
  email_verified: boolean | null
  phone_verified: boolean | null
  is_verified: boolean | null
  last_login_at: string | null
  created_at: string
  deletion_scheduled_at: string | null
  anonymized_at: string | null
  domain_id: string | null
  domains: { id: string; name: string | null; slug: string | null } | { id: string; name: string | null; slug: string | null }[] | null
}

function pickRel<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const url = new URL(request.url)
  const page = parsePositiveInt(url.searchParams.get('page'), 1, 100_000)
  const perPage = parsePositiveInt(url.searchParams.get('per_page'), PER_PAGE_DEFAULT, PER_PAGE_MAX)
  const typeFilter = url.searchParams.get('type')
  const statusFilter = url.searchParams.get('status')
  const domainFilter = url.searchParams.get('domain_id')
  const verificationFilter = url.searchParams.get('verification')
  const search = (url.searchParams.get('q') ?? '').trim()

  // ── Filtre vérification résolu EN AMONT (cf. VALID_VERIFICATIONS) ───────
  // On traduit un critère porté par `profiles` en une contrainte sur `users.id`
  // AVANT de compter et de paginer. Aucun profil correspondant ⇒ liste vide et
  // total 0, ce qui est la vérité, pas une page vide au milieu d'un total faux.
  let restrictToUserIds: string[] | null = null
  if (verificationFilter && (VALID_VERIFICATIONS as readonly string[]).includes(verificationFilter)) {
    const { data: profRows, error: profErr } = await auth.supabaseAdmin
      .from('profiles')
      .select('user_id')
      .eq('verification_status', verificationFilter)
    if (profErr) {
      console.error('[admin:list-users] verification prefilter failed', profErr.message)
      return json({ error: 'Query failed', code: 'db_error' }, 500)
    }
    restrictToUserIds = ((profRows ?? []) as Array<{ user_id: string }>).map((p) => p.user_id)
  }

  // ── Requête filtrée + COUNT EXACT sur le MÊME jeu de critères ────────────
  // Le total doit décrire la liste affichée, pas la table : un compteur qui
  // ignore les filtres est un compteur qui ment (leçon des tuiles KPI).
  let query = auth.supabaseAdmin
    .from('users')
    .select(
      'id, email, first_name, last_name, user_type, status, email_verified, ' +
        'phone_verified, is_verified, last_login_at, created_at, ' +
        'deletion_scheduled_at, anonymized_at, domain_id, ' +
        'domains(id, name, slug)',
      { count: 'exact' },
    )

  if (typeFilter && (VALID_USER_TYPES as readonly string[]).includes(typeFilter)) {
    query = query.eq('user_type', typeFilter)
  }
  if (statusFilter && (VALID_STATUSES as readonly string[]).includes(statusFilter)) {
    query = query.eq('status', statusFilter)
  }
  if (domainFilter) {
    query = query.eq('domain_id', domainFilter)
  }
  if (restrictToUserIds !== null) {
    query = query.in('id', restrictToUserIds)
  }
  if (search) {
    // Recherche nom / prénom / e-mail. `%` et `,` sont échappés : sans ça une
    // virgule dans la saisie casserait la syntaxe `or()` de PostgREST et
    // produirait une requête arbitraire.
    const safe = search.replace(/[%,()]/g, ' ').trim()
    if (safe) {
      query = query.or(
        `email.ilike.%${safe}%,first_name.ilike.%${safe}%,last_name.ilike.%${safe}%`,
      )
    }
  }

  const from = (page - 1) * perPage
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + perPage - 1)

  if (error) {
    console.error('[admin:list-users] query failed', error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  const rows = (data ?? []) as unknown as UserRow[]
  const total = count ?? 0

  // ── Contexte METIER par compte (2 lectures à plat, jamais N+1) ───────────
  const userIds = rows.map((r) => r.id)

  // Organisation de rattachement + rôle. Membres ACTIFS seulement : une
  // adhésion révoquée n'est pas un rattachement.
  const membershipByUser = new Map<
    string,
    { organization_id: string; role_in_org: string; company_name: string | null; org_type: string | null }
  >()
  // Vérification du PROFIL expert (distincte du compte) — sert le filtre
  // « état de vérification » et la colonne du même nom.
  const verificationByUser = new Map<string, string | null>()

  if (userIds.length > 0) {
    const [membersRes, profilesRes] = await Promise.all([
      auth.supabaseAdmin
        .from('organization_members')
        .select('user_id, organization_id, role_in_org, organizations(id, company_name, org_type)')
        .in('user_id', userIds)
        .eq('status', 'active'),
      auth.supabaseAdmin
        .from('profiles')
        .select('user_id, verification_status')
        .in('user_id', userIds),
    ])

    if (membersRes.error) {
      console.error('[admin:list-users] memberships failed', membersRes.error.message)
    }
    for (const m of (membersRes.data ?? []) as Array<{
      user_id: string
      organization_id: string
      role_in_org: string
      organizations: unknown
    }>) {
      if (membershipByUser.has(m.user_id)) continue
      const org = pickRel(m.organizations as { company_name: string | null; org_type: string | null } | null)
      membershipByUser.set(m.user_id, {
        organization_id: m.organization_id,
        role_in_org: m.role_in_org,
        company_name: org?.company_name ?? null,
        org_type: org?.org_type ?? null,
      })
    }

    if (profilesRes.error) {
      console.error('[admin:list-users] profiles failed', profilesRes.error.message)
    }
    for (const p of (profilesRes.data ?? []) as Array<{ user_id: string; verification_status: string | null }>) {
      verificationByUser.set(p.user_id, p.verification_status)
    }
  }

  const users = rows.map((r) => {
    const dom = pickRel(r.domains)
    const membership = membershipByUser.get(r.id) ?? null
    return {
      id: r.id,
      email: r.email,
      first_name: r.first_name,
      last_name: r.last_name,
      user_type: r.user_type,
      status: r.status,
      email_verified: r.email_verified === true,
      // Le NUMÉRO n'est jamais servi — seulement le fait qu'il soit vérifié.
      phone_verified: r.phone_verified === true,
      is_verified: r.is_verified === true,
      last_login_at: r.last_login_at,
      created_at: r.created_at,
      // Cycle de vie suppression : un compte en grâce ou purgé ne doit pas
      // recevoir d'action d'administration sans que l'admin le sache.
      deletion_scheduled_at: r.deletion_scheduled_at,
      anonymized_at: r.anonymized_at,
      ecosystem: dom ? { id: dom.id, name: dom.name, slug: dom.slug } : null,
      organization: membership
        ? {
            id: membership.organization_id,
            company_name: membership.company_name,
            org_type: membership.org_type,
            role_in_org: membership.role_in_org,
          }
        : null,
      profile_verification_status: verificationByUser.get(r.id) ?? null,
    }
  })

  // `total` et `users` décrivent le MÊME jeu de critères : tous les filtres,
  // vérification comprise, ont été appliqués avant le comptage. « 50 sur 1 248 »
  // est donc exact, et `has_more` ne peut pas mentir.
  return json({
    users,
    page,
    per_page: perPage,
    total,
    has_more: from + rows.length < total,
  })
}
