import { type SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/emails/resend'
import {
  renderMatchDigestEmail,
  renderNewCandidatureEmail,
  renderNewMessageEmail,
  type MatchDigestItem,
  type RenderedEmail,
} from '@/lib/emails/templates'
import { resolveEmailBrandName } from '@/lib/emails/brand'
import { renderMatchDigestSms, renderNewCandidatureSms } from '@/lib/sms/templates'
import { sendSms, smsSenderFrom } from '@/lib/sms/vonage'
import { expertSiteOrigin } from '@/lib/emails/domain-url'
import { signUnsubToken } from '@/lib/notification-unsub-token'
import { maskExpertNameForOrg } from '@/lib/expert-name-masking'
import { dashboardUrlForUserType } from '@/lib/auth-routing'
import {
  DISPATCHABLE_EVENT_TYPES,
  eventDef,
  type NotificationChannel,
  type NotificationEventType,
} from './catalog'
import { isChannelEnabled, loadDisabledPreferences, type DisabledSet } from './preferences'

/**
 * lib/notifications/dispatch.ts — envoi IMMÉDIAT (e-mail + SMS), N événements.
 *
 * GÉNÉRALISATION de l'ancien lib/notifications/dispatch-match.ts, qui ne
 * traitait qu'un type. Ce qui marchait est CONSERVÉ TEL QUEL :
 *
 *   - SOURCE DE VÉRITÉ = table `notifications` (jamais reconstruite d'ailleurs).
 *   - RÉCLAMATION ATOMIQUE avant envoi
 *     (UPDATE … WHERE <canal>_dispatch_at IS NULL … RETURNING) : un rejeu ne
 *     renvoie JAMAIS ce qui est déjà parti. C'est la garantie d'idempotence,
 *     elle n'a pas bougé d'une ligne.
 *   - BEST-EFFORT : ne jette jamais. Une panne Resend ou Vonage ne casse ni un
 *     message, ni une candidature, ni le matching.
 *   - Échec = DÉFINITIF (aucun cron pour reprendre) : `dispatch_at` reste posé
 *     donc rien ne repart, `attempts=1` pour la traçabilité.
 *   - Désabonnement tokenisé HMAC, désormais PAR ÉVÉNEMENT.
 *
 * CE QUI CHANGE :
 *   - le type filtré devient la liste du catalogue ;
 *   - les colonnes de marquage sont `email_dispatch_at` / `sms_dispatch_at`
 *     (renommées, données préservées — cf. migration 20260827000000) ;
 *   - le rendu passe par un RÉSOLVEUR par événement (plus bas), seul endroit
 *     spécialisé. La lecture des préférences, la réclamation, l'envoi et le
 *     marquage restent écrits UNE fois.
 *
 * VOLUME ASSUMÉ : `new_message` est en `per_item` — 10 allers-retours dans une
 * conversation = 10 e-mails. Aucun regroupement n'est possible sans job
 * planifié, ce que la contrainte interdit.
 */

const SCAN_LIMIT = 2000

const VALID_LOCALES = ['fr', 'en', 'es', 'de'] as const
function normalizeLocale(raw: string | null | undefined): string {
  return raw && (VALID_LOCALES as readonly string[]).includes(raw) ? raw : 'fr'
}

type PendingRow = {
  id: string
  user_id: string
  domain_id: string
  type: string
  entity_id: string | null
  created_at: string
  email_dispatch_at: string | null
  sms_dispatch_at: string | null
}

type UserRow = {
  id: string
  first_name: string | null
  email: string | null
  locale: string | null
  user_type: string | null
  phone: string | null
  phone_verified: boolean
}

/** Contexte commun passé aux résolveurs. */
type ResolveCtx = {
  admin: SupabaseClient
  user: UserRow
  locale: string
  /** Nom de la plateforme (domain.name) — jamais figé. */
  platform: string
  /** Origine absolue du site pour ce destinataire. */
  base: string
  brandName: string
  unsubscribeUrl: string
  rows: PendingRow[]
}

// ─────────────────────────────────────────────────────────────────────────────
// POINT D'ENTRÉE
// ─────────────────────────────────────────────────────────────────────────────

export async function dispatchNotificationsForUsers(
  admin: SupabaseClient,
  userIds: string[],
  opts?: { events?: NotificationEventType[] },
): Promise<{ emails: number; sms: number }> {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)))
  if (uniqueUserIds.length === 0) return { emails: 0, sms: 0 }

  const types = (opts?.events ?? DISPATCHABLE_EVENT_TYPES) as readonly string[]
  const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const nowIso = new Date().toISOString()

  // 1. Notifications EN ATTENTE (au moins un canal) pour ces utilisateurs.
  const { data: pendingRaw, error: pendErr } = await admin
    .from('notifications')
    .select('id, user_id, domain_id, type, entity_id, created_at, email_dispatch_at, sms_dispatch_at')
    .in('type', types as string[])
    .in('user_id', uniqueUserIds)
    .or('email_dispatch_at.is.null,sms_dispatch_at.is.null')
    .order('created_at', { ascending: true })
    .limit(SCAN_LIMIT)
  if (pendErr) {
    console.error('[notifications/dispatch] pending query failed', pendErr.message)
    return { emails: 0, sms: 0 }
  }
  const pending = (pendingRaw ?? []) as PendingRow[]
  if (pending.length === 0) return { emails: 0, sms: 0 }

  // 2. Regroupement par (utilisateur, événement).
  const byUserEvent = new Map<string, PendingRow[]>()
  for (const r of pending) {
    const k = `${r.user_id}::${r.type}`
    const arr = byUserEvent.get(k) ?? []
    arr.push(r)
    byUserEvent.set(k, arr)
  }

  const ids = Array.from(new Set(pending.map((r) => r.user_id)))
  const [{ data: usersRaw }, { data: domainsRaw }, disabled] = await Promise.all([
    admin
      .from('users')
      .select('id, first_name, email, locale, user_type, phone, phone_verified')
      .in('id', ids),
    admin.from('domains').select('id, name, slug'),
    loadDisabledPreferences(admin, ids),
  ])
  const userById = new Map<string, UserRow>((usersRaw ?? []).map((u) => [u.id as string, u as UserRow]))
  const domainById = new Map<string, { name: string; slug: string }>(
    (domainsRaw ?? []).map((d) => [d.id as string, { name: d.name as string, slug: d.slug as string }]),
  )

  let emails = 0
  let sms = 0

  for (const [k, rows] of byUserEvent) {
    const [uid, eventType] = k.split('::')
    const def = eventDef(eventType)
    const user = userById.get(uid)
    if (!def || !user) continue

    const domain = domainById.get(rows[0].domain_id)
    const platform = domain?.name ?? 'Skilloria'
    const locale = normalizeLocale(user.locale)
    const base = expertSiteOrigin({ origin: siteOrigin, slug: domain?.slug ?? null })
    let brandName = platform
    try {
      brandName = await resolveEmailBrandName(admin, rows[0].domain_id)
    } catch {
      /* repli sur le nom de plateforme — jamais bloquant */
    }
    const ctx: ResolveCtx = {
      admin,
      user,
      locale,
      platform,
      base,
      brandName,
      unsubscribeUrl: `${base}/api/notifications/unsubscribe?token=${encodeURIComponent(
        signUnsubToken(uid, eventType),
      )}`,
      rows,
    }

    emails += await runChannel(admin, ctx, def.event, 'email', disabled, nowIso)
    sms += await runChannel(admin, ctx, def.event, 'sms', disabled, nowIso)
  }

  return { emails, sms }
}

// ─────────────────────────────────────────────────────────────────────────────
// BOUCLE PAR CANAL — écrite UNE fois pour tous les événements
// ─────────────────────────────────────────────────────────────────────────────

const COLUMN: Record<NotificationChannel, { dispatchAt: string; attempts: string }> = {
  email: { dispatchAt: 'email_dispatch_at', attempts: 'email_attempts' },
  sms: { dispatchAt: 'sms_dispatch_at', attempts: 'sms_attempts' },
}

async function runChannel(
  admin: SupabaseClient,
  ctx: ResolveCtx,
  event: NotificationEventType,
  channel: NotificationChannel,
  disabled: DisabledSet,
  nowIso: string,
): Promise<number> {
  const col = COLUMN[channel]
  const pendingIds = ctx.rows
    .filter((r) => (channel === 'email' ? r.email_dispatch_at : r.sms_dispatch_at) === null)
    .map((r) => r.id)
  if (pendingIds.length === 0) return 0

  // Canal indisponible : hors catalogue (ex. SMS sur un message), préférence
  // coupée, ou pré-requis manquant (e-mail absent / téléphone non vérifié).
  // On CLÔTURE sans envoyer — sinon ces lignes seraient re-balayées à vie.
  const uid = ctx.user.id
  const prefOn = isChannelEnabled(disabled, uid, event, channel)
  const canSend =
    channel === 'email'
      ? prefOn && !!ctx.user.email
      : prefOn && ctx.user.phone_verified === true && !!ctx.user.phone
  if (!canSend) {
    await closeWithoutSending(admin, pendingIds, col.dispatchAt, nowIso)
    return 0
  }

  // RÉCLAMATION ATOMIQUE — inchangée. Deux exécutions concurrentes ne peuvent
  // pas réclamer la même ligne : la seconde ne voit plus `IS NULL`.
  const { data: claimedRaw } = await admin
    .from('notifications')
    .update({ [col.dispatchAt]: nowIso })
    .in('id', pendingIds)
    .is(col.dispatchAt, null)
    .select('id, entity_id')
  const claimed = (claimedRaw ?? []) as Array<{ id: string; entity_id: string | null }>
  if (claimed.length === 0) return 0

  let sent = 0
  try {
    sent = await deliver(ctx, event, channel, claimed)
  } catch (err) {
    console.error('[notifications/dispatch] deliver threw', { event, channel, err })
  }

  if (sent === 0) {
    // Échec DÉFINITIF (aucun cron pour reprendre) : `dispatch_at` reste posé,
    // donc rien ne repart ; `attempts` documente la tentative.
    await admin
      .from('notifications')
      .update({ [col.attempts]: 1 })
      .in('id', claimed.map((c) => c.id))
  }
  return sent
}

async function closeWithoutSending(
  admin: SupabaseClient,
  ids: string[],
  dispatchAtCol: string,
  nowIso: string,
): Promise<void> {
  await admin
    .from('notifications')
    .update({ [dispatchAtCol]: nowIso })
    .in('id', ids)
    .is(dispatchAtCol, null)
}

// ─────────────────────────────────────────────────────────────────────────────
// RÉSOLVEURS — le SEUL endroit spécialisé par événement
// ─────────────────────────────────────────────────────────────────────────────

async function deliver(
  ctx: ResolveCtx,
  event: NotificationEventType,
  channel: NotificationChannel,
  claimed: Array<{ id: string; entity_id: string | null }>,
): Promise<number> {
  if (event === 'new_match_opportunity') return deliverMatch(ctx, channel, claimed)
  if (event === 'new_candidature_received') return deliverCandidature(ctx, channel, claimed)
  if (event === 'new_message') return deliverMessage(ctx, claimed)
  return 0
}

async function sendOne(rendered: RenderedEmail, to: string): Promise<boolean> {
  const res = await sendEmail({
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    preheader: rendered.preheader,
    tag: rendered.tag,
  })
  if (!res.ok) console.error('[notifications/dispatch] email failed (definitive)', { code: res.code })
  return res.ok
}

/** OPPORTUNITÉS — digest groupé. Comportement identique à l'existant. */
async function deliverMatch(
  ctx: ResolveCtx,
  channel: NotificationChannel,
  claimed: Array<{ id: string; entity_id: string | null }>,
): Promise<number> {
  const segment = ctx.user.user_type === 'expert_cdi' ? 'cdi' : 'freelance'
  const missionsUrl = `${ctx.base}/${ctx.locale}/dashboard/${segment}/missions`

  if (channel === 'sms') {
    const text = renderMatchDigestSms({
      locale: ctx.locale,
      count: claimed.length,
      platform: ctx.platform,
      link: missionsUrl,
    })
    const res = await sendSms({ to: ctx.user.phone!, text, from: smsSenderFrom(ctx.platform) })
    if (!res.ok) console.error('[notifications/dispatch] sms failed (definitive)', { code: res.code })
    return res.ok ? 1 : 0
  }

  const entityIds = claimed.map((c) => c.entity_id).filter(Boolean) as string[]
  if (entityIds.length === 0) return 0
  const [{ data: pubsRaw }, { data: profileRow }] = await Promise.all([
    ctx.admin.from('publications').select('id, title').in('id', entityIds),
    ctx.admin.from('profiles').select('id').eq('user_id', ctx.user.id).maybeSingle(),
  ])
  const titleById = new Map<string, string>(
    (pubsRaw ?? []).filter((p) => p.title).map((p) => [p.id as string, p.title as string]),
  )
  const profileId = (profileRow as { id: string } | null)?.id ?? null
  const scoreByPub = new Map<string, number>()
  if (profileId) {
    const { data: matchesRaw } = await ctx.admin
      .from('matches')
      .select('publication_id, score')
      .eq('profile_id', profileId)
      .in('publication_id', entityIds)
    for (const m of matchesRaw ?? []) scoreByPub.set(m.publication_id as string, Number(m.score))
  }

  const items: MatchDigestItem[] = []
  for (const c of claimed) {
    if (!c.entity_id) continue
    const title = titleById.get(c.entity_id)
    if (!title) continue
    items.push({ title, score: scoreByPub.get(c.entity_id) ?? 0 })
  }
  if (items.length === 0) return 0

  const rendered = renderMatchDigestEmail({
    locale: ctx.locale,
    brandName: ctx.brandName,
    firstName: ctx.user.first_name ?? '',
    platform: ctx.platform,
    items,
    missionsUrl,
    unsubscribeUrl: ctx.unsubscribeUrl,
  })
  return (await sendOne(rendered, ctx.user.email!)) ? 1 : 0
}

/**
 * CANDIDATURE REÇUE — un envoi par candidature.
 * `entity_id` = id de la candidature. AUCUNE donnée du candidat n'est lue :
 * on ne remonte que jusqu'au titre de l'annonce, écrit par l'organisation.
 */
async function deliverCandidature(
  ctx: ResolveCtx,
  channel: NotificationChannel,
  claimed: Array<{ id: string; entity_id: string | null }>,
): Promise<number> {
  const candIds = claimed.map((c) => c.entity_id).filter(Boolean) as string[]
  if (candIds.length === 0) return 0

  const { data: candsRaw } = await ctx.admin
    .from('candidatures')
    .select('id, publication_id, publications!inner(id, title)')
    .in('id', candIds)
  const pubByCand = new Map<string, { id: string; title: string }>()
  for (const c of (candsRaw ?? []) as Array<{ id: string; publications: unknown }>) {
    const p = (Array.isArray(c.publications) ? c.publications[0] : c.publications) as
      | { id: string; title: string | null }
      | null
    if (p?.title) pubByCand.set(c.id, { id: p.id, title: p.title })
  }

  let sent = 0
  for (const c of claimed) {
    const pub = c.entity_id ? pubByCand.get(c.entity_id) : null
    if (!pub) continue
    const url = `${ctx.base}/${ctx.locale}/dashboard/entreprise/annonces/${pub.id}/candidatures`

    if (channel === 'sms') {
      const text = renderNewCandidatureSms({ locale: ctx.locale, link: url })
      const res = await sendSms({ to: ctx.user.phone!, text, from: smsSenderFrom(ctx.platform) })
      if (res.ok) sent += 1
      else console.error('[notifications/dispatch] sms failed (definitive)', { code: res.code })
      continue
    }

    const rendered = renderNewCandidatureEmail({
      locale: ctx.locale,
      brandName: ctx.brandName,
      firstName: ctx.user.first_name ?? '',
      publicationTitle: pub.title,
      candidaturesUrl: url,
      unsubscribeUrl: ctx.unsubscribeUrl,
    })
    if (await sendOne(rendered, ctx.user.email!)) sent += 1
  }
  return sent
}

/**
 * NOUVEAU MESSAGE — un envoi par message, e-mail uniquement (cf. catalogue).
 * `entity_id` = id de la conversation.
 *
 * Le nom d'expéditeur est RÉ-RÉSOLU ici, avec le MÊME helper de masquage que
 * la messagerie (`maskExpertNameForOrg`) : si le destinataire est côté org,
 * l'expert n'apparaît jamais en clair. Aucune logique de masquage n'est
 * réécrite — on appelle la source unique.
 *
 * Le CONTENU du message n'est ni lu ni transmis.
 */
async function deliverMessage(
  ctx: ResolveCtx,
  claimed: Array<{ id: string; entity_id: string | null }>,
): Promise<number> {
  const convIds = claimed.map((c) => c.entity_id).filter(Boolean) as string[]
  if (convIds.length === 0) return 0

  const { data: convsRaw } = await ctx.admin
    .from('conversations')
    .select(
      'id, candidatures!inner(id, profile_id, ' +
        'profiles!inner(id, user_id, users!profiles_user_id_fkey(id, first_name, last_name, user_type, deletion_scheduled_at, anonymized_at)), ' +
        'publications!inner(id, organization_id, organizations(id, company_name)))',
    )
    .in('id', convIds)

  type ConvCtx = { expertUserId: string; expertName: string; orgName: string; expertUserType: string | null }
  const ctxByConv = new Map<string, ConvCtx>()
  for (const row of (convsRaw ?? []) as unknown as Array<{ id: string; candidatures: unknown }>) {
    const cand = (Array.isArray(row.candidatures) ? row.candidatures[0] : row.candidatures) as {
      profiles: unknown
      publications: unknown
    } | null
    if (!cand) continue
    const prof = (Array.isArray(cand.profiles) ? cand.profiles[0] : cand.profiles) as {
      user_id: string
      users: unknown
    } | null
    const expertUser = (Array.isArray(prof?.users) ? prof?.users[0] : prof?.users) as
      | {
          first_name: string | null
          last_name: string | null
          user_type: string | null
          deletion_scheduled_at?: string | null
          anonymized_at?: string | null
        }
      | null
    const pub = (Array.isArray(cand.publications) ? cand.publications[0] : cand.publications) as {
      organizations: unknown
    } | null
    const org = (Array.isArray(pub?.organizations) ? pub?.organizations[0] : pub?.organizations) as
      | { company_name: string | null }
      | null
    if (!prof || !expertUser) continue
    ctxByConv.set(row.id, {
      expertUserId: prof.user_id,
      // Masquage appliqué SYSTÉMATIQUEMENT : l'e-mail ne doit pas devenir le
      // canal qui dévoile ce que l'interface masque.
      expertName: maskExpertNameForOrg(expertUser.first_name, expertUser.last_name, expertUser),
      orgName: org?.company_name ?? ctx.platform,
      expertUserType: expertUser.user_type ?? null,
    })
  }

  let sent = 0
  for (const c of claimed) {
    const conv = c.entity_id ? ctxByConv.get(c.entity_id) : null
    if (!conv) continue
    // Le destinataire est-il l'expert de cette conversation, ou l'org ?
    const recipientIsExpert = conv.expertUserId === ctx.user.id
    const senderName = recipientIsExpert ? conv.orgName : conv.expertName
    const basePath = recipientIsExpert
      ? dashboardUrlForUserType(conv.expertUserType)
      : '/dashboard/entreprise'
    const url = `${ctx.base}/${ctx.locale}${basePath}/messages/${c.entity_id}`

    const rendered = renderNewMessageEmail({
      locale: ctx.locale,
      brandName: ctx.brandName,
      firstName: ctx.user.first_name ?? '',
      senderName,
      conversationUrl: url,
      unsubscribeUrl: ctx.unsubscribeUrl,
    })
    if (await sendOne(rendered, ctx.user.email!)) sent += 1
  }
  return sent
}
