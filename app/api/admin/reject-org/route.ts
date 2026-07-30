import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { renderRejectEmail } from '@/lib/emails/templates'
import { resolveEmailBrandName } from '@/lib/emails/brand'
import { sendEmail } from '@/lib/emails/resend'
import { resolveLocale } from '@/lib/emails/locales'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/reject-org { organization_id, reason? }
 *
 * Décision admin : refuse une organisation en attente (B5).
 *
 * Flow identique à approve-org (cf. ce fichier pour les détails) avec :
 *   - verification_status='rejected'
 *   - review_reason posé (texte du motif, ou null si non fourni)
 *   - audit action='org_rejected'
 *   - email "refus" envoyé au contact (best-effort)
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type Body = { organization_id?: unknown; reason?: unknown; site_url?: unknown }

function siteOriginFromRequest(request: NextRequest, body: Body): string {
  if (typeof body.site_url === 'string' && /^https?:\/\/[^\s/]{1,200}$/.test(body.site_url)) {
    return body.site_url
  }
  const origin = request.headers.get('origin')
  if (origin && /^https?:\/\//.test(origin)) return origin
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const organization_id =
    typeof body.organization_id === 'string' ? body.organization_id.trim() : ''
  if (!organization_id || !/^[a-f0-9-]{36}$/i.test(organization_id)) {
    return json({ error: 'Invalid organization_id', code: 'invalid_id' }, 400)
  }

  // Motif optionnel — accepte string non vide, cap 1000 chars
  let reason: string | null = null
  if (typeof body.reason === 'string') {
    const trimmed = body.reason.trim()
    if (trimmed.length > 0) {
      reason = trimmed.slice(0, 1000)
    }
  }

  const { data: org, error: fetchErr } = await auth.supabaseAdmin
    .from('organizations')
    .select('id, company_name, verification_status')
    .eq('id', organization_id)
    .maybeSingle()
  if (fetchErr) {
    console.error('[admin:reject-org] org lookup failed', fetchErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!org) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }
  if (org.verification_status !== 'pending_admin_review') {
    return json(
      { error: 'Already processed', code: 'already_processed', current_status: org.verification_status },
      409,
    )
  }

  const nowIso = new Date().toISOString()
  const { error: updErr } = await auth.supabaseAdmin
    .from('organizations')
    .update({
      verification_status: 'rejected',
      // Invariant : is_verified === (verification_status === 'approved').
      // Reset défensif idempotent — au cas où un statut precedent aurait
      // mis is_verified à true (re-rejet, scénario de récupération admin).
      is_verified: false,
      verified_at: nowIso,
      verified_by: auth.user.id,
      review_reason: reason,
    })
    .eq('id', organization_id)
  if (updErr) {
    console.error('[admin:reject-org] update failed', updErr.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'org_rejected',
    entity_type: 'organization',
    entity_id: organization_id,
    detail: {
      company_name: org.company_name as string | null,
      has_reason: reason !== null,
    },
  })

  // ── Email (best-effort) ─────────────────────────────────────────────────
  const { data: memberRow } = await auth.supabaseAdmin
    .from('organization_members')
    .select('users(email, first_name, locale, domain_id)')
    .eq('organization_id', organization_id)
    .eq('role_in_org', 'admin')
    .eq('status', 'active')
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  const userRow = memberRow?.users
    ? Array.isArray(memberRow.users)
      ? memberRow.users[0]
      : memberRow.users
    : null
  const contactEmail = (userRow as { email?: string } | null)?.email ?? null
  const contactFirstName = ((userRow as { first_name?: string | null } | null)?.first_name ?? '').trim()
  const contactLocale = resolveLocale((userRow as { locale?: string | null } | null)?.locale ?? null)

  let emailResult: { ok: boolean; code?: string } = { ok: false, code: 'no_contact' }
  if (contactEmail) {
    const origin = siteOriginFromRequest(request, body)
    // Lien de contact = mailto vers l'adresse de support, ou page contact.
    // V1 : mailto:no-reply@skilloria.io (à raffiner quand on a une vraie
    // adresse support / page contact dédiée).
    const contactUrl =
      process.env.RESEND_FROM_EMAIL
        ? `mailto:${process.env.RESEND_FROM_EMAIL}`
        : `${origin}/${contactLocale}`
    // D3 : marque = domaine du DESTINATAIRE (contact org), pas de l'admin.
    const brandName = await resolveEmailBrandName(
      auth.supabaseAdmin,
      (userRow as { domain_id?: string | null } | null)?.domain_id ?? null,
    )
    const rendered = renderRejectEmail({
      brandName,
      locale: contactLocale,
      firstName: contactFirstName || (contactEmail.split('@')[0] ?? ''),
      companyName: (org.company_name as string | null) ?? '',
      reason,
      contactUrl,
    })
    emailResult = await sendEmail({
      to: contactEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      preheader: rendered.preheader,
      tag: rendered.tag,
    })
  }

  return json(
    {
      ok: true,
      organization_id,
      verification_status: 'rejected',
      verified_at: nowIso,
      review_reason: reason,
      email_sent: emailResult.ok,
      email_skip_code: emailResult.ok ? null : emailResult.code ?? null,
    },
    200,
  )
}
