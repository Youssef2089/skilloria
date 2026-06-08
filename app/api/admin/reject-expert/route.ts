import { NextRequest, after } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { dashboardUrlForUserType } from '@/lib/auth-routing'
import { renderExpertRejectEmail } from '@/lib/emails/templates'
import { sendEmail } from '@/lib/emails/resend'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Email de refus via `after()` après l'envoi de la response (jamais un void
// fire-and-forget — tué sur Vercel serverless).
export const maxDuration = 30

/**
 * POST /api/admin/reject-expert { profile_id, reason }
 *
 * Mirror /api/admin/reject-org. Décision admin = reject.
 * reason text obligatoire (max 2000 chars).
 * users.is_verified reste/devient false.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

type Body = { profile_id?: unknown; reason?: unknown; site_url?: unknown }

function siteOriginFromRequest(request: NextRequest, body: Body): string {
  if (typeof body.site_url === 'string' && /^https?:\/\/[^\s/]{1,200}$/.test(body.site_url)) {
    return body.site_url
  }
  const origin = request.headers.get('origin')
  if (origin && /^https?:\/\//.test(origin)) return origin
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
}

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

const VALID_LOCALES = ['fr', 'en', 'es', 'de'] as const
function normalizeLocale(raw: string | null | undefined): string {
  return raw && (VALID_LOCALES as readonly string[]).includes(raw) ? raw : 'fr'
}

const NOTIF_TITLE: Record<string, string> = {
  fr: 'Votre demande de vérification n\'a pas abouti',
  en: 'Your verification request was not approved',
  es: 'Tu solicitud de verificación no fue aprobada',
  de: 'Ihre Verifizierungsanfrage wurde nicht genehmigt',
}
function notifBody(locale: string, reason: string): string {
  if (locale === 'en') return `Reason: ${reason}\n\nYou can adjust your profile and submit again.`
  if (locale === 'es') return `Motivo: ${reason}\n\nPuedes ajustar tu perfil y volver a enviarlo.`
  if (locale === 'de') return `Grund: ${reason}\n\nSie können Ihr Profil anpassen und erneut einreichen.`
  return `Motif : ${reason}\n\nVous pouvez ajuster votre profil et soumettre à nouveau.`
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
    return json({ error: 'Invalid JSON', code: 'invalid_json' }, 400)
  }

  const profileId = typeof body.profile_id === 'string' ? body.profile_id.trim() : ''
  if (!profileId || !UUID_REGEX.test(profileId)) {
    return json({ error: 'Invalid profile_id', code: 'invalid_id' }, 400)
  }
  const reason = asString(body.reason)
  if (!reason) return json({ error: 'Reason required', code: 'reason_required' }, 400)
  if (reason.length > 2000) return json({ error: 'Reason too long', code: 'invalid_reason' }, 400)

  const { data: prof, error: fetchErr } = await auth.supabaseAdmin
    .from('profiles')
    .select('id, user_id, domain_id, verification_status, users!profiles_user_id_fkey(id, email, first_name, locale, user_type)')
    .eq('id', profileId)
    .maybeSingle()
  if (fetchErr) {
    console.error('[admin:reject-expert] fetch failed', fetchErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!prof) return json({ error: 'Not found', code: 'not_found' }, 404)
  type ExpertUser = { id: string; email: string | null; first_name: string | null; locale: string | null; user_type: string | null }
  const row = prof as unknown as {
    id: string
    user_id: string
    domain_id: string
    verification_status: string | null
    users: ExpertUser | ExpertUser[] | null
  }
  if (row.verification_status !== 'pending_admin_review') {
    return json(
      { error: 'Already processed', code: 'already_processed', current_status: row.verification_status },
      409,
    )
  }

  const nowIso = new Date().toISOString()
  const { error: updErr } = await auth.supabaseAdmin
    .from('profiles')
    .update({
      verification_status: 'rejected',
      verified_at: nowIso,
      verified_by: auth.user.id,
      review_reason: reason,
    })
    .eq('id', profileId)
  if (updErr) {
    console.error('[admin:reject-expert] update failed', updErr.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  // S'assurer que users.is_verified reste false
  const { error: uErr } = await auth.supabaseAdmin
    .from('users')
    .update({ is_verified: false })
    .eq('id', row.user_id)
  if (uErr) console.error('[admin:reject-expert] users.is_verified false failed', uErr.message)

  // Notif expert
  const u = Array.isArray(row.users) ? row.users[0] : row.users
  const locale = normalizeLocale(u?.locale ?? null)
  try {
    await auth.supabaseAdmin.from('notifications').insert({
      user_id: row.user_id,
      domain_id: row.domain_id,
      type: 'verification_result',
      channel: 'inapp',
      title: NOTIF_TITLE[locale] ?? NOTIF_TITLE.fr,
      body: notifBody(locale, reason),
      link_url: dashboardUrlForUserType(u?.user_type ?? null),
      status: 'pending',
      entity_id: null,
    })
  } catch (err) {
    console.error('[admin:reject-expert] notif insert threw', err)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'expert_rejected',
    entity_type: 'profile',
    entity_id: profileId,
    detail: { reason },
  })

  // ── Email de refus (Resend) via after() — locale = users.locale ──────────
  // En PLUS de la notif in-app déjà insérée. Awaité dans after() (best-effort,
  // jamais un void fire-and-forget tué par Vercel). Un échec n'altère pas la
  // décision déjà persistée.
  const siteOrigin = siteOriginFromRequest(request, body)
  after(async () => {
    try {
      const contactEmail = u?.email ?? null
      if (!contactEmail) {
        console.warn('[admin:reject-expert] no contact email — reject email skipped', { profileId })
        return
      }
      const contactUrl = process.env.RESEND_FROM_EMAIL
        ? `mailto:${process.env.RESEND_FROM_EMAIL}`
        : `${siteOrigin}/${locale}`
      const rendered = renderExpertRejectEmail({
        locale: u?.locale ?? null,
        firstName: (u?.first_name ?? '').trim() || (contactEmail.split('@')[0] ?? ''),
        reason,
        contactUrl,
      })
      const res = await sendEmail({
        to: contactEmail,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        preheader: rendered.preheader,
        tag: rendered.tag,
      })
      console.log('[admin:reject-expert] email', { profileId, ok: res.ok, code: res.ok ? null : res.code })
    } catch (err) {
      console.error('[admin:reject-expert] reject email threw (after)', err)
    }
  })

  return json(
    {
      ok: true,
      profile_id: profileId,
      verification_status: 'rejected',
      verified_at: nowIso,
      review_reason: reason,
    },
    200,
  )
}
