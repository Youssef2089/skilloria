import { NextRequest } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/me/invitations/pending — détection par EMAIL VÉRIFIÉ (Lot B, B3
 * cas 2, arbitrage A2).
 *
 * Renvoie l'invitation 'pending' non expirée dont l'email correspond à l'email
 * VÉRIFIÉ du user connecté (comparaison insensible à la casse).
 *
 * SÉCURITÉ (A4) : on ne révèle une invitation qu'à un user AUTHENTIFIÉ dont
 * `email_verified = true`. Un compte non confirmé ne voit rien (204-like :
 * { invitation: null }). Aucune fuite d'information vers un tiers.
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

  const admin = auth.supabaseAdmin

  // Email + statut de vérification du user connecté.
  const { data: me, error: meErr } = await admin
    .from('users')
    .select('email, email_verified')
    .eq('id', auth.user.id)
    .maybeSingle()
  if (meErr || !me) {
    return json({ invitation: null }, 200)
  }
  // A4 : email non vérifié → on ne révèle rien.
  if (me.email_verified !== true || !me.email) {
    return json({ invitation: null }, 200)
  }

  const nowIso = new Date().toISOString()
  const { data: inv } = await admin
    .from('organization_invitations')
    .select('id, organization_id, role_in_org, expires_at, organizations(company_name, org_type)')
    .ilike('email', me.email as string)
    .eq('status', 'pending')
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!inv) return json({ invitation: null }, 200)

  const orgRow = Array.isArray(inv.organizations) ? inv.organizations[0] : inv.organizations
  return json(
    {
      invitation: {
        id: inv.id,
        organization_id: inv.organization_id,
        role_in_org: inv.role_in_org,
        expires_at: inv.expires_at,
        company_name: (orgRow as { company_name?: string | null } | null)?.company_name ?? null,
      },
    },
    200,
  )
}
