import { NextRequest } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth-guard'
import { hashInvitationToken } from '@/lib/invitation-token'
import { applyInvitation } from '@/lib/invitation-accept'
import { joinBlockReason } from '@/lib/org-members'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/me/invitations/accept — acceptation d'une invitation (Lot B, B3).
 *
 * Deux modes, MÊME logique d'application (lib/invitation-accept) :
 *  - body { token } : cas 1 (compte existant qui a cliqué le lien). Lookup par
 *    hash du token.
 *  - body {} : cas 2 (détecté par email vérifié). On accepte l'unique
 *    invitation pending non expirée qui matche l'email VÉRIFIÉ du user.
 *
 * Dans les deux cas : email de l'invitation == email vérifié du user (A4), sinon
 * refus. Réponses d'erreur volontairement sobres (pas de fuite d'info).
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

  const admin = auth.supabaseAdmin

  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    // body vide accepté (cas 2).
  }
  const token = typeof body.token === 'string' ? body.token.trim() : ''

  // ── Email vérifié du user (garde A4) ────────────────────────────────────────
  const { data: me, error: meErr } = await admin
    .from('users')
    .select('email, email_verified')
    .eq('id', auth.user.id)
    .maybeSingle()
  if (meErr || !me || me.email_verified !== true || !me.email) {
    return json({ error: 'Email not verified', code: 'email_not_verified' }, 403)
  }
  const verifiedEmail = me.email as string

  // ── Résolution de l'invitation ──────────────────────────────────────────────
  const COLS = 'id, organization_id, email, role_in_org, status, expires_at, invited_by'
  type Inv = {
    id: string
    organization_id: string
    email: string
    role_in_org: string
    status: string
    expires_at: string
    invited_by: string | null
  }
  let invitation: Inv | null = null

  if (token) {
    const { data } = await admin
      .from('organization_invitations')
      .select(COLS)
      .eq('token', hashInvitationToken(token))
      .maybeSingle()
    invitation = (data as unknown as Inv | null) ?? null
  } else {
    const nowIso = new Date().toISOString()
    const { data } = await admin
      .from('organization_invitations')
      .select(COLS)
      .ilike('email', verifiedEmail)
      .eq('status', 'pending')
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    invitation = (data as unknown as Inv | null) ?? null
  }

  if (!invitation) {
    return json({ error: 'Invitation not found', code: 'not_found' }, 404)
  }

  // ── Filet serveur (règle figée) : le compte connecté peut avoir été créé /
  // modifié entre l'invitation et l'acceptation. On refuse un compte expert /
  // admin, ou déjà membre actif d'une AUTRE org — jamais d'insertion dans
  // organization_members dans ces cas.
  const block = await joinBlockReason(admin, auth.user.id, invitation.organization_id)
  if (block) {
    return json({ error: 'Account cannot join', code: block }, 403)
  }

  const result = await applyInvitation({
    admin,
    invitation,
    userId: auth.user.id,
    verifiedEmail,
    domainId: auth.domain.id,
  })

  if (!result.ok) {
    const status = result.code === 'db_error' ? 500 : result.code === 'email_mismatch' ? 403 : 409
    return json({ error: 'Cannot accept invitation', code: result.code }, status)
  }

  return json({ ok: true, organization_id: result.organizationId, already_member: result.alreadyMember }, 200)
}
