import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { requireReauth } from '@/lib/reauth-token'
import { logAudit } from '@/lib/audit'
import { checkRateLimit, extractClientIp } from '@/lib/rate-limit'
import { sendAdminInvitation } from '@/lib/admin/admin-invitation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/user-resend-invite — RENVOYER l'invitation d'un administrateur
 * qui ne s'est jamais connecté.
 *
 * Body   : { user_id }
 * Header : `x-reauth-token` obligatoire.
 *
 * ═══ POURQUOI CETTE ROUTE EXISTE ═══════════════════════════════════════════
 *   `create-admin` n'annule pas un compte valide quand le SMTP échoue : elle
 *   répond `invitation_sent: false`. Sans moyen de renvoyer, ce compte resterait
 *   créé et SANS ACCÈS — on aurait recréé un problème du jour zéro à chaque
 *   hoquet du serveur de mail. C'est le pendant obligatoire de ce choix, pas un
 *   confort.
 *
 * ═══ POURQUOI PAS `refuseAdminActionOnTarget` ICI ══════════════════════════
 *   La garde partagée interdit d'agir sur un AUTRE ADMINISTRATEUR — c'est
 *   exactement la cible de cette route. L'appliquer refuserait le seul cas
 *   qu'elle sert. Ce n'est pas un contournement : les deux gardes répondent à
 *   des questions différentes. Celle-là protège un administrateur d'une action
 *   SUBIE (suspension, purge, rétrogradation) ; ici, on n'agit pas SUR lui, on
 *   lui renvoie un lien vers SA propre boîte mail. Rien n'est révélé à
 *   l'appelant, aucun état du compte ne change.
 *
 *   La garde propre à cette route est une FENÊTRE ÉTROITE, et c'est elle qui
 *   fait la sécurité — la cible doit être :
 *     - `user_type = 'admin'`            : le seul cas que l'invitation sert ;
 *     - JAMAIS CONNECTÉE                 : établi sur `session_logs`, pas sur
 *       `last_login_at` (rétro-rempli avec created_at par la migration
 *       20260709000009 — il ne prouve rien). Un administrateur qui s'est déjà
 *       connecté n'a pas besoin de nous : « mot de passe oublié » lui suffit ;
 *     - ni anonymisée, ni en grâce       : on ne rouvre pas un compte qui s'en va.
 *
 *   Hors de cette fenêtre : refus explicite, avec un code lisible.
 *
 * ═══ RÉ-AUTHENTIFICATION QUAND MÊME ════════════════════════════════════════
 *   Elle n'est pas exigée par la nature de l'action (aucun état ne change) mais
 *   par ce qu'une session détournée pourrait en faire : déclencher des e-mails
 *   de réinitialisation légitimes vers les boîtes d'autres administrateurs —
 *   une nuisance, et un terrain d'hameçonnage. Le coût est un mot de passe
 *   retapé sur un chemin de secours ; le gain ferme le vecteur. Toutes les
 *   écritures de cet écran sont ré-authentifiées : celle-ci ne fait pas
 *   exception.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/** Seuil bas : un renvoi est un geste de secours, pas une boucle. */
const RATE_BUCKET = 'admin_resend_invite'
const RATE_WINDOW_SECONDS = 3600
const RATE_MAX = 10

export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const reauthFail = requireReauth(request, auth.user.id)
  if (reauthFail) return reauthFail

  const ip = extractClientIp(request) ?? 'unknown-ip'
  const allowed = await checkRateLimit(
    auth.supabaseAdmin, RATE_BUCKET, ip, RATE_WINDOW_SECONDS, RATE_MAX,
  )
  if (!allowed) {
    return json({ error: 'Too many attempts', code: 'rate_limited' }, 429)
  }

  let body: { user_id?: unknown }
  try {
    body = (await request.json()) as { user_id?: unknown }
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }
  const targetId = typeof body.user_id === 'string' ? body.user_id : ''
  if (!UUID_REGEX.test(targetId)) {
    return json({ error: 'user_id is required', code: 'invalid_body' }, 400)
  }

  const { data: target, error: targetErr } = await auth.supabaseAdmin
    .from('users')
    .select('id, email, user_type, locale, domain_id, deletion_scheduled_at, anonymized_at, domains(slug)')
    .eq('id', targetId)
    .maybeSingle()
  if (targetErr) {
    console.error('[admin:resend-invite] target lookup failed', targetErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!target) {
    return json({ error: 'Target user not found', code: 'target_not_found' }, 404)
  }

  // ── FENÊTRE ÉTROITE (cf. § POURQUOI PAS refuseAdminActionOnTarget) ───────
  if (target.user_type !== 'admin') {
    return json({ error: 'Target is not an administrator', code: 'target_not_admin' }, 409)
  }
  if (target.anonymized_at || target.deletion_scheduled_at) {
    return json({ error: 'Account is being deleted', code: 'account_leaving' }, 409)
  }
  // « Jamais connecté » ne se déduit PAS de last_login_at (rétro-rempli avec
  // created_at) : seule l'absence de ligne dans session_logs le prouve. Même
  // raisonnement que `has_ever_logged_in` dans /api/admin/get-user/[id].
  const { count: loginCount, error: logErr } = await auth.supabaseAdmin
    .from('session_logs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', targetId)
  if (logErr) {
    console.error('[admin:resend-invite] session_logs lookup failed', logErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if ((loginCount ?? 0) > 0) {
    return json({ error: 'Administrator already signed in once', code: 'already_signed_in' }, 409)
  }
  if (!target.email) {
    return json({ error: 'Target has no email', code: 'db_error' }, 500)
  }

  const rel = (target as { domains: unknown }).domains
  const domainSlug =
    ((Array.isArray(rel) ? rel[0] : rel) as { slug: string | null } | null)?.slug ?? null

  const origin =
    request.headers.get('origin') ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    request.nextUrl.origin
  const sent = await sendAdminInvitation({
    email: target.email,
    origin,
    domainSlug,
    locale: (target as { locale: string | null }).locale ?? 'fr',
  })

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.user.domain_id,
    action: 'admin_invite_resent',
    entity_type: 'user',
    entity_id: targetId,
    // Jamais l'adresse : `entity_id` suffit à désigner la cible.
    detail: { target_domain_id: target.domain_id, invitation_sent: sent },
    request,
  })

  if (!sent) {
    return json({ error: 'Invitation could not be sent', code: 'invitation_failed' }, 502)
  }
  return json({ ok: true }, 200)
}
