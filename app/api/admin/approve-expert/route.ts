import { NextRequest, after } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { dashboardUrlForUserType } from '@/lib/auth-routing'
import { renderExpertWelcomeEmail } from '@/lib/emails/templates'
import { sendEmail } from '@/lib/emails/resend'
import { expertSiteOrigin } from '@/lib/emails/domain-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Matching IA via `after()` (~10-15s) après l'envoi de la response.
export const maxDuration = 60

/**
 * POST /api/admin/approve-expert { profile_id }
 *
 * Mirror /api/admin/approve-org. Décision admin = approve sur profil expert
 * en pending_admin_review.
 *
 * Flow :
 *   1. requireAdmin
 *   2. Vérifier profile existe ET verification_status='pending_admin_review'
 *   3. UPDATE profiles SET verification_status='approved', verified_at=now(),
 *      verified_by=admin_id, review_reason=NULL
 *   4. UPDATE users SET is_verified=true (flag agrégé UI)
 *   5. Notif expert (type 'verification_result', locale users.locale)
 *   6. Audit
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

type Body = { profile_id?: unknown; site_url?: unknown }

function siteOriginFromRequest(request: NextRequest, body: Body): string {
  if (typeof body.site_url === 'string' && /^https?:\/\/[^\s/]{1,200}$/.test(body.site_url)) {
    return body.site_url
  }
  const origin = request.headers.get('origin')
  if (origin && /^https?:\/\//.test(origin)) return origin
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
}

const VALID_LOCALES = ['fr', 'en', 'es', 'de'] as const
function normalizeLocale(raw: string | null | undefined): string {
  return raw && (VALID_LOCALES as readonly string[]).includes(raw) ? raw : 'fr'
}

const NOTIF_TITLE: Record<string, string> = {
  fr: 'Votre profil est vérifié ✓',
  en: 'Your profile is verified ✓',
  es: 'Tu perfil está verificado ✓',
  de: 'Ihr Profil ist verifiziert ✓',
}
const NOTIF_BODY: Record<string, string> = {
  fr: 'Votre profil est désormais visible des entreprises. Vous apparaissez dans les recommandations IA.',
  en: 'Your profile is now visible to companies. You will appear in AI recommendations.',
  es: 'Tu perfil es ahora visible para las empresas. Aparecerás en las recomendaciones IA.',
  de: 'Ihr Profil ist nun für Unternehmen sichtbar. Sie erscheinen in den KI-Empfehlungen.',
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

  // Vérifier le profile
  const { data: prof, error: fetchErr } = await auth.supabaseAdmin
    .from('profiles')
    .select('id, user_id, domain_id, verification_status, users!profiles_user_id_fkey(id, email, first_name, locale, user_type)')
    .eq('id', profileId)
    .maybeSingle()
  if (fetchErr) {
    console.error('[admin:approve-expert] fetch failed', fetchErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!prof) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }
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
      verification_status: 'approved',
      verified_at: nowIso,
      verified_by: auth.user.id,
      review_reason: null,
    })
    .eq('id', profileId)
  if (updErr) {
    console.error('[admin:approve-expert] update failed', updErr.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  // Flip users.is_verified (drapeau agrégé UI)
  const { error: uErr } = await auth.supabaseAdmin
    .from('users')
    .update({ is_verified: true })
    .eq('id', row.user_id)
  if (uErr) console.error('[admin:approve-expert] users.is_verified flip failed', uErr.message)

  // Notif expert (best-effort)
  const u = Array.isArray(row.users) ? row.users[0] : row.users
  const locale = normalizeLocale(u?.locale ?? null)
  try {
    await auth.supabaseAdmin.from('notifications').insert({
      user_id: row.user_id,
      domain_id: row.domain_id,
      type: 'verification_result',
      channel: 'inapp',
      title: NOTIF_TITLE[locale] ?? NOTIF_TITLE.fr,
      body: NOTIF_BODY[locale] ?? NOTIF_BODY.fr,
      link_url: dashboardUrlForUserType(u?.user_type ?? null),
      status: 'pending',
      entity_id: null,
    })
  } catch (err) {
    console.error('[admin:approve-expert] notif insert threw', err)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'expert_approved',
    entity_type: 'profile',
    entity_id: profileId,
    detail: {},
  })

  // Origin résolu dans le scope du handler (request lisible ici), capturé par
  // la closure after() pour construire le lien CTA de l'email.
  const siteOrigin = siteOriginFromRequest(request, body)

  // ── Travaux post-réponse — déclencheur EXPERT (post-approbation) ────────
  // Non-bloquant POUR L'ADMIN : exécution via `after()` après l'envoi de la
  // response. Un `void promise` serait tué par Vercel — `after()` garantit
  // l'exécution de bout en bout (cf. bug racine fire-and-forget). On y place
  // aussi l'envoi de l'email (awaité, best-effort) pour la même raison.
  after(async () => {
    // 1. Email de bienvenue (Resend) — locale = users.locale de l'expert.
    //    En PLUS de la notif in-app déjà insérée ci-dessus. Best-effort :
    //    awaité dans after(), un échec ne casse jamais la décision admin.
    try {
      const contactEmail = u?.email ?? null
      if (contactEmail) {
        // Base URL dérivée du domaine de l'EXPERT (slug), pas de l'origin admin.
        // Lookup best-effort hors chemin de décision ; échec → fallback origin.
        let expertSlug: string | null = null
        if (row.domain_id) {
          const { data: dom } = await auth.supabaseAdmin
            .from('domains')
            .select('slug')
            .eq('id', row.domain_id)
            .maybeSingle()
          expertSlug = (dom?.slug as string | null) ?? null
        }
        const baseOrigin = expertSiteOrigin({ origin: siteOrigin, slug: expertSlug })
        const loginUrl = `${baseOrigin}/${normalizeLocale(u?.locale ?? null)}/connexion`
        const rendered = renderExpertWelcomeEmail({
          locale: u?.locale ?? null,
          firstName: (u?.first_name ?? '').trim() || (contactEmail.split('@')[0] ?? ''),
          loginUrl,
        })
        const res = await sendEmail({
          to: contactEmail,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          preheader: rendered.preheader,
          tag: rendered.tag,
        })
        console.log('[admin:approve-expert] email', { profileId, ok: res.ok, code: res.ok ? null : res.code })
      } else {
        console.warn('[admin:approve-expert] no contact email — welcome email skipped', { profileId })
      }
    } catch (err) {
      console.error('[admin:approve-expert] welcome email threw (after)', err)
    }

    // 2. Matching réconcilié — direction EXPERT → publications publiées.
    try {
      const { runMatchingForExpert } = await import('@/lib/matching')
      const v = await runMatchingForExpert({
        supabaseAdmin: auth.supabaseAdmin,
        profileId,
        locale: u?.locale ?? 'fr',
      })
      console.log('[admin:approve-expert] matching done', {
        profileId,
        status: v.status,
        proposals: v.proposals.length,
      })
    } catch (err) {
      console.error('[admin:approve-expert] matching threw (after)', err)
    }
  })

  return json(
    {
      ok: true,
      profile_id: profileId,
      verification_status: 'approved',
      verified_at: nowIso,
    },
    200,
  )
}
