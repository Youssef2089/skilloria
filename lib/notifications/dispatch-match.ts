import { type SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/emails/resend'
import { renderMatchDigestEmail, type MatchDigestItem } from '@/lib/emails/templates'
import { resolveEmailBrandName } from '@/lib/emails/brand'
import { renderMatchDigestSms } from '@/lib/sms/templates'
import { sendSms, smsSenderFrom } from '@/lib/sms/vonage'
import { expertSiteOrigin } from '@/lib/emails/domain-url'
import { signUnsubToken } from '@/lib/notification-unsub-token'

/**
 * Envoi IMMÉDIAT (email + SMS) des notifications de match, groupé par expert.
 *
 * HISTORIQUE — cette logique vient du cron `dispatch-match-notifications`
 * (DÉPLACÉE, pas réécrite) : le plan Vercel Hobby n'autorise qu'un cron par
 * jour, on a donc abandonné le cron 5 min + le regroupement. Les envois partent
 * désormais à la création de la notification, depuis le reconcile du matching
 * (lib/matching/shared.ts), qui tourne déjà dans un `after()` chez ses 6
 * appelants (piège Vercel du void-promise déjà couvert en amont).
 *
 * CE QUI RESTE (vs cron) :
 *   - SOURCE DE VÉRITÉ = table `notifications` (jamais construit depuis matches).
 *   - RÉCLAMATION ATOMIQUE avant envoi (UPDATE … WHERE <canal>_dispatch_at IS
 *     NULL … RETURNING) → garde d'IDEMPOTENCE : un reconcile qui rejoue ne
 *     renvoie jamais un message déjà dépêché.
 *   - ANTI-RAFALE : un seul email + un seul SMS par utilisateur mentionnant les
 *     N missions (templates renderMatchDigest*).
 *   - Préférences (notify_match_email/sms) et SMS sans téléphone vérifié → canal
 *     clôturé sans envoi.
 *
 * CE QUI DISPARAÎT (envoi immédiat, plus de cron) :
 *   - fenêtre de regroupement 15 min ;
 *   - plage de silence SMS 21h–8h ;
 *   - retries (sans cron, aucune reprise) : un échec est LOGGÉ et définitif
 *     (dispatch_at reste posé → jamais renvoyé), attempts=1 pour la traçabilité.
 *
 * BEST-EFFORT : ne jette jamais. L'appelant (reconcile) l'enveloppe en plus dans
 * un try/catch — une panne Resend/Vonage ne casse jamais le matching.
 */

const NOTIFICATION_TYPE = 'new_match_opportunity'
const SCAN_LIMIT = 2000

const VALID_LOCALES = ['fr', 'en', 'es', 'de'] as const
function normalizeLocale(raw: string | null | undefined): string {
  return raw && (VALID_LOCALES as readonly string[]).includes(raw) ? raw : 'fr'
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
 * Dépêche les notifications de match EN ATTENTE des utilisateurs donnés.
 * Renvoie le nombre d'emails/SMS effectivement envoyés. Ne jette jamais.
 */
export async function dispatchMatchNotificationsForUsers(
  admin: SupabaseClient,
  userIds: string[],
): Promise<{ emails: number; sms: number }> {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)))
  if (uniqueUserIds.length === 0) return { emails: 0, sms: 0 }

  const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const nowIso = new Date().toISOString()

  // 1. Notifications de match EN ATTENTE (au moins un canal) pour ces users.
  const { data: pendingRaw, error: pendErr } = await admin
    .from('notifications')
    .select(
      'id, user_id, domain_id, entity_id, created_at, match_email_dispatch_at, match_email_attempts, match_sms_dispatch_at, match_sms_attempts',
    )
    .eq('type', NOTIFICATION_TYPE)
    .in('user_id', uniqueUserIds)
    .or('match_email_dispatch_at.is.null,match_sms_dispatch_at.is.null')
    .order('created_at', { ascending: true })
    .limit(SCAN_LIMIT)
  if (pendErr) {
    console.error('[dispatch-match] pending query failed', pendErr.message)
    return { emails: 0, sms: 0 }
  }
  const pending = (pendingRaw ?? []) as PendingRow[]
  if (pending.length === 0) return { emails: 0, sms: 0 }

  const byUser = new Map<string, PendingRow[]>()
  for (const r of pending) {
    const arr = byUser.get(r.user_id) ?? []
    arr.push(r)
    byUser.set(r.user_id, arr)
  }
  const ids = Array.from(byUser.keys())
  const entityIds = Array.from(new Set(pending.map((r) => r.entity_id).filter(Boolean))) as string[]

  // 2. Contexte : users, domaines, profils, titres de publications.
  const [{ data: usersRaw }, { data: domainsRaw }, { data: profilesRaw }, { data: pubsRaw }] =
    await Promise.all([
      admin
        .from('users')
        .select('id, first_name, email, locale, user_type, phone, phone_verified, notify_match_email, notify_match_sms')
        .in('id', ids),
      admin.from('domains').select('id, name, slug'),
      admin.from('profiles').select('id, user_id').in('user_id', ids),
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

  // Scores (matches) pour l'affichage dans le digest.
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

  for (const uid of ids) {
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

    // ── CANAL EMAIL ──────────────────────────────────────────────────────────
    const emailPending = rows.filter((r) => r.match_email_dispatch_at === null)
    if (emailPending.length > 0) {
      if (user.notify_match_email === false) {
        // Préférence OFF → clôture sans envoi.
        await admin
          .from('notifications')
          .update({ match_email_dispatch_at: nowIso })
          .in('id', emailPending.map((r) => r.id))
          .is('match_email_dispatch_at', null)
      } else {
        // Réclamation atomique (D4) — plus de fenêtre 15 min (D5).
        const { data: claimedRaw } = await admin
          .from('notifications')
          .update({ match_email_dispatch_at: nowIso })
          .in('id', emailPending.map((r) => r.id))
          .is('match_email_dispatch_at', null)
          .select('id, entity_id')
        const claimed = (claimedRaw ?? []) as Array<{ id: string; entity_id: string | null }>
        if (claimed.length > 0) {
          const items: MatchDigestItem[] = []
          for (const c of claimed) {
            if (!c.entity_id) continue
            const title = titleById.get(c.entity_id)
            if (!title) continue
            const score = profileId ? scoreByKey.get(`${profileId}:${c.entity_id}`) ?? 0 : 0
            items.push({ title, score })
          }
          if (items.length === 0 || !user.email) {
            console.warn('[dispatch-match] email skipped', { uid, items: items.length, hasEmail: !!user.email })
          } else {
            const unsubscribeUrl = `${base}/api/notifications/unsubscribe?token=${encodeURIComponent(signUnsubToken(uid))}`
            const brandName = await resolveEmailBrandName(admin, rows[0].domain_id)
            const rendered = renderMatchDigestEmail({
              locale,
              brandName,
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
            if (sendRes.ok) {
              emailsSent += 1
            } else {
              // D5 : échec DÉFINITIF (pas de retry). dispatch_at reste posé →
              // jamais renvoyé ; attempts=1 pour la traçabilité.
              console.error('[dispatch-match] email failed (definitive)', { uid, code: sendRes.code })
              await admin
                .from('notifications')
                .update({ match_email_attempts: 1 })
                .in('id', claimed.map((c) => c.id))
            }
          }
        }
      }
    }

    // ── CANAL SMS ────────────────────────────────────────────────────────────
    const smsPending = rows.filter((r) => r.match_sms_dispatch_at === null)
    if (smsPending.length > 0) {
      const smsUnavailable = user.notify_match_sms === false || user.phone_verified !== true || !user.phone
      if (smsUnavailable) {
        // Préférence OFF ou téléphone non vérifié → clôture sans envoi.
        await admin
          .from('notifications')
          .update({ match_sms_dispatch_at: nowIso })
          .in('id', smsPending.map((r) => r.id))
          .is('match_sms_dispatch_at', null)
      } else {
        // Réclamation atomique (D4) — plus de fenêtre ni de plage de silence (D5).
        const { data: claimedRaw } = await admin
          .from('notifications')
          .update({ match_sms_dispatch_at: nowIso })
          .in('id', smsPending.map((r) => r.id))
          .is('match_sms_dispatch_at', null)
          .select('id')
        const claimed = (claimedRaw ?? []) as Array<{ id: string }>
        if (claimed.length > 0) {
          const text = renderMatchDigestSms({ locale, count: claimed.length, platform, link: missionsUrl })
          const sendRes = await sendSms({ to: user.phone!, text, from: smsSenderFrom(platform) })
          if (sendRes.ok) {
            smsSent += 1
          } else {
            console.error('[dispatch-match] sms failed (definitive)', { uid, code: sendRes.code })
            await admin
              .from('notifications')
              .update({ match_sms_attempts: 1 })
              .in('id', claimed.map((c) => c.id))
          }
        }
      }
    }
  }

  return { emails: emailsSent, sms: smsSent }
}
