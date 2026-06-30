import { NextRequest } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { readSessionCookieToken, hashSessionToken } from '@/lib/session-token'

export type AuthUser = {
  id: string
  last_session_token: string | null
  domain_id: string
  status: string | null
}

export type AuthDomain = {
  id: string
  slug: string
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
    public readonly body: { error: string; code?: string },
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
// réactivation, statut, logout. Tout le reste → 403 account_deletion_scheduled
// (le client redirige vers /reactivation). NB : check-session N'EST PAS
// allowlistée volontairement → le heartbeat 403 et déclenche la redirection.
const DELETION_GRACE_ALLOWLIST = new Set<string>([
  '/api/me/account/reactivate',
  '/api/me/account/status',
  '/api/auth/logout',
])
// Paths joignables même APRÈS purge (compte anonymisé) : uniquement logout.
const DELETION_ANONYMIZED_ALLOWLIST = new Set<string>(['/api/auth/logout'])

async function loadOrganizationContext(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<AuthOrganization | null> {
  // V1 : 1 user = 1 org. On prend la 1ère ligne active par joined_at ASC.
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
      'id, last_session_token, domain_id, status, deletion_scheduled_at, anonymized_at, domains(id, slug)',
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
  // `x-session-token` pour tests Postman / périodes de transition.
  // Mismatch → 403 `session_superseded` (D2, code distinct de
  // `forbidden`/`no_token`/`invalid_token`).
  if (userRow.last_session_token) {
    const cookieToken = readSessionCookieToken(request)
    const headerToken = request.headers.get('x-session-token')
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

  const headerSubdomain = request.headers.get('x-subdomain') ?? 'microsoft'
  const domainRow = Array.isArray(userRow.domains)
    ? userRow.domains[0]
    : userRow.domains
  if (!domainRow || (domainRow as { slug?: string } | null)?.slug !== headerSubdomain) {
    throw new AuthError(403, { error: 'Domain mismatch', code: 'domain_mismatch' })
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
      status: (userRow.status ?? null) as string | null,
    },
    domain: {
      id: (domainRow as { id: string }).id,
      slug: (domainRow as { slug: string }).slug,
    },
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
