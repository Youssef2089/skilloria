import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'
import { isExpertProfileApproved, PROFILE_NOT_VERIFIED_CODE } from '@/lib/expert-verified-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/me/collaboration/ensure-org — CRÉATION LAZY de l'organisation
 * PERSONNELLE d'un expert (Collaboration / Sous-traitance, Option A).
 *
 * Un expert n'a pas d'organisation → il ne peut pas publier (publications.
 * organization_id NOT NULL). Au premier accès à « Besoin / Sous-traitance », on
 * crée à la demande une org PERSONNELLE (org_type='freelance', invisible côté
 * entreprise) rattachée au PACKAGE dédié « collaboration ». L'expert hérite
 * alors de tout le moteur commerce (quotas, masquage, dévoilement) sans logique
 * dupliquée.
 *
 * IDEMPOTENT (D3) : au plus UNE org personnelle par expert. Si elle existe, on
 * la retourne. L'index unique partiel `organizations_personal_owner_unique_idx`
 * garantit l'unicité même en course (23505 → on relit et retourne l'existante).
 *
 * TRANSACTIONNEL avec CLEANUP ATOMIQUE (modèle register-org) : org →
 * organization_members → organization_domains. Tout échec en aval supprime
 * l'org (CASCADE emporte members + domains). Jamais de re-throw : réponse JSON
 * typée.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

class EnsureOrgError extends Error {
  constructor(public code: string, public userMessage: string, public statusCode: number, public cause?: unknown) {
    super(userMessage)
    this.name = 'EnsureOrgError'
  }
}

function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === '23505'
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  // ── Expert uniquement ────────────────────────────────────────────────────
  const { data: userRow, error: userErr } = await auth.supabaseAdmin
    .from('users')
    .select('user_type, first_name, last_name')
    .eq('id', auth.user.id)
    .maybeSingle()
  if (userErr || !userRow) {
    return json({ error: 'User not found', code: 'user_missing' }, 404)
  }
  const userType = userRow.user_type as string | null
  if (userType !== 'expert_freelance' && userType !== 'expert_cdi') {
    return json({ error: 'Experts only', code: 'forbidden' }, 403)
  }

  // ── C2 : GARDE profil approuvé (checklist #4/#20) ────────────────────────
  //  Un expert non vérifié ne peut pas créer son espace de collaboration ni,
  //  par ricochet, publier un besoin. Verrou SERVEUR (non contournable par un
  //  appel direct), miroir du lock UI de la sidebar.
  if (!(await isExpertProfileApproved(auth.supabaseAdmin, auth.user.id))) {
    return json({ error: 'Profile not verified', code: PROFILE_NOT_VERIFIED_CODE }, 403)
  }

  // ── Idempotence : org personnelle déjà présente ? ────────────────────────
  const existing = await findPersonalOrg(auth, auth.user.id)
  if (existing) {
    return json({ ok: true, organization_id: existing, created: false }, 200)
  }

  // ── Package collaboration (rattachement explicite → getOrgEntitlements) ───
  const { data: pkg, error: pkgErr } = await auth.supabaseAdmin
    .from('packages')
    .select('id')
    .is('domain_id', null)
    .eq('slug', 'collaboration')
    .eq('target_role', 'collaboration')
    .eq('active', true)
    .maybeSingle()
  if (pkgErr) {
    console.error('[ensure-org] package lookup failed', pkgErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!pkg) {
    // La migration/seed collaboration n'est pas appliquée → on ne crée rien.
    return json({ error: 'Collaboration package missing', code: 'package_missing' }, 503)
  }

  const first = (userRow.first_name as string | null)?.trim() ?? ''
  const last = (userRow.last_name as string | null)?.trim() ?? ''
  const companyName = `${first} ${last}`.trim() || 'Espace collaboration'

  // ── Création transactionnelle + cleanup atomique ─────────────────────────
  let organizationId: string | null = null
  try {
    const nowIso = new Date().toISOString()
    // 1. Organisation PERSONNELLE. owner_user_id = l'expert. Marquée vérifiée
    //    d'emblée (elle n'a pas à passer la vérif entreprise) pour ne pas
    //    apparaître dans les files d'attente admin.
    const { data: orgRow, error: orgErr } = await auth.supabaseAdmin
      .from('organizations')
      .insert({
        org_type: 'freelance',
        company_name: companyName,
        country: 'FR',
        owner_user_id: auth.user.id,
        is_verified: true,
        verification_status: 'approved',
        verified_at: nowIso,
        setup_completed_at: nowIso,
      })
      .select('id')
      .single()
    if (orgErr || !orgRow) {
      // Course perdue sur l'index unique partiel → on relit et retourne l'existante.
      if (isUniqueViolation(orgErr)) {
        const raced = await findPersonalOrg(auth, auth.user.id)
        if (raced) return json({ ok: true, organization_id: raced, created: false }, 200)
      }
      throw new EnsureOrgError('org_insert_failed', 'Could not create personal org', 500, orgErr)
    }
    organizationId = orgRow.id as string

    // 2. Membre admin actif = l'expert lui-même.
    const { error: memberErr } = await auth.supabaseAdmin
      .from('organization_members')
      .insert({
        user_id: auth.user.id,
        organization_id: organizationId,
        role_in_org: 'admin',
        status: 'active',
        invited_by: null,
      })
    if (memberErr) {
      throw new EnsureOrgError('member_insert_failed', 'Could not link member', 500, memberErr)
    }

    // 3. Rattachement domaine + PACKAGE collaboration (lu en priorité par
    //    getOrgEntitlements → quotas 1/mois, 1 dévoilé).
    const { error: domErr } = await auth.supabaseAdmin
      .from('organization_domains')
      .insert({
        organization_id: organizationId,
        domain_id: auth.user.domain_id,
        active: true,
        package_id: pkg.id,
      })
    if (domErr) {
      throw new EnsureOrgError('domain_insert_failed', 'Could not link domain/package', 500, domErr)
    }

    await logAudit({
      supabaseAdmin: auth.supabaseAdmin,
      user_id: auth.user.id,
      domain_id: auth.domain.id,
      action: 'personal_org_created',
      entity_type: 'organization',
      entity_id: organizationId,
      detail: { org_type: 'freelance', package_slug: 'collaboration' },
    })

    return json({ ok: true, organization_id: organizationId, created: true }, 200)
  } catch (err) {
    // ── CLEANUP ATOMIQUE : supprimer l'org (CASCADE members + domains) ──────
    console.error('[ensure-org] rollback', err instanceof Error ? err.message : String(err))
    if (organizationId) {
      try {
        const { error: delErr } = await auth.supabaseAdmin
          .from('organizations')
          .delete()
          .eq('id', organizationId)
        if (delErr) console.error('[ensure-org] cleanup org failed', delErr.message)
      } catch (cleanupErr) {
        console.error('[ensure-org] cleanup threw', cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr))
      }
    }
    if (err instanceof EnsureOrgError) {
      return json({ error: err.userMessage, code: err.code }, err.statusCode)
    }
    return json({ error: 'Internal error', code: 'internal_error' }, 500)
  }
}

/** Retourne l'id de l'org personnelle de l'expert (owner + freelance), ou null. */
async function findPersonalOrg(auth: AuthContext, userId: string): Promise<string | null> {
  const { data } = await auth.supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('owner_user_id', userId)
    .eq('org_type', 'freelance')
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}
