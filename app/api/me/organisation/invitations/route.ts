import { NextRequest, after } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'
import { isValidOrgRole, type OrgRole } from '@/lib/org-members'
import { generateInvitationToken, hashInvitationToken } from '@/lib/invitation-token'
import { renderInvitationEmail } from '@/lib/emails/templates'
import { resolveEmailBrandName } from '@/lib/emails/brand'
import { sendEmail } from '@/lib/emails/resend'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// L'email d'invitation part dans after() (après la réponse) : on laisse à la
// fonction le temps de l'envoi Resend post-réponse (piège Vercel fire-and-forget).
export const maxDuration = 30

/**
 * POST /api/me/organisation/invitations — inviter un membre (Lot B, B2).
 *
 * Garde : ADMIN ACTIF de l'org (auth.organization.role_in_org === 'admin', déjà
 * filtré status='active' par requireAuth). Écriture service-role (D2).
 *
 * Décisions appliquées :
 *  - D1 : token aléatoire fort, ENVOYÉ EN CLAIR par email, STOCKÉ HACHÉ (sha256).
 *  - D4 : email hors du domaine de l'org AUTORISÉ mais domain_validation_passed
 *         = false (signalé dans l'UI + un avertissement dans l'email).
 *  - Anti-doublon : une invitation 'pending' non expirée déjà présente pour
 *    (org, email) → 409 'already_invited' (l'UI proposera « renvoyer »). Email
 *    déjà membre ACTIF → 400 'already_member'.
 *  - Email via after() + maxDuration (pattern maison anti fire-and-forget).
 *  - logAudit 'org_member_invited'.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function isValidEmail(email: string): boolean {
  if (!email || email.length > 320) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

const VALID_LOCALES = ['fr', 'en', 'es', 'de'] as const
function normalizeLocale(raw: string | null | undefined): string {
  return raw && (VALID_LOCALES as readonly string[]).includes(raw) ? raw : 'fr'
}

/** Origin de base pour construire le lien d'invitation (même logique qu'admin). */
function siteOriginFromRequest(request: NextRequest): string {
  const origin = request.headers.get('origin')
  if (origin && /^https?:\/\//.test(origin)) return origin
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
}

/** Libellé humain d'un rôle, dans la locale de l'inviteur (pour l'email). */
const ROLE_LABELS: Record<string, Record<OrgRole, string>> = {
  fr: { admin: 'Administrateur', editor: 'Éditeur', viewer: 'Lecteur' },
  en: { admin: 'Administrator', editor: 'Editor', viewer: 'Viewer' },
  es: { admin: 'Administrador', editor: 'Editor', viewer: 'Lector' },
  de: { admin: 'Administrator', editor: 'Bearbeiter', viewer: 'Leser' },
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
  if (org.role_in_org !== 'admin') {
    return json({ error: 'Admin role required', code: 'not_org_admin' }, 403)
  }

  // ── Corps ───────────────────────────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_body' }, 400)
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const role = body.role_in_org
  if (!isValidEmail(email)) {
    return json({ error: 'Invalid email', code: 'invalid_email' }, 400)
  }
  if (!isValidOrgRole(role)) {
    return json({ error: 'Invalid role', code: 'invalid_role' }, 400)
  }

  const admin = auth.supabaseAdmin

  // ── Contexte org (domaine email, type, nom) ─────────────────────────────────
  const { data: orgRow, error: orgErr } = await admin
    .from('organizations')
    .select('id, company_name, email_domain, org_type')
    .eq('id', org.id)
    .maybeSingle()
  if (orgErr || !orgRow) {
    console.error('[me/invitations] org lookup failed', orgErr?.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  // ── Règle figée : on n'invite QU'UNE ADRESSE INEXISTANTE en base ────────────
  // Tout compte existant (quel qu'il soit) → REFUS, AVANT toute création et
  // AVANT tout envoi d'email. Justification : un compte entreprise est toujours
  // créé AVEC son organisation (register-org), donc déjà rattaché ; un expert
  // (ou un admin) ne peut pas rejoindre une organisation ; 1 compte = 1 org.
  const { data: existingUser } = await admin
    .from('users')
    .select('id, user_type')
    .ilike('email', email)
    .maybeSingle()
  if (existingUser) {
    const ut = (existingUser.user_type as string | null) ?? null
    if (ut === 'expert_freelance' || ut === 'expert_cdi') {
      return json({ error: 'Email belongs to an expert account', code: 'email_is_expert_account' }, 400)
    }
    if (ut === 'admin') {
      return json({ error: 'Email belongs to an admin account', code: 'email_is_admin_account' }, 400)
    }
    // Compte entreprise (client/cabinet). Membre actif de CETTE org → already_member,
    // sinon (autre org, ou compte entreprise flottant) → email_already_in_organization.
    const { data: thisOrgMember } = await admin
      .from('organization_members')
      .select('id')
      .eq('organization_id', org.id)
      .eq('user_id', existingUser.id)
      .eq('status', 'active')
      .maybeSingle()
    if (thisOrgMember) {
      return json({ error: 'Already a member', code: 'already_member' }, 400)
    }
    return json({ error: 'Email already in an organization', code: 'email_already_in_organization' }, 400)
  }
  // À ce stade, l'email n'existe PAS en base → email_already_exists = false.
  const emailAlreadyExists = false

  // ── Anti-doublon : invitation pending non expirée déjà présente ? ───────────
  const nowIso = new Date().toISOString()
  const { data: dupe } = await admin
    .from('organization_invitations')
    .select('id')
    .eq('organization_id', org.id)
    .ilike('email', email)
    .eq('status', 'pending')
    .gt('expires_at', nowIso)
    .maybeSingle()
  if (dupe) {
    return json({ error: 'Already invited', code: 'already_invited' }, 409)
  }

  // ── D4 : validation de domaine (informatif, ne bloque pas) ──────────────────
  const orgDomain = (orgRow.email_domain as string | null)?.trim().toLowerCase() || null
  const emailDomain = email.split('@')[1] ?? ''
  const domainValidationPassed = !!orgDomain && emailDomain === orgDomain

  // ── Création (token haché) ──────────────────────────────────────────────────
  const rawToken = generateInvitationToken()
  const tokenHash = hashInvitationToken(rawToken)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: inserted, error: insErr } = await admin
    .from('organization_invitations')
    .insert({
      organization_id: org.id,
      email,
      token: tokenHash,
      role_in_org: role,
      invited_by: auth.user.id,
      expires_at: expiresAt,
      status: 'pending',
      domain_validation_passed: domainValidationPassed,
      email_already_exists: emailAlreadyExists,
    })
    .select('id, email, role_in_org, status, expires_at, domain_validation_passed, email_already_exists, created_at')
    .maybeSingle()

  if (insErr || !inserted) {
    console.error('[me/invitations] insert failed', insErr?.message)
    return json({ error: 'Insert failed', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: admin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'org_member_invited',
    entity_type: 'organization_invitations',
    entity_id: inserted.id as string,
    detail: { email, role_in_org: role, domain_validation_passed: domainValidationPassed },
  })

  // ── Email (after() — locale = users.locale de l'inviteur) ───────────────────
  const origin = siteOriginFromRequest(request)
  const { data: inviter } = await admin
    .from('users')
    .select('locale')
    .eq('id', auth.user.id)
    .maybeSingle()
  const locale = normalizeLocale((inviter?.locale as string | null) ?? null)
  const inviteUrl = `${origin}/${locale}/invitation/${rawToken}`
  const expiresLabel = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(expiresAt))
  const roleLabel = ROLE_LABELS[locale][role]
  const companyName = (orgRow.company_name as string | null) ?? ''

  after(async () => {
    try {
      // D3 : marque = domaine de l'org (= domaine de l'admin invitant).
      const brandName = await resolveEmailBrandName(auth.supabaseAdmin, auth.domain.id)
      const rendered = renderInvitationEmail({
        brandName,
        locale,
        companyName,
        roleLabel,
        inviteUrl,
        expiresLabel,
        domainMismatch: !domainValidationPassed,
      })
      const res = await sendEmail({
        to: email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        preheader: rendered.preheader,
        tag: rendered.tag,
      })
      console.log('[me/invitations] email', { id: inserted.id, ok: res.ok, code: res.ok ? null : res.code })
    } catch (err) {
      console.error('[me/invitations] email threw', err)
    }
  })

  return json({ invitation: inserted }, 201)
}
