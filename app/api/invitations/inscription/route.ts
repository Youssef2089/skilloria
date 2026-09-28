import { NextRequest } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { hashInvitationToken } from '@/lib/invitation-token'
import { membershipIdentityForOrgType } from '@/lib/org-members'
import { INVITATION_MODIFIABLE } from '@/lib/invitation-accept'
import { logAudit } from '@/lib/audit'
import { CGU_VERSION } from '@/lib/legal'
import { nouvellePiece } from '@/lib/journal/piece'
import { signerPreuveInscription } from '@/lib/inscription/preuve.mjs'
import { refusInscription, nommerLeRefus, INSCRIPTION_INDISPONIBLE } from '@/lib/inscription/refus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/invitations/inscription — L'INVITÉ CRÉE SON COMPTE, AU SERVEUR (§D.27).
 *
 * Body : { token, firstname, lastname, password, cgu_accepted }
 *
 * ═══ POURQUOI UNE ROUTE ═════════════════════════════════════════════════════
 *   L'invité s'inscrivait DANS LE NAVIGATEUR (`supabase.auth.signUp`, clé
 *   publique) : la case des CGU n'était vérifiée que par l'écran, et son
 *   consentement n'était enregistré NULLE PART. La base exige désormais une
 *   preuve signée par le serveur : cette route la signe, après avoir lu
 *   l'invitation.
 *
 * ═══ L'ADRESSE EST CELLE DE L'INVITATION, CONFIRMÉE D'OFFICE ════════════════
 *   Décision de Youssef : le lien d'invitation, reçu dans la boîte, PROUVE déjà
 *   l'adresse. Le compte est créé avec l'adresse de l'invitation (jamais une
 *   adresse saisie) et `email_confirm: true` — aucun second e-mail. La base
 *   recompare les deux adresses sans casse (`invitation_email_mismatch`).
 *
 * ═══ TOUT, OU RIEN ══════════════════════════════════════════════════════════
 *   Le trigger écrit le compte (actif), son consentement aux CGU, puis accepte
 *   l'invitation (`accepter_invitation` : appartenance, invitation soldée,
 *   `invitation_acceptee`) sous la pièce de `compte_cree`. Un compte
 *   d'organisation ne naît jamais sans son organisation.
 *
 * Le rôle et l'écosystème sont DÉRIVÉS de l'organisation, jamais reçus : un
 * invité ne choisit ni son type de compte ni son écosystème.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function texte(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function getAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('missing_env')
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }
  const token = texte(body.token)
  if (!token) {
    return json({ error: 'Invalid invitation', code: 'invitation_invalide' }, 404)
  }
  const password = typeof body.password === 'string' ? body.password : ''
  // Le mot de passe : GoTrue le hache, la base ne le voit jamais — la règle reste ici.
  if (password.length < 8 || password.length > 200) {
    return json({ error: 'Invalid input', code: 'invalid_password' }, 400)
  }
  if (body.cgu_accepted !== true) {
    return json({ error: 'Invalid input', code: 'cgu_required' }, 400)
  }

  let admin: SupabaseClient
  try {
    admin = getAdmin()
  } catch {
    return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
  }

  // ── L'invitation, par son jeton haché ─────────────────────────────────────
  const { data: inv, error: invErr } = await admin
    .from('organization_invitations')
    .select('id, organization_id, email, organizations(org_type)')
    .eq('token', hashInvitationToken(token))
    .maybeSingle()
  if (invErr) {
    // Ne pas savoir n'est pas « invitation invalide » (§E.22) : 503, rien n'est créé.
    console.error('[invitations/inscription] invitation illisible', invErr.message)
    return json({ error: 'Could not read the invitation', code: 'invitation_lecture_indisponible' }, 503)
  }
  if (!inv) {
    return json({ error: 'Invalid invitation', code: 'invitation_invalide' }, 404)
  }
  const orgRow = Array.isArray(inv.organizations) ? inv.organizations[0] : inv.organizations
  const identite = membershipIdentityForOrgType((orgRow as { org_type?: string | null } | null)?.org_type ?? null)

  // L'écosystème de l'organisation — l'invité l'hérite.
  const { data: od, error: odErr } = await admin
    .from('organization_domains')
    .select('domains(slug)')
    .eq('organization_id', inv.organization_id)
    .eq('active', true)
    .limit(1)
    .maybeSingle()
  if (odErr) {
    console.error('[invitations/inscription] écosystème de l’organisation illisible', odErr.message)
    return json({ error: 'Could not read the invitation', code: 'invitation_lecture_indisponible' }, 503)
  }
  const dom = od ? (Array.isArray(od.domains) ? od.domains[0] : od.domains) : null
  const domainSlug = (dom as { slug?: string | null } | null)?.slug ?? ''

  const email = String(inv.email ?? '').trim().toLowerCase()
  const piece = nouvellePiece()
  const meta: Record<string, string> = {
    firstname: texte(body.firstname),
    lastname: texte(body.lastname),
    role: identite.signupRole,
    domain_slug: domainSlug,
    voie: 'invitation',
    piece,
    cgu_version: CGU_VERSION,
    invitation_id: inv.id,
    // Les statuts d'où l'on peut accepter : la MÊME constante que l'acceptation, signée.
    invitation_statuts: INVITATION_MODIFIABLE.join(','),
  }

  // ── La question à la base, AVANT de créer (statut, échéance, adresse, rôle) ─
  const verdict = await refusInscription(admin, email, meta)
  if (!verdict.ok) {
    return json({ error: 'Registration refused', code: verdict.code }, verdict.statut)
  }

  let signees: Record<string, string>
  try {
    signees = signerPreuveInscription(email, meta)
  } catch (err) {
    console.error('[invitations/inscription] preuve non signée', err instanceof Error ? err.message : String(err))
    return json({ error: 'Server misconfigured', code: INSCRIPTION_INDISPONIBLE }, 503)
  }

  const { data: cree, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { ...meta, ...signees },
  })
  if (createErr || !cree?.user) {
    const msg = (createErr?.message ?? '').toLowerCase()
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      return json({ error: 'Email already used', code: 'email_taken' }, 409)
    }
    console.error('[invitations/inscription] création refusée', createErr?.message)
    const nomme = await nommerLeRefus(admin, email, meta)
    return json({ error: 'Registration refused', code: nomme.code }, nomme.statut)
  }
  const userId = cree.user.id

  // L'écosystème de la trace d'audit : celui que la base a écrit sur le compte.
  const { data: compte, error: compteErr } = await admin.from('users').select('domain_id').eq('id', userId).maybeSingle()
  if (compteErr || !compte) {
    // Le compte EXISTE, membre (même transaction) : on ne le dit pas raté ; la trace manque, on le dit ici.
    console.error('[invitations/inscription] compte créé, trace d’audit non écrite', compteErr?.message ?? 'miroir illisible')
  } else {
    await logAudit({
      piece,
      supabaseAdmin: admin,
      user_id: userId,
      domain_id: compte.domain_id,
      action: 'org_invitation_accepted',
      entity_type: 'organization_invitations',
      entity_id: inv.id,
      detail: { organization_id: inv.organization_id, a_la_creation_du_compte: true },
    })
  }

  return json({ ok: true, organization_id: inv.organization_id }, 200)
}
