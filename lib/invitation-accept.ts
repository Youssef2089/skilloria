import type { SupabaseClient } from '@supabase/supabase-js'
import { logAudit } from '@/lib/audit'
import { parametresJournal, type ContexteJournal } from '@/lib/journal/contexte'

/**
 * lib/invitation-accept.ts — logique d'acceptation d'invitation partagée par
 * les deux points d'entrée (Lot B, B3) :
 *   - cas 1 : compte existant qui clique le lien → lookup par TOKEN haché ;
 *   - cas 2 : compte fraîchement créé, détecté par EMAIL VÉRIFIÉ (arbitrage
 *     A2) → lookup de l'invitation pending par email.
 *
 * Dans les DEUX cas, l'acceptation exige que l'email de l'invitation corresponde
 * à l'email VÉRIFIÉ du user connecté (comparaison insensible à la casse). La
 * RLS n'autorisant pas un futur membre à s'insérer lui-même, l'écriture se fait
 * en service-role — par la RPC `accepter_invitation()` (§D.26).
 */

/**
 * D'OÙ l'on peut encore agir sur une invitation — l'accepter, la révoquer, la
 * renvoyer. La liste part EN PARAMÈTRE aux trois RPC : aucune fonction SQL ne
 * porte de littéral de statut, et les gardes applicatives lisent la MÊME liste.
 */
export const INVITATION_MODIFIABLE = ['pending'] as const

export type AcceptResult =
  | { ok: true; organizationId: string; alreadyMember: boolean }
  | { ok: false; code: 'not_found' | 'expired' | 'not_pending' | 'email_mismatch' | 'db_error' }

/**
 * Applique une invitation déjà résolue pour le compte qui accepte.
 *
 * ═══ LES GARDES SONT REJOUÉES EN BASE, SOUS VERROU ════════════════════════
 *   Statut, échéance et adresse vérifiée étaient jugés ici, sur une lecture
 *   d'avant — deux clics simultanés les franchissaient tous les deux — puis
 *   l'appartenance et l'invitation s'écrivaient en DEUX requêtes, et l'échec de
 *   la seconde était avalé : un membre entrait, l'invitation restait acceptable.
 *   `accepter_invitation()` verrouille l'invitation, rejoue les gardes (l'adresse
 *   est LUE sur le compte, jamais reçue d'ici), écrit l'appartenance, solde
 *   l'invitation et journalise `invitation_acceptee` : tout, ou rien.
 *
 *   L'appelant garantit `email_verified` avant d'appeler (A4) et le dit à
 *   l'utilisateur ; la base le revérifie, parce qu'une garde qui repose sur
 *   l'appelant n'est qu'une promesse.
 */
export async function applyInvitation(params: {
  admin: SupabaseClient
  journal: ContexteJournal
  invitation: { id: string; organization_id: string; role_in_org: string }
  userId: string
  /** L'écosystème de la LIGNE — celui du compte qui accepte. `audit_logs.domain_id` est NOT NULL. */
  domainId: string
}): Promise<AcceptResult> {
  const { admin, journal, invitation, userId, domainId } = params

  const { data, error } = await admin.rpc('accepter_invitation', {
    ...parametresJournal(journal),
    p_ecosysteme_id: domainId,
    p_invitation_id: invitation.id,
    p_statuts_admis: [...INVITATION_MODIFIABLE],
  })
  if (error) {
    console.error('[invitation-accept] accepter_invitation failed', error.message)
    return { ok: false, code: 'db_error' }
  }
  const verdict = (data ?? {}) as { issue?: string; organization_id?: string; deja_membre?: boolean }
  switch (verdict.issue) {
    case 'acceptee':
      break
    case 'introuvable':
      return { ok: false, code: 'not_found' }
    case 'not_pending':
    case 'expired':
    case 'email_mismatch':
      return { ok: false, code: verdict.issue }
    default:
      // Une issue inconnue n'est pas un succès (§E.30) : rien ne dit ce qui a été écrit.
      console.error('[invitation-accept] issue inconnue', verdict)
      return { ok: false, code: 'db_error' }
  }

  await logAudit({
    piece: journal.piece,
    supabaseAdmin: admin,
    user_id: userId,
    domain_id: domainId,
    action: 'org_invitation_accepted',
    entity_type: 'organization_invitations',
    entity_id: invitation.id,
    detail: { organization_id: invitation.organization_id, role_in_org: invitation.role_in_org },
  })

  return { ok: true, organizationId: invitation.organization_id, alreadyMember: verdict.deja_membre === true }
}
