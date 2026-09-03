import { NextRequest } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { readSessionCookieToken, hashSessionToken } from '@/lib/session-token'
import { isProduction } from '@/lib/env'
import { resolveEcosystemAccess, type EcosystemDenialCode } from '@/lib/ecosystem-guard'

/** Messages techniques des refus d'écosystème. L'UI, elle, traduit sur `code`. */
const ECOSYSTEM_DENIAL_MESSAGES: Record<EcosystemDenialCode, string> = {
  domain_mismatch: 'Domain mismatch',
  unknown_domain: 'Unknown ecosystem',
  domain_inactive: 'Ecosystem inactive',
  unknown_user_type: 'Unknown user type',
  domain_lookup_failed: 'Domain lookup failed',
}

export type AuthUser = {
  id: string
  last_session_token: string | null
  /**
   * Écosystème DU COMPTE. ⚠️ À ne pas confondre avec `domain.id`, l'écosystème
   * ACTIF. Pour un expert les deux coïncident à vie ; pour un membre
   * d'organisation ils divergent dès qu'il circule. C'est `domain.id` qu'on
   * filtre (cf. `activeEcosystemId`), jamais celui-ci.
   */
  domain_id: string
  user_type: string | null
  status: string | null
}

/**
 * L'écosystème ACTIF — celui du sous-domaine de la requête, PAS celui du compte.
 *
 * Avant le multi-écosystème, cette valeur était lue sur `users.domains` : les
 * deux ne pouvaient pas différer. Elles diffèrent maintenant, et c'est bien
 * celle-ci que `activeEcosystemId(auth)` renvoie — sans quoi une organisation
 * naviguant sur un écosystème verrait les données de son écosystème
 * d'inscription, en silence.
 */
export type AuthDomain = {
  id: string
  slug: string
  active: boolean
}

/**
 * Contexte organisation attaché à un user authentifié.
 *
 * V1 : un user n'appartient qu'à 1 seule organisation. Si jamais il en a
 * plusieurs (cas théorique futur), on prend la 1ère par `joined_at ASC`.
 *
 * `null` (et non `undefined`) signifie explicitement "user sans organisation".
 */
export type AuthOrganization = {
  id: string
  role_in_org: 'admin' | 'editor' | 'viewer'
  verification_status:
    | 'pending_provider_check'
    | 'pending_admin_review'
    | 'approved'
    | 'rejected'
    | 'requires_more_info'
    | null
}

/**
 * Retour de `requireAuth()`.
 *
 * Backward-compat : les call-sites qui font
 *   const { user, domain, supabaseAdmin } = await requireAuth(req)
 * continuent de fonctionner sans modification — le champ `organization`
 * est simplement ignoré.
 */
export type AuthContext = {
  user: AuthUser
  domain: AuthDomain
  organization: AuthOrganization | null
  supabaseAdmin: SupabaseClient
}

export class AuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: { error: string; code?: string; own_slug?: string | null },
  ) {
    super(body.error)
  }

  toResponse(): Response {
    return new Response(JSON.stringify(this.body), {
      status: this.status,
      headers: { 'content-type': 'application/json' },
    })
  }
}

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error('[auth-guard] Missing Supabase env vars (URL or SERVICE_ROLE_KEY)')
    throw new AuthError(500, { error: 'Server misconfigured', code: 'missing_env' })
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const VALID_ORG_ROLES = ['admin', 'editor', 'viewer'] as const
const VALID_VERIFICATION_STATUS = [
  'pending_provider_check',
  'pending_admin_review',
  'approved',
  'rejected',
  'requires_more_info',
] as const

// ── Cycle de vie suppression S3 (ADDITIF) ───────────────────────────────────
// Paths joignables PENDANT la grâce (suppression programmée, non purgé) :
// réactivation, statut, logout. Tout le reste → 403 account_deletion_scheduled.
// check-session N'EST PAS allowlistée volontairement → le heartbeat reçoit le
// 403 ; c'est lib/secure-fetch (onDeletionScheduled, C2) qui redirige alors
// vers /reactivation. (Avant C2, secure-fetch n'interceptait QUE
// session_superseded : le 403 suppression était avalé et ne redirigeait pas.)
const DELETION_GRACE_ALLOWLIST = new Set<string>([
  '/api/me/account/reactivate',
  '/api/me/account/status',
  '/api/auth/logout',
])
// Paths joignables même APRÈS purge (compte anonymisé) : uniquement logout.
const DELETION_ANONYMIZED_ALLOWLIST = new Set<string>(['/api/auth/logout'])

// ── SUSPENSION ADMINISTRATIVE (lot back-office « Utilisateurs ») ─────────────
//
// `users.status` portait la valeur 'suspended' à son CHECK depuis l'origine,
// mais RIEN ne la lisait : ce garde la chargeait déjà et la renvoyait dans
// `AuthContext.user.status` sans jamais s'en servir. Un compte suspendu se
// connectait normalement. C'est ici que la suspension prend effet.
//
// ⚠️ ÉGALITÉ STRICTE SUR 'suspended', JAMAIS `status !== 'active'`.
//   Le CHECK admet six valeurs (draft, active, in_review, suspended, rejected,
//   archived). 'in_review' est écrit par /api/profile à CHAQUE soumission de
//   profil expert : tester la non-égalité à 'active' verrouillerait d'un coup
//   TOUS les experts en cours de validation — exactement la population qu'on
//   attend sur la plateforme. On teste donc la seule valeur qui signifie
//   « accès coupé », et on l'énonce ici pour que personne ne « simplifie »
//   ce test plus tard.
const SUSPENDED_STATUS = 'suspended'

// AUCUNE ALLOWLIST, et c'est délibéré.
//   Les deux gates de suppression en ont une parce qu'elles laissent à
//   l'utilisateur un chemin de sortie en self-service (réactivation). La
//   suspension n'en a pas : seule une décision d'administrateur la lève.
//   Le LOGOUT reste possible sans allowlist — /api/auth/logout n'utilise pas
//   `requireAuth` (il valide le Bearer à la main, volontairement permissif),
//   donc il ne traverse jamais ce garde. L'utilisateur peut toujours se
//   déconnecter proprement.

async function loadOrganizationContext(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<AuthOrganization | null> {
  // V1 : 1 user = 1 org. On prend la 1ère ligne active par joined_at ASC.
  //
  // INVARIANTE COLLABORATION (A2) — ce « limit(1) » est sûr pour l'expert :
  //   Un compte EXPERT ne peut jamais avoir qu'UNE SEULE membership active, son
  //   organisation PERSONNELLE (org_type='freelance', créée par ensure-org).
  //   La règle d'invitation entreprise REFUSE toute adresse déjà rattachée à un
  //   compte expert (code `email_is_expert_account`), avec filet serveur à
  //   l'acceptation → un expert ne rejoint jamais une vraie organisation.
  //   Donc pour un expert, `auth.organization` = son org perso, sans ambiguïté
  //   de tri. ⚠️ Si cette règle d'invitation change un jour (un expert pouvant
  //   rejoindre une org cliente), ce chemin deviendrait ambigu (joined_at ASC
  //   pourrait renvoyer l'org cliente au lieu de l'org perso) et il faudrait
  //   alors résoudre explicitement l'org perso pour les surfaces sous-traitance.
  const { data: memberRow, error: memberErr } = await supabaseAdmin
    .from('organization_members')
    .select('organization_id, role_in_org, organizations(id, verification_status)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (memberErr) {
    console.error('[auth-guard] organization_members lookup error', {
      userId,
      msg: memberErr.message,
    })
    return null
  }
  if (!memberRow) return null

  const orgRow = Array.isArray(memberRow.organizations)
    ? memberRow.organizations[0]
    : memberRow.organizations

  const role = memberRow.role_in_org as string
  const status = (orgRow as { verification_status?: string | null } | null)
    ?.verification_status ?? null

  return {
    id: memberRow.organization_id as string,
    role_in_org: (VALID_ORG_ROLES as readonly string[]).includes(role)
      ? (role as AuthOrganization['role_in_org'])
      : 'viewer',
    verification_status: status === null
      ? null
      : (VALID_VERIFICATION_STATUS as readonly string[]).includes(status)
        ? (status as AuthOrganization['verification_status'])
        : null,
  }
}

export async function requireAuth(request: NextRequest): Promise<AuthContext> {
  const authHeader =
    request.headers.get('authorization') ?? request.headers.get('Authorization')
  const accessToken = authHeader?.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : null

  if (!accessToken) {
    throw new AuthError(401, { error: 'Not authenticated', code: 'no_token' })
  }

  const supabaseAdmin = getSupabaseAdmin()

  const { data: userInfo, error: sessionError } =
    await supabaseAdmin.auth.getUser(accessToken)
  if (sessionError || !userInfo?.user) {
    throw new AuthError(401, { error: 'Not authenticated', code: 'invalid_token' })
  }

  const { data: userRow, error: userErr } = await supabaseAdmin
    .from('users')
    .select(
      'id, last_session_token, domain_id, user_type, status, deletion_scheduled_at, anonymized_at, domains(id, slug, active)',
    )
    .eq('id', userInfo.user.id)
    .maybeSingle()

  if (userErr) {
    console.error('[auth-guard] user lookup error', {
      userId: userInfo.user.id,
      msg: userErr.message,
    })
    throw new AuthError(403, { error: 'User not found', code: 'user_lookup_failed' })
  }
  if (!userRow) {
    throw new AuthError(403, { error: 'User not found', code: 'user_missing' })
  }

  // ── Session unique (11F) ────────────────────────────────────────────────
  // Backward-compat D4 : si l'user n'a jamais été (re)connecté depuis le
  // déploiement de 11F, `last_session_token` est NULL → on skip le check
  // (il se peuplera à son prochain login via /api/auth/init-session).
  //
  // Sinon : compare avec le token client. Source primaire = cookie
  // httpOnly `ss_token` (D5, posé par init-session). Fallback header
  // `x-session-token` réservé au NON-PRODUCTION (Postman/dev, scripts diag sur
  // staging) : en production, seul le cookie httpOnly fait foi — on ne lit pas
  // ce header (surface non-httpOnly inutile en prod).
  // Mismatch → 403 `session_superseded` (D2, code distinct de
  // `forbidden`/`no_token`/`invalid_token`).
  if (userRow.last_session_token) {
    const cookieToken = readSessionCookieToken(request)
    const headerToken = isProduction() ? null : request.headers.get('x-session-token')
    const clientToken = cookieToken ?? headerToken
    // C2 : la BDD stocke le sha256 du token, le client envoie le brut (cookie
    // ss_token). On hashe l'entrée client avant comparaison. clientToken null
    // → hash impossible → mismatch (403), comme avant.
    const clientHash = clientToken ? hashSessionToken(clientToken) : null
    if (clientHash !== userRow.last_session_token) {
      throw new AuthError(403, {
        error: 'Session superseded by another login',
        code: 'session_superseded',
      })
    }
  }

  // ══ GARDE DU SLUG — ELLE ÉCHOUE FERME ═══════════════════════════════════
  //
  // La règle ne vit plus ici : elle est dans lib/ecosystem-guard.ts, partagée
  // avec la garde du dashboard (server component, qui REDIRIGE au lieu de
  // lever). Deux gardes, un seul verdict — écrire la règle deux fois, c'est
  // accepter qu'un écran s'affiche pendant que les données sont refusées.
  //
  // Ce qui reste ici, c'est la SANCTION : une AuthError 403.
  const ownDomain = (Array.isArray(userRow.domains) ? userRow.domains[0] : userRow.domains) as
    | { id: string; slug: string; active: boolean }
    | null

  const access = await resolveEcosystemAccess({
    admin: supabaseAdmin,
    headerSubdomain: request.headers.get('x-subdomain'),
    userType: (userRow.user_type ?? null) as string | null,
    userDomainId: userRow.domain_id as string,
    ownDomain,
    logTag: 'auth-guard',
  })
  if (!access.ok) {
    // `own_slug` VOYAGE AVEC LE REFUS. C'est lui qui permet à l'écran de dire
    // à un expert égaré « votre écosystème est celui-ci, voici l'adresse »
    // plutôt que « accès refusé ». Un refus sans issue n'est qu'une impasse
    // polie. Il ne révèle rien : c'est l'écosystème de son propre compte.
    throw new AuthError(403, {
      error: ECOSYSTEM_DENIAL_MESSAGES[access.denial.code],
      code: access.denial.code,
      own_slug: access.denial.ownSlug,
    })
  }
  const target = access.domain

  // ── Gate SUSPENSION (APRÈS session+domaine, AVANT les gates suppression) ──
  //
  // ORDRE SIGNIFIANT : la suspension prime sur la suppression programmée. Un
  // compte à la fois suspendu et en grâce ne doit PAS pouvoir se réactiver —
  // la réactivation est en self-service, la levée de suspension ne l'est pas.
  // Inverser l'ordre offrirait une sortie de suspension par la porte de
  // service.
  //
  // Après session+domaine : on ne renseigne personne sur l'état d'un compte
  // dont il n'a pas prouvé qu'il détient la session courante.
  //
  // MESURE D'ACCÈS, PAS SANCTION COMMERCIALE (décision produit) : ce garde
  // coupe l'accès du compte, un point c'est tout. Les annonces publiées
  // restent en ligne, les candidatures et le matching sont inchangés — rien
  // ici ne touche à une autre table. Faire disparaître des annonces payées
  // comme effet de bord d'une suspension serait une décision commerciale
  // qu'aucun administrateur n'a prise en cliquant « Suspendre ».
  if (userRow.status === SUSPENDED_STATUS) {
    throw new AuthError(403, { error: 'Account suspended', code: 'account_suspended' })
  }

  // ── Gate cycle de vie suppression S3 (ADDITIF, APRÈS session+domaine) ─────
  // Compte NORMAL (deletion_scheduled_at ET anonymized_at NULL) → aucun impact.
  // Compte PURGÉ (anonymized_at) → bloqué partout sauf logout (defense-in-depth ;
  //   en pratique l'auth Supabase est déjà bannie → getUser échoue plus haut).
  // Compte EN GRÂCE (suppression programmée, non purgé) → seul l'allowlist passe ;
  //   le reste 403 account_deletion_scheduled → le client va vers /reactivation.
  const userDeletionScheduledAt =
    (userRow as { deletion_scheduled_at?: string | null }).deletion_scheduled_at ?? null
  const userAnonymizedAt =
    (userRow as { anonymized_at?: string | null }).anonymized_at ?? null
  if (userDeletionScheduledAt || userAnonymizedAt) {
    const pathname = request.nextUrl.pathname
    if (userAnonymizedAt) {
      if (!DELETION_ANONYMIZED_ALLOWLIST.has(pathname)) {
        throw new AuthError(403, { error: 'Account anonymized', code: 'account_anonymized' })
      }
    } else if (!DELETION_GRACE_ALLOWLIST.has(pathname)) {
      throw new AuthError(403, {
        error: 'Account deletion scheduled',
        code: 'account_deletion_scheduled',
      })
    }
  }

  const organization = await loadOrganizationContext(supabaseAdmin, userRow.id)

  return {
    user: {
      id: userRow.id,
      last_session_token: userRow.last_session_token,
      domain_id: userRow.domain_id,
      user_type: (userRow.user_type ?? null) as string | null,
      status: (userRow.status ?? null) as string | null,
    },
    // L'écosystème ACTIF (le sous-domaine), pas celui du compte.
    domain: { id: target.id, slug: target.slug, active: target.active },
    organization,
    supabaseAdmin,
  }
}

/**
 * Garde appelable depuis n'importe quelle route métier qui exige
 * que l'organisation du user soit déjà validée.
 *
 * Throw `AuthError(403, 'org_not_approved')` si :
 *   - le user n'a pas d'organisation (`null`)
 *   - le verification_status est différent de 'approved'
 *
 * Non appliquée aux routes existantes (qui ne touchent pas aux orgs).
 * Sera utilisée à partir du Lot B5 sur les routes mission/payment/match.
 */
/**
 * Garde de RÔLE organisation (D2 — les rôles doivent avoir un sens côté SERVEUR).
 *
 * Hiérarchie : viewer (lecture seule) < editor (gère publications & candidatures)
 *              < admin (tout, incl. membres & organisation).
 *
 * `requireOrgRole(auth, 'editor')` → autorise editor ET admin ; refuse viewer.
 * `requireOrgRole(auth, 'admin')`  → autorise admin uniquement.
 * Throw AuthError(403, 'insufficient_role') si le rôle est en dessous du minimum
 * (ou si le user n'a pas d'organisation active).
 *
 * ⚠️ C'est la GARANTIE (checklist #20) : l'UI peut masquer les actions, mais un
 *    appel direct à l'API doit être refusé ici.
 */
const ORG_ROLE_RANK: Record<AuthOrganization['role_in_org'], number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
}

export function requireOrgRole(authResult: AuthContext, min: 'editor' | 'admin'): void {
  const org = authResult.organization
  if (!org) {
    throw new AuthError(403, { error: 'Organization required', code: 'org_required' })
  }
  if (ORG_ROLE_RANK[org.role_in_org] < ORG_ROLE_RANK[min]) {
    throw new AuthError(403, {
      error: `Insufficient role: ${min} required`,
      code: 'insufficient_role',
    })
  }
}

export function requireOrgApproved(authResult: AuthContext): void {
  const org = authResult.organization
  if (!org) {
    throw new AuthError(403, {
      error: 'Organization required',
      code: 'org_required',
    })
  }
  if (org.verification_status !== 'approved') {
    throw new AuthError(403, {
      error: 'Organization not approved yet',
      code: 'org_not_approved',
    })
  }
}
