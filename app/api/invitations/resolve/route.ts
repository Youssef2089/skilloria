import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { hashInvitationToken } from '@/lib/invitation-token'
import { membershipIdentityForOrgType } from '@/lib/org-members'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/invitations/resolve?token=... — route PUBLIQUE (non authentifiée)
 * qui résout un token d'invitation pour la page /invitation/[token] (Lot B, B3).
 *
 * Renvoie le strict nécessaire pour l'écran d'acceptation SANS fuite : nom de
 * l'org, rôle proposé, et — pour amorcer le cas 2 (inscription) — le
 * user_type/role d'inscription DÉRIVÉ de l'org (A1) + le slug de domaine que
 * l'invité héritera. Jamais l'email invité en clair au-delà d'un booléen, ni
 * l'identité de l'inviteur.
 *
 * Token invalide / expiré / non-pending → 404 uniforme `invalid` (pas de
 * distinction exploitable). Service-role car la table est protégée par RLS
 * admin-only (un visiteur anonyme n'a aucun accès direct).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false } },
  )
}

export async function GET(request: NextRequest): Promise<Response> {
  const url = new URL(request.url)
  const token = (url.searchParams.get('token') ?? '').trim()
  if (!token) return json({ valid: false, code: 'invalid' }, 404)

  const admin = getAdmin()
  const { data: inv, error } = await admin
    .from('organization_invitations')
    .select('id, organization_id, email, role_in_org, status, expires_at, email_already_exists, organizations(company_name, org_type)')
    .eq('token', hashInvitationToken(token))
    .maybeSingle()

  // Réponse uniforme pour tout ce qui n'est pas une invitation acceptable.
  if (error || !inv || inv.status !== 'pending' || new Date(inv.expires_at).getTime() <= Date.now()) {
    return json({ valid: false, code: 'invalid' }, 404)
  }

  const orgRow = Array.isArray(inv.organizations) ? inv.organizations[0] : inv.organizations
  const orgType = (orgRow as { org_type?: string | null } | null)?.org_type ?? null

  // Slug du domaine actif de l'org (hérité par l'invité — il ne le choisit pas).
  let domainSlug: string | null = null
  const { data: od } = await admin
    .from('organization_domains')
    .select('domains(slug)')
    .eq('organization_id', inv.organization_id)
    .eq('active', true)
    .limit(1)
    .maybeSingle()
  if (od) {
    const d = Array.isArray(od.domains) ? od.domains[0] : od.domains
    domainSlug = (d as { slug?: string | null } | null)?.slug ?? null
  }

  const identity = membershipIdentityForOrgType(orgType)

  return json(
    {
      valid: true,
      company_name: (orgRow as { company_name?: string | null } | null)?.company_name ?? null,
      role_in_org: inv.role_in_org,
      // Email invité : renvoyé pour pré-remplir/verrouiller le formulaire du cas 2.
      // Faible risque : le token (haute entropie) n'a été envoyé qu'à cet email —
      // c'est le sien. On ne divulgue rien d'autre (ni inviteur, ni autres membres).
      email: inv.email,
      // Amorce du cas 2 (inscription) — l'invité NE choisit ni son type ni son domaine.
      email_already_exists: inv.email_already_exists === true,
      signup_role: identity.signupRole,
      domain_slug: domainSlug,
    },
    200,
  )
}
