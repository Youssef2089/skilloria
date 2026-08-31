import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { requireReauth } from '@/lib/reauth-token'
import { logAudit } from '@/lib/audit'
import { isValidOrgRole, countActiveAdmins, wouldRemoveLastAdmin } from '@/lib/org-members'
import {
  loadAdminActionTarget,
  refuseAdminActionOnTarget,
  refusalHttpStatus,
} from '@/lib/admin/user-actions-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * PATCH /api/admin/user-org-role — change le RÔLE d'un compte dans SON
 * organisation, depuis le back-office plateforme.
 *
 * Body : { user_id, role_in_org: 'viewer'|'editor'|'admin', force?: boolean }
 * Header : `x-reauth-token` obligatoire.
 *
 * POURQUOI CETTE ROUTE EXISTE
 *   Une organisation qui perd son unique administrateur (départ, compte
 *   supprimé) ne peut plus inviter ni promouvoir personne : elle est
 *   définitivement bloquée du point de vue de ses propres écrans. Le
 *   dépannage ne peut donc venir que de la plateforme. C'est le seul motif de
 *   cette route, et c'est ce qui justifie qu'elle puisse franchir la garde
 *   anti-lock-out que la route d'organisation, elle, applique sans exception.
 *
 * ANTI-LOCK-OUT : ACTIF PAR DÉFAUT, JAMAIS CONTOURNÉ IMPLICITEMENT
 *   La MÊME garde que /api/me/organisation/members/[id] — `countActiveAdmins`
 *   et `wouldRemoveLastAdmin`, importées, pas réécrites. Elle refuse par
 *   défaut (409 `last_admin`). Seul un `force: true` EXPLICITE dans le corps la
 *   lève, et seule la modale de confirmation l'envoie : elle nomme
 *   l'organisation et le membre, et annonce que l'organisation se retrouvera
 *   sans administrateur. Un appel qui omet `force` se comporte exactement comme
 *   côté organisation — aucun chemin ne relâche la garde en silence.
 *
 *   Vérifié : aucune politique RLS ne dépend de `role_in_org = 'admin'` (celles
 *   qui gouvernent `publications` s'appuient sur l'appartenance ACTIVE). Une
 *   organisation à zéro administrateur ne perd donc ni ses annonces ni ses
 *   candidatures ; elle perd la capacité de gérer ses membres, ce que la
 *   promotion d'un autre membre depuis cet écran rétablit en un clic.
 *
 * PAS DE NOTIFICATION À L'ORGANISATION (décision produit V0). L'administrateur
 * plateforme assume en connaissance de cause — d'où la confirmation explicite
 * et la trace d'audit ci-dessous.
 *
 * GARDES DE COMPTE : jamais sur soi-même, jamais sur un autre administrateur
 * plateforme, jamais zéro administrateur plateforme actif.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export async function PATCH(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const reauthFail = requireReauth(request, auth.user.id)
  if (reauthFail) return reauthFail

  let body: { user_id?: unknown; role_in_org?: unknown; force?: unknown }
  try {
    body = (await request.json()) as { user_id?: unknown; role_in_org?: unknown; force?: unknown }
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const targetId = typeof body.user_id === 'string' ? body.user_id : ''
  const newRole = body.role_in_org
  // `force` n'est vrai QUE sur un booléen `true` littéral. Ni "true", ni 1, ni
  // un objet : un contournement doit être délibéré, pas le fruit d'une
  // coercition de type.
  const force = body.force === true

  if (!UUID_REGEX.test(targetId) || !isValidOrgRole(newRole)) {
    return json({ error: 'user_id and role_in_org are required', code: 'invalid_body' }, 400)
  }

  const target = await loadAdminActionTarget(auth.supabaseAdmin, targetId)
  const refusal = await refuseAdminActionOnTarget({
    supabaseAdmin: auth.supabaseAdmin,
    adminUserId: auth.user.id,
    target,
  })
  if (refusal) {
    return json({ error: refusal.message, code: refusal.code }, refusalHttpStatus(refusal))
  }
  const t = target!

  // Adhésion ACTIVE de la cible. Une adhésion révoquée n'est pas un
  // rattachement : on ne ressuscite pas un membre parti en changeant son rôle.
  const { data: memberRow, error: memberErr } = await auth.supabaseAdmin
    .from('organization_members')
    .select('id, organization_id, role_in_org, status, organizations(id, company_name)')
    .eq('user_id', t.id)
    .eq('status', 'active')
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (memberErr) {
    console.error('[admin:user-org-role] membership lookup failed', memberErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!memberRow) {
    return json({ error: 'User has no active organization', code: 'no_membership' }, 404)
  }
  const member = memberRow as unknown as {
    id: string
    organization_id: string
    role_in_org: string
    organizations: { id: string; company_name: string | null } | { id: string; company_name: string | null }[] | null
  }
  const org = Array.isArray(member.organizations) ? member.organizations[0] : member.organizations

  if (member.role_in_org === newRole) {
    return json({ error: 'No change', code: 'nothing_to_update' }, 400)
  }

  // ── Anti-lock-out (garde partagée, non réécrite) ─────────────────────────
  const targetIsActiveAdmin = member.role_in_org === 'admin'
  let lastAdminBypassed = false
  if (targetIsActiveAdmin && newRole !== 'admin') {
    const admins = await countActiveAdmins(auth.supabaseAdmin, member.organization_id)
    if (wouldRemoveLastAdmin({ targetIsActiveAdmin, activeAdminCount: admins })) {
      if (!force) {
        // Refus par défaut, AVEC le contexte dont la modale a besoin pour
        // poser la question honnêtement (nom de l'organisation).
        return json(
          {
            error: 'Would remove last admin',
            code: 'last_admin',
            organization: { id: member.organization_id, company_name: org?.company_name ?? null },
          },
          409,
        )
      }
      lastAdminBypassed = true
    }
  }

  const { error: upErr } = await auth.supabaseAdmin
    .from('organization_members')
    .update({ role_in_org: newRole, updated_at: new Date().toISOString() })
    .eq('id', member.id)
  if (upErr) {
    console.error('[admin:user-org-role] role update failed', upErr.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.user.domain_id,
    // MÊME action que le changement de rôle côté organisation : un seul
    // vocabulaire pour un seul fait. Ce qui distingue l'intervention
    // plateforme vit dans `detail`, pas dans une action jumelle qui aurait
    // fini par diverger.
    action: 'org_member_role_changed',
    entity_type: 'organization_members',
    entity_id: member.id,
    detail: {
      by_platform_admin: true,
      target_user_id: t.id,
      target_domain_id: t.domain_id,
      organization_id: member.organization_id,
      previous_role: member.role_in_org,
      new_role: newRole,
      /** `true` ⇒ l'organisation se retrouve sans administrateur actif. */
      last_admin_bypassed: lastAdminBypassed,
    },
    request,
  })

  return json(
    { ok: true, user_id: t.id, role_in_org: newRole, last_admin_bypassed: lastAdminBypassed },
    200,
  )
}
