import type { SupabaseClient } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'

/**
 * lib/invitation-accept.ts — logique d'acceptation d'invitation partagée par
 * les deux points d'entrée (Lot B, B3) :
 *   - cas 1 : compte existant qui clique le lien → lookup par TOKEN haché ;
 *   - cas 2 : compte fraîchement créé, détecté par EMAIL VÉRIFIÉ (arbitrage
 *     A2) → lookup de l'invitation pending par email.
 *
 * Dans les DEUX cas, l'acceptation exige que l'email de l'invitation corresponde
 * à l'email VÉRIFIÉ du user connecté (comparaison insensible à la casse). La
 * RLS n'autorisant pas un futur membre à s'insérer lui-même, l'INSERT dans
 * organization_members se fait en service-role.
 */

export type AcceptResult =
  | { ok: true; organizationId: string; alreadyMember: boolean }
  | { ok: false; code: 'not_found' | 'expired' | 'not_pending' | 'email_mismatch' | 'db_error' }

/**
 * Applique une invitation déjà résolue (ligne complète) pour le user donné.
 * `verifiedEmail` DOIT être l'email vérifié du user (le caller garantit
 * email_verified = true avant d'appeler — A4).
 */
export async function applyInvitation(params: {
  admin: SupabaseClient
  invitation: {
    id: string
    organization_id: string
    email: string
    role_in_org: string
    status: string
    expires_at: string
    invited_by: string | null
  }
  userId: string
  verifiedEmail: string
  domainId: string | null
}): Promise<AcceptResult> {
  const { admin, invitation, userId, verifiedEmail, domainId } = params

  if (invitation.status !== 'pending') return { ok: false, code: 'not_pending' }
  if (new Date(invitation.expires_at).getTime() <= Date.now()) return { ok: false, code: 'expired' }
  if (invitation.email.trim().toLowerCase() !== verifiedEmail.trim().toLowerCase()) {
    return { ok: false, code: 'email_mismatch' }
  }

  // ── Déjà membre ? (idempotence : réactive une ligne 'removed', ne duplique pas) ──
  const { data: existing, error: exErr } = await admin
    .from('organization_members')
    .select('id, status')
    .eq('organization_id', invitation.organization_id)
    .eq('user_id', userId)
    .maybeSingle()
  if (exErr) {
    console.error('[invitation-accept] member lookup failed', exErr.message)
    return { ok: false, code: 'db_error' }
  }

  let alreadyMember = false
  if (existing) {
    if (existing.status === 'active') {
      alreadyMember = true
    } else {
      // Réintégration : on réactive la ligne avec le rôle du token.
      const { error: upErr } = await admin
        .from('organization_members')
        .update({ role_in_org: invitation.role_in_org, status: 'active', updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (upErr) {
        console.error('[invitation-accept] member reactivate failed', upErr.message)
        return { ok: false, code: 'db_error' }
      }
    }
  } else {
    const { error: insErr } = await admin.from('organization_members').insert({
      organization_id: invitation.organization_id,
      user_id: userId,
      role_in_org: invitation.role_in_org,
      status: 'active',
      invited_by: invitation.invited_by,
    })
    if (insErr) {
      console.error('[invitation-accept] member insert failed', insErr.message)
      return { ok: false, code: 'db_error' }
    }
  }

  // ── Marque l'invitation acceptée ────────────────────────────────────────────
  const { error: invUpErr } = await admin
    .from('organization_invitations')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', invitation.id)
  if (invUpErr) {
    console.error('[invitation-accept] invitation update failed', invUpErr.message)
    // Le membre est déjà en place : on ne renvoie pas d'erreur bloquante.
  }

  await logAudit({
    supabaseAdmin: admin,
    user_id: userId,
    domain_id: domainId,
    action: 'org_invitation_accepted',
    entity_type: 'organization_invitations',
    entity_id: invitation.id,
    detail: { organization_id: invitation.organization_id, role_in_org: invitation.role_in_org },
  })

  return { ok: true, organizationId: invitation.organization_id, alreadyMember }
}
