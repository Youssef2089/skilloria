import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { renderWelcomeEmail } from '@/lib/emails/templates'
import { sendEmail } from '@/lib/emails/resend'
import { resolveLocale } from '@/lib/emails/locales'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/approve-org { organization_id }
 *
 * Décision admin : valide une organisation en attente (B5).
 *
 * Flow :
 *   1. requireAdmin (garde per-route D2)
 *   2. Vérifier org existe ET status='pending_admin_review' (sinon 400/409)
 *   3. UPDATE organizations
 *      SET verification_status='approved',
 *          verified_at=now(),
 *          verified_by=<admin_id>     ← non-null = décision manuelle (convention D1)
 *   4. logAudit action='org_approved'
 *   5. Résoudre locale + email du contact (membre admin le plus ancien)
 *   6. sendEmail (best-effort, ne bloque jamais le 200 ok)
 *   7. Return 200 OK
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type Body = { organization_id?: unknown; site_url?: unknown }

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

  // ── Vérifier l'org + son statut ─────────────────────────────────────────
  const { data: org, error: fetchErr } = await auth.supabaseAdmin
    .from('organizations')
    .select('id, company_name, verification_status')
    .eq('id', organization_id)
    .maybeSingle()
  if (fetchErr) {
    console.error('[admin:approve-org] org lookup failed', fetchErr.message)
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

  // ── UPDATE organizations ───────────────────────────────────────────────
  const nowIso = new Date().toISOString()
  const { error: updErr } = await auth.supabaseAdmin
    .from('organizations')
    .update({
      verification_status: 'approved',
      verified_at: nowIso,
      verified_by: auth.user.id,
    })
    .eq('id', organization_id)
  if (updErr) {
    console.error('[admin:approve-org] update failed', updErr.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  // ── Audit log ───────────────────────────────────────────────────────────
  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'org_approved',
    entity_type: 'organization',
    entity_id: organization_id,
    detail: { company_name: org.company_name as string | null },
  })

  // ── Résoudre contact + envoi email (best-effort) ────────────────────────
  // Membre admin le plus ancien (D4) : locale + email + first_name.
  const { data: memberRow } = await auth.supabaseAdmin
    .from('organization_members')
    .select('users(email, first_name, locale)')
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
    const loginUrl = `${origin}/${contactLocale}/connexion`
    const rendered = renderWelcomeEmail({
      locale: contactLocale,
      firstName: contactFirstName || (contactEmail.split('@')[0] ?? ''),
      companyName: (org.company_name as string | null) ?? '',
      loginUrl,
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
      verification_status: 'approved',
      verified_at: nowIso,
      email_sent: emailResult.ok,
      email_skip_code: emailResult.ok ? null : emailResult.code ?? null,
    },
    200,
  )
}
