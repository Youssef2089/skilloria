import { NextRequest } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/me/organisation/members — données de la page « Membres équipe »
 * (Lot B, B1).
 *
 * Renvoie en une passe :
 *  - `members` : membres de l'org (status active/suspended/pending), lisibles
 *    par TOUT membre actif ;
 *  - `invitations` : invitations 'pending' non expirées — UNIQUEMENT si le
 *    caller est admin (cohérent avec la policy RLS organization_invitations_
 *    admin_all, qui réserve leur lecture aux admins). Non-admin → tableau vide.
 *  - `isAdmin`, `me` (user_id du caller) : pilotent l'affichage des actions.
 *
 * Lecture servie côté serveur (service-role) plutôt qu'en client-direct : la
 * jointure members↔users et la lecture des invitations sont ainsi homogènes et
 * la RLS invitations (admin-only) est respectée sans requête client vouée à
 * échouer pour un non-admin.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function GET(request: NextRequest): Promise<Response> {
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
  const isAdmin = org.role_in_org === 'admin'

  // ── Membres (on exclut les 'removed' — retrait soft) ────────────────────────
  const { data: memberRows, error: memErr } = await admin
    .from('organization_members')
    .select('id, user_id, role_in_org, status, joined_at, users(first_name, last_name, email)')
    .eq('organization_id', org.id)
    .neq('status', 'removed')
    .order('joined_at', { ascending: true })
  if (memErr) {
    console.error('[me/members] members lookup failed', memErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  const members = (memberRows ?? []).map((r) => {
    const u = Array.isArray(r.users) ? r.users[0] : r.users
    return {
      id: r.id as string,
      user_id: r.user_id as string,
      role_in_org: r.role_in_org as string,
      status: r.status as string,
      joined_at: r.joined_at as string,
      first_name: (u as { first_name?: string | null } | null)?.first_name ?? null,
      last_name: (u as { last_name?: string | null } | null)?.last_name ?? null,
      email: (u as { email?: string | null } | null)?.email ?? null,
    }
  })

  // ── Invitations pending (admins uniquement) ─────────────────────────────────
  let invitations: unknown[] = []
  if (isAdmin) {
    const nowIso = new Date().toISOString()
    const { data: invRows, error: invErr } = await admin
      .from('organization_invitations')
      .select('id, email, role_in_org, status, expires_at, domain_validation_passed, email_already_exists, created_at')
      .eq('organization_id', org.id)
      .eq('status', 'pending')
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
    if (invErr) {
      console.error('[me/members] invitations lookup failed', invErr.message)
      return json({ error: 'Query failed', code: 'db_error' }, 500)
    }
    invitations = invRows ?? []
  }

  return json({ members, invitations, isAdmin, me: auth.user.id }, 200)
}
