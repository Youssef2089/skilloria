import { NextRequest, after } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'
import { generateInvitationToken, hashInvitationToken } from '@/lib/invitation-token'
import { renderInvitationEmail } from '@/lib/emails/templates'
import { resolveEmailBrandName } from '@/lib/emails/brand'
import { sendEmail } from '@/lib/emails/resend'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Actions sur une invitation (Lot B, B4). `[id]` = organization_invitations.id.
 *
 *  - PATCH { action: 'revoke' }  : status='revoked'.
 *  - PATCH { action: 'resend' }  : nouveau token (nouveau hash) + nouvelle
 *                                  expiration + renvoi de l'email (after()).
 *
 * Garde : ADMIN ACTIF de l'org ; invitation de la MÊME org ; encore 'pending'.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const VALID_LOCALES = ['fr', 'en', 'es', 'de'] as const
function normalizeLocale(raw: string | null | undefined): string {
  return raw && (VALID_LOCALES as readonly string[]).includes(raw) ? raw : 'fr'
}
function siteOriginFromRequest(request: NextRequest): string {
  const origin = request.headers.get('origin')
  if (origin && /^https?:\/\//.test(origin)) return origin
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
}
const ROLE_LABELS: Record<string, Record<string, string>> = {
  fr: { admin: 'Administrateur', editor: 'Éditeur', viewer: 'Lecteur' },
  en: { admin: 'Administrator', editor: 'Editor', viewer: 'Viewer' },
  es: { admin: 'Administrador', editor: 'Editor', viewer: 'Lector' },
  de: { admin: 'Administrator', editor: 'Bearbeiter', viewer: 'Leser' },
}

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params
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

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_body' }, 400)
  }
  const action = body.action
  if (action !== 'revoke' && action !== 'resend') {
    return json({ error: 'Invalid action', code: 'invalid_action' }, 400)
  }

  const admin = auth.supabaseAdmin
  const { data: inv, error } = await admin
    .from('organization_invitations')
    .select('id, organization_id, email, role_in_org, status, domain_validation_passed')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('[me/invitations/:id] lookup failed', error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!inv || inv.organization_id !== org.id) {
    return json({ error: 'Invitation not found', code: 'not_found' }, 404)
  }
  if (inv.status !== 'pending') {
    return json({ error: 'Invitation not pending', code: 'not_pending' }, 409)
  }

  // ── Révocation ──────────────────────────────────────────────────────────────
  if (action === 'revoke') {
    const { error: upErr } = await admin
      .from('organization_invitations')
      .update({ status: 'revoked', updated_at: new Date().toISOString() })
      .eq('id', inv.id)
    if (upErr) {
      console.error('[me/invitations/:id] revoke failed', upErr.message)
      return json({ error: 'Revoke failed', code: 'db_error' }, 500)
    }
    await logAudit({
      supabaseAdmin: admin,
      user_id: auth.user.id,
      domain_id: auth.domain.id,
      action: 'org_invitation_revoked',
      entity_type: 'organization_invitations',
      entity_id: inv.id as string,
      detail: { email: inv.email },
    })
    return json({ ok: true }, 200)
  }

  // ── Renvoi : nouveau token + nouvelle expiration + email ────────────────────
  const rawToken = generateInvitationToken()
  const tokenHash = hashInvitationToken(rawToken)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const { error: upErr } = await admin
    .from('organization_invitations')
    .update({ token: tokenHash, expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq('id', inv.id)
  if (upErr) {
    console.error('[me/invitations/:id] resend update failed', upErr.message)
    return json({ error: 'Resend failed', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: admin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'org_invitation_resent',
    entity_type: 'organization_invitations',
    entity_id: inv.id as string,
    detail: { email: inv.email },
  })

  const origin = siteOriginFromRequest(request)
  const [{ data: inviter }, { data: orgRow }] = await Promise.all([
    admin.from('users').select('locale').eq('id', auth.user.id).maybeSingle(),
    admin.from('organizations').select('company_name').eq('id', org.id).maybeSingle(),
  ])
  const locale = normalizeLocale((inviter?.locale as string | null) ?? null)
  const inviteUrl = `${origin}/${locale}/invitation/${rawToken}`
  const expiresLabel = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(expiresAt))
  const roleLabel = ROLE_LABELS[locale][inv.role_in_org as string] ?? (inv.role_in_org as string)
  const companyName = (orgRow?.company_name as string | null) ?? ''
  const email = inv.email as string
  const domainMismatch = inv.domain_validation_passed !== true

  after(async () => {
    try {
      // D3 : marque = domaine de l'org (= domaine de l'admin invitant).
      const brandName = await resolveEmailBrandName(auth.supabaseAdmin, auth.domain.id)
      const rendered = renderInvitationEmail({
        brandName, locale, companyName, roleLabel, inviteUrl, expiresLabel, domainMismatch,
      })
      const res = await sendEmail({
        to: email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        preheader: rendered.preheader,
        tag: rendered.tag,
      })
      console.log('[me/invitations/:id] resend email', { id: inv.id, ok: res.ok, code: res.ok ? null : res.code })
    } catch (err) {
      console.error('[me/invitations/:id] resend email threw', err)
    }
  })

  return json({ ok: true }, 200)
}
