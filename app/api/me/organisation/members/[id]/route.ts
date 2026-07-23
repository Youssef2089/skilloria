import { NextRequest } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'
import { isValidOrgRole, countActiveAdmins, wouldRemoveLastAdmin } from '@/lib/org-members'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Gestion d'un membre d'organisation (Lot B, B4). `[id]` = organization_members.id.
 *
 *  - PATCH  { role_in_org } : change le rôle d'un membre.
 *  - DELETE                 : retrait SOFT (status='removed').
 *
 * Gardes communes (D2/D3), toutes côté serveur :
 *   1. ADMIN ACTIF de l'org (auth.organization.role_in_org === 'admin').
 *   2. Cible dans la MÊME org que l'appelant (pas d'action cross-org).
 *   3. INTERDIT sur sa propre ligne (cohérent RLS M4 : user_id <> auth.uid()).
 *   4. ANTI LOCK-OUT : refus si l'opération retirerait le dernier admin actif.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type Ctx = { params: Promise<{ id: string }> }

/** Facteur commun : auth + garde admin + chargement de la ligne cible. */
async function loadTarget(request: NextRequest, memberId: string) {
  const auth = await requireAuth(request)
  const org = auth.organization
  if (!org) return { error: json({ error: 'No organization', code: 'no_organization' }, 403) }
  if (org.role_in_org !== 'admin') {
    return { error: json({ error: 'Admin role required', code: 'not_org_admin' }, 403) }
  }

  const { data: target, error } = await auth.supabaseAdmin
    .from('organization_members')
    .select('id, user_id, organization_id, role_in_org, status')
    .eq('id', memberId)
    .maybeSingle()
  if (error) {
    console.error('[me/members/:id] lookup failed', error.message)
    return { error: json({ error: 'Query failed', code: 'db_error' }, 500) }
  }
  // Cible inexistante OU d'une autre org → 404 (pas de fuite cross-org).
  if (!target || target.organization_id !== org.id) {
    return { error: json({ error: 'Member not found', code: 'not_found' }, 404) }
  }
  // Interdit sur soi-même (aligné RLS M4).
  if (target.user_id === auth.user.id) {
    return { error: json({ error: 'Cannot act on your own membership', code: 'self_forbidden' }, 400) }
  }
  return { error: null as null, auth, org, target }
}

export async function PATCH(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params
  let loaded
  try {
    loaded = await loadTarget(request, id)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  if (loaded.error) return loaded.error
  const { auth, org, target } = loaded

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_body' }, 400)
  }
  const newRole = body.role_in_org
  if (!isValidOrgRole(newRole)) {
    return json({ error: 'Invalid role', code: 'invalid_role' }, 400)
  }
  if (newRole === target.role_in_org) {
    return json({ error: 'No change', code: 'nothing_to_update' }, 400)
  }

  // Anti lock-out : rétrograder le DERNIER admin actif.
  const targetIsActiveAdmin = target.role_in_org === 'admin' && target.status === 'active'
  if (targetIsActiveAdmin && newRole !== 'admin') {
    const admins = await countActiveAdmins(auth.supabaseAdmin, org.id)
    if (wouldRemoveLastAdmin({ targetIsActiveAdmin, activeAdminCount: admins })) {
      return json({ error: 'Would remove last admin', code: 'last_admin' }, 409)
    }
  }

  const { error: upErr } = await auth.supabaseAdmin
    .from('organization_members')
    .update({ role_in_org: newRole, updated_at: new Date().toISOString() })
    .eq('id', target.id)
  if (upErr) {
    console.error('[me/members/:id] role update failed', upErr.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'org_member_role_changed',
    entity_type: 'organization_members',
    entity_id: target.id,
    detail: { target_user_id: target.user_id, from: target.role_in_org, to: newRole },
  })
  return json({ ok: true }, 200)
}

export async function DELETE(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params
  let loaded
  try {
    loaded = await loadTarget(request, id)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  if (loaded.error) return loaded.error
  const { auth, org, target } = loaded

  // Anti lock-out : retirer le DERNIER admin actif.
  const targetIsActiveAdmin = target.role_in_org === 'admin' && target.status === 'active'
  if (targetIsActiveAdmin) {
    const admins = await countActiveAdmins(auth.supabaseAdmin, org.id)
    if (wouldRemoveLastAdmin({ targetIsActiveAdmin, activeAdminCount: admins })) {
      return json({ error: 'Would remove last admin', code: 'last_admin' }, 409)
    }
  }

  // Retrait SOFT (status='removed') plutôt que DELETE physique.
  const { error: upErr } = await auth.supabaseAdmin
    .from('organization_members')
    .update({ status: 'removed', updated_at: new Date().toISOString() })
    .eq('id', target.id)
  if (upErr) {
    console.error('[me/members/:id] remove failed', upErr.message)
    return json({ error: 'Remove failed', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'org_member_removed',
    entity_type: 'organization_members',
    entity_id: target.id,
    detail: { target_user_id: target.user_id, role_in_org: target.role_in_org },
  })
  return json({ ok: true }, 200)
}
