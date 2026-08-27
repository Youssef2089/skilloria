import type { SupabaseClient } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'
import { isExpertProfileApproved, PROFILE_NOT_VERIFIED_CODE } from '@/lib/expert-verified-guard'

/**
 * lib/collaboration/ensure-personal-org.ts — CRÉATION LAZY de l'organisation
 * PERSONNELLE d'un expert.
 *
 * ⚠️ CE MODULE EST UNE EXTRACTION, PAS UNE RÉÉCRITURE.
 *   Le corps vient tel quel de /api/me/collaboration/ensure-org : mêmes gardes,
 *   même idempotence, même transaction avec cleanup atomique, mêmes codes
 *   d'erreur. Seuls les accès `auth.*` sont devenus des paramètres, pour que la
 *   route de publication puisse l'appeler dans SA requête.
 *
 * POURQUOI L'EXTRACTION
 *   L'organisation était créée au CHARGEMENT des écrans de collaboration : tout
 *   expert vérifié qui ouvrait l'entrée « Sous-traitance » par curiosité
 *   repartait avec une organisation, une ligne organization_members et un
 *   rattachement d'offre — sans avoir rien publié ni même rien saisi. L'écran
 *   /admin/collaboration mesurait donc la curiosité, et son plafond de lecture
 *   finissait par masquer les organisations réellement actives.
 *   La création se fait désormais au moment de PUBLIER. Une organisation par
 *   tentative de publication, plus une par curieux.
 *
 * CE QUI RESTE VRAI
 *   - IDEMPOTENT : au plus une org personnelle par expert. L'index unique
 *     partiel `organizations_personal_owner_unique_idx` tranche les courses
 *     (23505 → on relit et on retourne l'existante).
 *   - TRANSACTIONNEL : org → organization_members → organization_domains. Tout
 *     échec en aval supprime l'org (CASCADE emporte members + domains).
 *   - Le rattachement suit l'OFFRE PAR DÉFAUT du catalogue, jamais un slug figé.
 */

export type EnsurePersonalOrgResult =
  | { ok: true; organizationId: string; created: boolean }
  | { ok: false; code: string; message: string; status: number }

class EnsureOrgError extends Error {
  constructor(public code: string, public userMessage: string, public statusCode: number, public cause?: unknown) {
    super(userMessage)
    this.name = 'EnsureOrgError'
  }
}

function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === '23505'
}

/** Retourne l'id de l'org personnelle de l'expert (owner + freelance), ou null. */
export async function findPersonalOrg(
  admin: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('organizations')
    .select('id')
    .eq('owner_user_id', userId)
    .eq('org_type', 'freelance')
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

export async function ensurePersonalOrg(
  admin: SupabaseClient,
  userId: string,
  domains: { userDomainId: string; auditDomainId: string },
): Promise<EnsurePersonalOrgResult> {
  // ── Expert uniquement ────────────────────────────────────────────────────
  const { data: userRow, error: userErr } = await admin
    .from('users')
    .select('user_type, first_name, last_name')
    .eq('id', userId)
    .maybeSingle()
  if (userErr || !userRow) {
    return { ok: false, code: 'user_missing', message: 'User not found', status: 404 }
  }
  const userType = userRow.user_type as string | null
  if (userType !== 'expert_freelance' && userType !== 'expert_cdi') {
    return { ok: false, code: 'forbidden', message: 'Experts only', status: 403 }
  }

  // ── C2 : GARDE profil approuvé (checklist #4/#20) ────────────────────────
  //  Un expert non vérifié ne peut pas créer son espace de collaboration ni,
  //  par ricochet, publier un besoin. Verrou SERVEUR (non contournable par un
  //  appel direct), miroir du lock UI de la sidebar.
  if (!(await isExpertProfileApproved(admin, userId))) {
    return { ok: false, code: PROFILE_NOT_VERIFIED_CODE, message: 'Profile not verified', status: 403 }
  }

  // ── Idempotence : org personnelle déjà présente ? ────────────────────────
  const existing = await findPersonalOrg(admin, userId)
  if (existing) {
    return { ok: true, organizationId: existing, created: false }
  }

  // ── Offre collaboration PAR DÉFAUT (rattachement explicite → entitlements) ─
  //  On cible le DÉFAUT de la cible 'collaboration', jamais un slug littéral :
  //  le catalogue peut contenir plusieurs offres de collaboration, et c'est
  //  l'admin qui décide laquelle reçoit les nouveaux experts (back-office,
  //  point 8). L'invariant « exactement une offre par défaut active par cible »
  //  est tenu par la RPC set_default_package — cette lecture est donc
  //  déterministe par construction.
  const { data: pkg, error: pkgErr } = await admin
    .from('packages')
    .select('id, slug')
    .is('domain_id', null)
    .eq('target_role', 'collaboration')
    .eq('is_default', true)
    .eq('active', true)
    .maybeSingle()
  if (pkgErr) {
    console.error('[ensure-org] default collaboration package lookup failed', pkgErr.message)
    return { ok: false, code: 'db_error', message: 'Query failed', status: 500 }
  }
  if (!pkg) {
    // Aucune offre de collaboration par défaut au catalogue (migration non
    // appliquée, ou offre désactivée depuis l'admin) → on ne crée rien plutôt
    // que de rattacher l'expert à une offre arbitraire.
    console.error('[ensure-org] no active default package for target_role=collaboration')
    return { ok: false, code: 'package_missing', message: 'Collaboration package missing', status: 503 }
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
    const { data: orgRow, error: orgErr } = await admin
      .from('organizations')
      .insert({
        org_type: 'freelance',
        company_name: companyName,
        country: 'FR',
        owner_user_id: userId,
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
        const raced = await findPersonalOrg(admin, userId)
        if (raced) return { ok: true, organizationId: raced, created: false }
      }
      throw new EnsureOrgError('org_insert_failed', 'Could not create personal org', 500, orgErr)
    }
    organizationId = orgRow.id as string

    // 2. Membre admin actif = l'expert lui-même.
    const { error: memberErr } = await admin
      .from('organization_members')
      .insert({
        user_id: userId,
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
    const { error: domErr } = await admin
      .from('organization_domains')
      .insert({
        organization_id: organizationId,
        domain_id: domains.userDomainId,
        active: true,
        package_id: pkg.id,
      })
    if (domErr) {
      throw new EnsureOrgError('domain_insert_failed', 'Could not link domain/package', 500, domErr)
    }

    await logAudit({
      supabaseAdmin: admin,
      user_id: userId,
      domain_id: domains.auditDomainId,
      action: 'personal_org_created',
      entity_type: 'organization',
      entity_id: organizationId,
      detail: { org_type: 'freelance', package_slug: pkg.slug as string },
    })

    return { ok: true, organizationId, created: true }
  } catch (err) {
    // ── CLEANUP ATOMIQUE : supprimer l'org (CASCADE members + domains) ──────
    console.error('[ensure-org] rollback', err instanceof Error ? err.message : String(err))
    if (organizationId) {
      try {
        const { error: delErr } = await admin
          .from('organizations')
          .delete()
          .eq('id', organizationId)
        if (delErr) console.error('[ensure-org] cleanup org failed', delErr.message)
      } catch (cleanupErr) {
        console.error('[ensure-org] cleanup threw', cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr))
      }
    }
    if (err instanceof EnsureOrgError) {
      return { ok: false, code: err.code, message: err.userMessage, status: err.statusCode }
    }
    return { ok: false, code: 'internal_error', message: 'Internal error', status: 500 }
  }
}
