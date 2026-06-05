import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { dashboardUrlForUserType } from '@/lib/auth-routing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

type Body = { profile_id?: unknown; reason?: unknown }
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
    .select('id, user_id, domain_id, verification_status, users!profiles_user_id_fkey(id, locale, user_type)')
    .eq('id', profileId)
    .maybeSingle()
  if (fetchErr) {
    console.error('[admin:reject-expert] fetch failed', fetchErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!prof) return json({ error: 'Not found', code: 'not_found' }, 404)
  const row = prof as unknown as {
    id: string
    user_id: string
    domain_id: string
    verification_status: string | null
    users:
      | { id: string; locale: string | null; user_type: string | null }
      | { id: string; locale: string | null; user_type: string | null }[]
      | null
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
