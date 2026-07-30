import { NextRequest } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/emails/resend'
import { renderMatchDigestEmail, type MatchDigestItem } from '@/lib/emails/templates'
import { renderMatchDigestSms } from '@/lib/sms/templates'
import { sendSms, smsSenderFrom } from '@/lib/sms/vonage'
import { expertSiteOrigin } from '@/lib/emails/domain-url'
import { signUnsubToken } from '@/lib/notification-unsub-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Envois awaités DANS le handler (un cron tourne jusqu'à la réponse — pas de
// piège fire-and-forget ici, contrairement à une route user-facing).
export const maxDuration = 60

/**
 * GET /api/cron/dispatch-match-notifications — envoi EMAIL/SMS agrégé des
 * nouvelles opportunités correspondant au profil (décisions D1–D6, ajout A1).
 *
 * Déclenché toutes les 5 min par Vercel Cron. SOURCE DE VÉRITÉ = la table
 * `notifications` (type 'new_match_opportunity') RÉELLEMENT créée par le
 * matching (D4 : jamais construit depuis les matches). Suivi d'envoi PAR CANAL
 * (match_email_dispatch_at / match_sms_dispatch_at) :
 *
 *   1. Regroupe les notifications en attente par utilisateur.
 *   2. FENÊTRE 15 min déclenchée par le PREMIER match (D3) : on n'envoie un canal
 *      que si la plus ancienne notification EN ATTENTE de ce canal a > 15 min.
 *   3. RÉCLAMATION ATOMIQUE avant envoi (UPDATE … WHERE <canal>_dispatch_at IS
 *      NULL … RETURNING) → un rejeu / cron concurrent ne double jamais (D4).
 *   4. ÉCHEC d'envoi (A1) : on remet <canal>_dispatch_at à NULL et on incrémente
 *      <canal>_attempts → réessai au prochain passage. Au-delà de MAX_ATTEMPTS,
 *      on abandonne (dispatch_at reste posé) et on journalise l'échec.
 *   5. Préférences OFF, ou SMS sans téléphone vérifié (D5) : on « clôt » le canal
 *      (dispatch_at posé, aucun envoi) pour ne pas le rebalayer indéfiniment.
 *
 * Sécurité : CRON_SECRET (Bearer ou ?secret=). Un échec d'envoi ne bloque jamais
 * le matching ni la création de notification (découplé par le cron).
 */

const WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 3
const PENDING_LIMIT = 2000
const NOTIFICATION_TYPE = 'new_match_opportunity'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

function getAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Missing Supabase env')
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

const VALID_LOCALES = ['fr', 'en', 'es', 'de'] as const
function normalizeLocale(raw: string | null | undefined): string {
  return raw && (VALID_LOCALES as readonly string[]).includes(raw) ? raw : 'fr'
}

// Plage de silence SMS : 21h → 8h (heure locale). Seuils exclusifs/inclusifs :
// silence si heure >= 21 OU heure < 8 (donc 21:00–07:59), envoi de 08:00 à 20:59.
const SMS_QUIET_START_H = 21
const SMS_QUIET_END_H = 8

/**
 * Vrai si l'instant tombe dans la plage de silence SMS, évaluée sur le FUSEAU
 * PLATEFORME (Europe/Paris). Intl gère automatiquement l'heure d'été (CET/CEST).
 *
 * Choix du fuseau (A2) : WinOps est une société française, les experts sont
 * très majoritairement en France → Europe/Paris est le bon défaut aujourd'hui.
 * AFFINAGE FUTUR possible : déduire le fuseau de l'indicatif du numéro E.164
 * (users.phone) pour respecter l'heure locale réelle de chaque expert.
 */
function isSmsQuietHoursParis(nowMs: number): boolean {
  const hourStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(nowMs))
  const hour = parseInt(hourStr, 10)
  return hour >= SMS_QUIET_START_H || hour < SMS_QUIET_END_H
}

type PendingRow = {
  id: string
  user_id: string
  domain_id: string
  entity_id: string | null
  created_at: string
  match_email_dispatch_at: string | null
  match_email_attempts: number
  match_sms_dispatch_at: string | null
  match_sms_attempts: number
}

type UserRow = {
  id: string
  first_name: string | null
  email: string | null
  locale: string | null
  user_type: string | null
  phone: string | null
  phone_verified: boolean
  notify_match_email: boolean
  notify_match_sms: boolean
}

/**
 * Applique le résultat d'un envoi sur un canal : succès → on laisse dispatché ;
 * échec → réessai (dispatch_at=NULL, ++attempts) tant que attempts < MAX, sinon
 * abandon (dispatch_at reste posé, ++attempts, échec journalisé).
 */
async function applyOutcome(
  admin: SupabaseClient,
  channel: 'email' | 'sms',
  claimed: Array<{ id: string; attempts: number }>,
  ok: boolean,
): Promise<void> {
  const atField = channel === 'email' ? 'match_email_dispatch_at' : 'match_sms_dispatch_at'
  const attField = channel === 'email' ? 'match_email_attempts' : 'match_sms_attempts'
  if (ok) return // dispatch_at déjà posé par la réclamation → rien à faire.

  const retryIds = claimed.filter((c) => c.attempts + 1 < MAX_ATTEMPTS)
  const giveupIds = claimed.filter((c) => c.attempts + 1 >= MAX_ATTEMPTS)

  // Réessai : on relâche (dispatch_at=NULL) + incrément. Les attempts pouvant
  // différer d'une ligne à l'autre, on regroupe par valeur d'incrément.
  for (const c of retryIds) {
    await admin
      .from('notifications')
      .update({ [atField]: null, [attField]: c.attempts + 1 })
      .eq('id', c.id)
  }
  for (const c of giveupIds) {
    await admin
      .from('notifications')
      .update({ [attField]: c.attempts + 1 })
      .eq('id', c.id)
    console.error(`[dispatch] ${channel} give up after ${MAX_ATTEMPTS} attempts`, { id: c.id })
  }
}

async function handle(request: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[dispatch] CRON_SECRET missing')
    return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
  }
  const authHeader = request.headers.get('authorization') ?? ''
  const querySecret = request.nextUrl.searchParams.get('secret') ?? ''
  if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
    return json({ error: 'Unauthorized', code: 'unauthorized' }, 401)
  }

  let admin: SupabaseClient
  try {
    admin = getAdmin()
  } catch {
    return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
  }

  const now = Date.now()
  const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

  // 1. Notifications de match en attente sur AU MOINS un canal.
  const { data: pendingRaw, error: pendErr } = await admin
    .from('notifications')
    .select(
      'id, user_id, domain_id, entity_id, created_at, match_email_dispatch_at, match_email_attempts, match_sms_dispatch_at, match_sms_attempts',
    )
    .eq('type', NOTIFICATION_TYPE)
    .or('match_email_dispatch_at.is.null,match_sms_dispatch_at.is.null')
    .order('created_at', { ascending: true })
    .limit(PENDING_LIMIT)
  if (pendErr) {
    console.error('[dispatch] pending query failed', pendErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const pending = (pendingRaw ?? []) as PendingRow[]
  if (pending.length === 0) return json({ ok: true, users: 0, emails: 0, sms: 0 })

  // Regroupe par utilisateur.
  const byUser = new Map<string, PendingRow[]>()
  for (const r of pending) {
    const arr = byUser.get(r.user_id) ?? []
    arr.push(r)
    byUser.set(r.user_id, arr)
  }
  const userIds = Array.from(byUser.keys())
  const entityIds = Array.from(new Set(pending.map((r) => r.entity_id).filter(Boolean))) as string[]

  // 2. Charge users, domaines, profils, publications (titres), matches (scores).
  const [{ data: usersRaw }, { data: domainsRaw }, { data: profilesRaw }, { data: pubsRaw }] =
    await Promise.all([
      admin
        .from('users')
        .select('id, first_name, email, locale, user_type, phone, phone_verified, notify_match_email, notify_match_sms')
        .in('id', userIds),
      admin.from('domains').select('id, name, slug'),
      admin.from('profiles').select('id, user_id').in('user_id', userIds),
      entityIds.length
        ? admin.from('publications').select('id, title').in('id', entityIds)
        : Promise.resolve({ data: [] as Array<{ id: string; title: string | null }> }),
    ])

  const userById = new Map<string, UserRow>((usersRaw ?? []).map((u) => [u.id as string, u as UserRow]))
  const domainById = new Map<string, { name: string; slug: string }>(
    (domainsRaw ?? []).map((d) => [d.id as string, { name: d.name as string, slug: d.slug as string }]),
  )
  const profileByUser = new Map<string, string>(
    (profilesRaw ?? []).map((p) => [p.user_id as string, p.id as string]),
  )
  const titleById = new Map<string, string>(
    (pubsRaw ?? []).filter((p) => p.title).map((p) => [p.id as string, p.title as string]),
  )

  // Scores : matches (profile_id, publication_id) → score, pour les profils concernés.
  const profileIds = Array.from(new Set(Array.from(profileByUser.values())))
  const scoreByKey = new Map<string, number>()
  if (profileIds.length && entityIds.length) {
    const { data: matchesRaw } = await admin
      .from('matches')
      .select('profile_id, publication_id, score')
      .in('profile_id', profileIds)
      .in('publication_id', entityIds)
    for (const m of matchesRaw ?? []) {
      scoreByKey.set(`${m.profile_id as string}:${m.publication_id as string}`, Number(m.score))
    }
  }

  let emailsSent = 0
  let smsSent = 0
  const nowIso = new Date(now).toISOString()

  for (const uid of userIds) {
    const rows = byUser.get(uid)!
    const user = userById.get(uid)
    if (!user) continue
    const domain = domainById.get(rows[0].domain_id)
    const platform = domain?.name ?? 'Skilloria'
    const slug = domain?.slug ?? null
    const locale = normalizeLocale(user.locale)
    const segment = user.user_type === 'expert_cdi' ? 'cdi' : 'freelance'
    const base = expertSiteOrigin({ origin: siteOrigin, slug })
    const missionsUrl = `${base}/${locale}/dashboard/${segment}/missions`
    const profileId = profileByUser.get(uid) ?? null

    // ── CANAL EMAIL ────────────────────────────────────────────────────────
    const emailPending = rows.filter((r) => r.match_email_dispatch_at === null)
    if (emailPending.length > 0) {
      if (user.notify_match_email === false) {
        // Préférence OFF → clôture sans envoi (immédiat, pas d'attente).
        await admin
          .from('notifications')
          .update({ match_email_dispatch_at: nowIso })
          .in('id', emailPending.map((r) => r.id))
          .is('match_email_dispatch_at', null)
      } else {
        const oldest = Math.min(...emailPending.map((r) => new Date(r.created_at).getTime()))
        if (now - oldest >= WINDOW_MS) {
          // Réclamation atomique.
          const { data: claimedRaw } = await admin
            .from('notifications')
            .update({ match_email_dispatch_at: nowIso })
            .in('id', emailPending.map((r) => r.id))
            .is('match_email_dispatch_at', null)
            .select('id, entity_id, match_email_attempts')
          const claimed = (claimedRaw ?? []) as Array<{ id: string; entity_id: string | null; match_email_attempts: number }>
          if (claimed.length > 0) {
            const items: MatchDigestItem[] = []
            for (const c of claimed) {
              if (!c.entity_id) continue
              const title = titleById.get(c.entity_id)
              if (!title) continue
              const score = profileId ? scoreByKey.get(`${profileId}:${c.entity_id}`) ?? 0 : 0
              items.push({ title, score })
            }
            const claimedAtt = claimed.map((c) => ({ id: c.id, attempts: c.match_email_attempts }))
            if (items.length === 0 || !user.email) {
              // Rien d'affichable (publications supprimées) ou pas d'email : on
              // laisse clôturé (déjà réclamé) sans envoi.
              console.warn('[dispatch] email skipped', { uid, items: items.length, hasEmail: !!user.email })
            } else {
              const unsubscribeUrl = `${base}/api/notifications/unsubscribe?token=${encodeURIComponent(signUnsubToken(uid))}`
              const rendered = renderMatchDigestEmail({
                locale,
                firstName: user.first_name ?? '',
                platform,
                items,
                missionsUrl,
                unsubscribeUrl,
              })
              const sendRes = await sendEmail({
                to: user.email,
                subject: rendered.subject,
                html: rendered.html,
                text: rendered.text,
                preheader: rendered.preheader,
                tag: rendered.tag,
              })
              const ok = sendRes.ok
              if (ok) {
                emailsSent += 1
                console.log('[dispatch] email sent', { uid, count: items.length })
              } else {
                console.warn('[dispatch] email failed', { uid, code: sendRes.code })
              }
              await applyOutcome(admin, 'email', claimedAtt, ok)
            }
          }
        }
      }
    }

    // ── CANAL SMS ──────────────────────────────────────────────────────────
    const smsPending = rows.filter((r) => r.match_sms_dispatch_at === null)
    if (smsPending.length > 0) {
      const smsUnavailable = user.notify_match_sms === false || user.phone_verified !== true || !user.phone
      if (smsUnavailable) {
        // Préférence OFF, ou téléphone non vérifié (D5) → clôture sans envoi.
        await admin
          .from('notifications')
          .update({ match_sms_dispatch_at: nowIso })
          .in('id', smsPending.map((r) => r.id))
          .is('match_sms_dispatch_at', null)
      } else {
        const oldest = Math.min(...smsPending.map((r) => new Date(r.created_at).getTime()))
        // A2 — PLAGE DE SILENCE SMS (21h–8h Europe/Paris) : un SMS de nuit est
        // désagréable. On REPORTE (jamais on ne supprime) : la garde est ICI,
        // AVANT la réclamation → aucune ligne n'est réclamée, AUCUNE tentative
        // n'est consommée (c'est un report, pas un échec). Les lignes restent
        // en attente (match_sms_dispatch_at NULL, match_sms_attempts inchangé)
        // et seront reprises au prochain passage hors plage de silence, i.e. le
        // matin. L'email, lui, part sans restriction (traité plus haut).
        if (now - oldest >= WINDOW_MS && !isSmsQuietHoursParis(now)) {
          const { data: claimedRaw } = await admin
            .from('notifications')
            .update({ match_sms_dispatch_at: nowIso })
            .in('id', smsPending.map((r) => r.id))
            .is('match_sms_dispatch_at', null)
            .select('id, match_sms_attempts')
          const claimed = (claimedRaw ?? []) as Array<{ id: string; match_sms_attempts: number }>
          if (claimed.length > 0) {
            const claimedAtt = claimed.map((c) => ({ id: c.id, attempts: c.match_sms_attempts }))
            const text = renderMatchDigestSms({ locale, count: claimed.length, platform, link: missionsUrl })
            const sendRes = await sendSms({ to: user.phone!, text, from: smsSenderFrom(platform) })
            const ok = sendRes.ok
            if (ok) {
              smsSent += 1
              console.log('[dispatch] sms sent', { uid, count: claimed.length })
            } else {
              console.warn('[dispatch] sms failed', { uid, code: sendRes.code })
            }
            await applyOutcome(admin, 'sms', claimedAtt, ok)
          }
        }
      }
    }
  }

  return json({ ok: true, users: userIds.length, emails: emailsSent, sms: smsSent })
}

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request)
}
export async function POST(request: NextRequest): Promise<Response> {
  return handle(request)
}
