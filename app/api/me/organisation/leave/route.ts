import { NextRequest } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'
import { countActiveAdmins, majMembreOrganisation } from '@/lib/org-members'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/me/organisation/leave — quitter son organisation (Lot B, B5).
 *
 * La RLS M4 interdit l'auto-suppression (organization_members_admin_delete a
 * `user_id <> auth.uid()`), donc un membre ne peut PAS se retirer en
 * client-direct : cette route service-role est le seul chemin.
 *
 * Garde ANTI LOCK-OUT (D3) : si l'appelant est le DERNIER admin actif, refus
 * explicite (« désignez un autre administrateur avant de quitter »). Retrait
 * SOFT (status='removed') pour cohérence avec le retrait par un admin (B4).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const org = auth.organization
  if (!org) return json({ error: 'No organization', code: 'no_organization' }, 403)

  const admin = auth.supabaseAdmin

  // Ligne d'appartenance active de l'appelant.
  const { data: myRow, error: myErr } = await admin
    .from('organization_members')
    .select('id, role_in_org, status')
    .eq('organization_id', org.id)
    .eq('user_id', auth.user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (myErr) {
    console.error('[me/leave] self lookup failed', myErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!myRow) {
    return json({ error: 'Not an active member', code: 'not_member' }, 400)
  }

  // Anti lock-out : dernier admin actif.
  if (myRow.role_in_org === 'admin') {
    const admins = await countActiveAdmins(admin, org.id)
    if (admins <= 1) {
      return json({ error: 'You are the last admin', code: 'last_admin' }, 409)
    }
  }

  // L'ÉCRITURE PASSE PAR LA BASE (migration 20260914200010). Le comptage
  // ci-dessus reste — il pose une question que la base ne peut pas poser, et
  // donne un refus précis — mais deux derniers administrateurs qui partent au
  // même instant le franchissaient tous les deux. La RPC transfère le siège
  // d'administrateur avant le départ de son occupant, dans la même transaction.
  const res = await majMembreOrganisation(admin, {
    membreId: myRow.id as string,
    nouveauStatut: 'removed',
  })
  if (res === 'dernier_admin') {
    return json({ error: 'You are the last admin', code: 'last_admin' }, 409)
  }
  if (res !== 'ok') {
    console.error('[me/leave] leave failed', res)
    return json({ error: 'Leave failed', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: admin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'org_member_left',
    entity_type: 'organization_members',
    entity_id: myRow.id,
    detail: { organization_id: org.id, role_in_org: myRow.role_in_org },
  })

  return json({ ok: true }, 200)
}
