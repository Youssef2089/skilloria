import { NextRequest, after } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { dispatchNotificationsForUsers } from '@/lib/notifications/dispatch'
import {
  newMessageInappLabels,
  resolveNotificationLocale,
} from '@/lib/notifications/inapp-labels'
import { logAudit } from '@/lib/audit'
import { dashboardUrlForUserType } from '@/lib/auth-routing'
import { maskExpertNameForOrg, type ExpertAccountState } from '@/lib/expert-name-masking'
import { disclosurePolicyForCandidatureLifecycle } from '@/lib/expert-disclosure'
import { signAvatarUrl } from '@/lib/avatar'
import { isConversationExpired } from '@/lib/conversations/expiry'
import { deriveCandidatureLifecycle } from '@/lib/candidatures/lifecycle'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Nécessaire au `after()` du POST : sans plafond explicite, l'envoi d'e-mail
// lancé après la réponse n'a pas le temps de s'exécuter sur Vercel.
export const maxDuration = 60

/**
 * GET /api/conversations/[id]/messages — fil de messages côté participant.
 *
 *  Garde (service_role) :
 *    - requireAuth
 *    - participant_check : auth.uid() est soit l'expert (profile.user_id),
 *      soit un membre actif de candidature.publication.organization_id.
 *
 *  Side-effect : marque read_at = now() sur les messages REÇUS (sender_id !=
 *  auth.uid()) ET non lus (read_at IS NULL). C'est l'invariant "lu uniquement
 *  pour les messages reçus" (cf. précision Lot 3, point 2).
 *
 *  Lecture autorisée même si conv expirée (lecture seule post-expiry, D5).
 *
 * POST /api/conversations/[id]/messages — envoi.
 *
 *  Garde (service_role) :
 *    - participant_check
 *    - conversation.status = 'open' (refusée si 'closed'/'archived')
 *    - NON expirée (expires_at IS NULL OR expires_at > now())
 *
 *  Body : { content: string (1..5000) }
 *
 *  Effet :
 *    INSERT message + UPDATE conv.last_message_at + notif autre participant
 *    (type='new_message', locale destinataire, link → /messages/[id]).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const MAX_CONTENT_LEN = 5000

const NOTIF_TYPE = 'new_message'
const NOTIF_CHANNEL = 'inapp'
const NOTIF_STATUS = 'pending'
// Libellés de la cloche : plus de table `Record<locale, string>` en dur ici.
// Le vocabulaire de l'événement vit dans messages/*.json et se lit via
// lib/notifications/inapp-labels (partagé avec l'e-mail du même événement).
const normalizeLocale = resolveNotificationLocale

type ConvJoin = {
  id: string
  candidature_id: string
  status: string
  expires_at: string | null
  last_message_at: string | null
  candidatures: {
    id: string
    profile_id: string
    status: string
    publication_id: string
    domain_id: string
    unlocked_at: string | null
    profiles: {
      id: string
      user_id: string
      photo_url: string | null
      users: { id: string; first_name: string | null; last_name: string | null; locale: string | null; user_type: string | null }
        | { id: string; first_name: string | null; last_name: string | null; locale: string | null; user_type: string | null }[]
    } | { id: string; user_id: string; photo_url: string | null; users: unknown }[]
    publications: {
      id: string
      type: string
      title: string
      status: string | null
      published_at: string | null
      expires_at: string | null
      organization_id: string
      organizations: { id: string; company_name: string | null; logo_url: string | null }
        | { id: string; company_name: string | null; logo_url: string | null }[]
    } | { id: string; type: string; title: string; organization_id: string; organizations: unknown }[]
  } | { id: string; profile_id: string; status: string; publication_id: string; domain_id: string; unlocked_at: string | null; profiles: unknown; publications: unknown }[]
}

function pickRel<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

/** Alias local : la règle vit dans lib/conversations/expiry.ts (source unique). */
const isExpired = (expiresAt: string | null): boolean => isConversationExpired(expiresAt)

/**
 * Charge la conv + chaîne d'identité et vérifie que `userId` est participant.
 * Renvoie { ok: true, conv, role: 'expert'|'org', otherUserId, ... } ou
 * { ok: false, status, body } en cas d'échec.
 */
async function loadConvAsParticipant(
  supabaseAdmin: AuthContext['supabaseAdmin'],
  convId: string,
  userId: string,
  authOrgId: string | null,
): Promise<
  | {
      ok: true
      conv: ConvJoin
      role: 'expert' | 'org'
      otherUserId: string | null
      otherUserLocale: string
      /** user_type de l'EXPERT (jamais l'org) — utilisé pour router le lien
       *  de notif côté expert (parité freelance/cdi). */
      expertUserType: string | null
      candTitle: string
      senderFirstLast: string
    }
  | { ok: false; status: number; code: string }
> {
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select(
      'id, candidature_id, status, expires_at, last_message_at, ' +
        // Lot grille photo-forward : `photo_url` RE-INTRODUIT au SELECT.
        // Servi côté ORG post-unlock uniquement (cf. correspondant=expert
        // → DisclosurePolicy reveal_photo: true). Email/phone toujours hors
        // périmètre (reveal_contact: false en V1).
        // `unlocked_at` (candidature) + `status`/`published_at`/`expires_at`
        // (publication) : entrées de la dérivation d'état de vie
        // (lib/candidatures/lifecycle.ts). Mêmes colonnes que /api/me/conversations
        // — c'est ce qui garantit que le bandeau de CETTE vue et le bucket de
        // l'inbox ne peuvent pas diverger.
        'candidatures!inner(id, profile_id, status, publication_id, domain_id, unlocked_at, ' +
          'profiles!inner(id, user_id, photo_url, users!profiles_user_id_fkey(id, first_name, last_name, locale, user_type, deletion_scheduled_at, anonymized_at)), ' +
          'publications!inner(id, type, title, status, published_at, expires_at, organization_id, organizations(id, company_name, logo_url)))',
    )
    .eq('id', convId)
    .maybeSingle()

  if (error) {
    console.error('[conversations/[id]/messages] conv lookup failed', error.message)
    return { ok: false, status: 500, code: 'db_error' }
  }
  if (!data) return { ok: false, status: 404, code: 'not_found' }
  const conv = data as unknown as ConvJoin
  const cand = pickRel(conv.candidatures) as {
    id: string; profile_id: string; status: string; publication_id: string; domain_id: string
    profiles: unknown; publications: unknown
  } | null
  if (!cand) return { ok: false, status: 404, code: 'not_found' }
  // Sécurité : la conv n'est lisible que si la candidature ouvre bien un
  // échange. 'selected' est INCLUS (cohérence lot état de vie) : une
  // candidature retenue garde sa conversation pour caler date/contrat — les
  // DTO servent déjà son `conversation_id` et l'inbox la liste désormais.
  // Sans ça, « Ouvrir la conversation » sur une mission remportée renvoyait
  // 404. Le droit d'ÉCRIRE reste gardé séparément par l'expiration du fil.
  if (cand.status !== 'unlocked' && cand.status !== 'selected') {
    return { ok: false, status: 404, code: 'not_found' }
  }

  const profile = pickRel(cand.profiles as { id: string; user_id: string; photo_url: string | null; users: unknown } | { id: string; user_id: string; photo_url: string | null; users: unknown }[] | null)
  const pub = pickRel(cand.publications as { id: string; type: string; title: string; organization_id: string; organizations: unknown } | { id: string; type: string; title: string; organization_id: string; organizations: unknown }[] | null)
  if (!profile || !pub) return { ok: false, status: 404, code: 'not_found' }
  const expertUser = pickRel(profile.users as { id: string; first_name: string | null; last_name: string | null; locale: string | null; user_type: string | null } | { id: string; first_name: string | null; last_name: string | null; locale: string | null; user_type: string | null }[] | null)

  // ── Participant check ──────────────────────────────────────────────────
  const isExpert = profile.user_id === userId
  let isOrg = false
  if (!isExpert && authOrgId === pub.organization_id) isOrg = true
  if (!isExpert && !isOrg) {
    // Vérifie tout de même en BDD que userId est bien membre actif (cas auth.org
    // pas chargée mais user effectivement membre — défensif)
    const { data: member } = await supabaseAdmin
      .from('organization_members')
      .select('user_id')
      .eq('user_id', userId)
      .eq('organization_id', pub.organization_id)
      .eq('status', 'active')
      .maybeSingle()
    if (member) isOrg = true
  }
  if (!isExpert && !isOrg) return { ok: false, status: 404, code: 'not_found' }

  const role: 'expert' | 'org' = isExpert ? 'expert' : 'org'

  // ── Charger l'autre participant pour notif ─────────────────────────────
  let otherUserId: string | null = null
  let otherUserLocale = 'fr'
  if (role === 'expert') {
    // L'autre = l'org (1 admin/membre actif — on prend le 1er actif par joined_at)
    const { data: orgMember } = await supabaseAdmin
      .from('organization_members')
      .select('user_id, users!organization_members_user_id_fkey(id, locale)')
      .eq('organization_id', pub.organization_id)
      .eq('status', 'active')
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    const om = orgMember as { user_id: string; users: { id: string; locale: string | null } | { id: string; locale: string | null }[] } | null
    if (om) {
      otherUserId = om.user_id
      const ou = Array.isArray(om.users) ? om.users[0] : om.users
      otherUserLocale = normalizeLocale(ou?.locale ?? null)
    }
  } else {
    otherUserId = profile.user_id
    otherUserLocale = normalizeLocale(expertUser?.locale ?? null)
  }

  // ── Identité de l'émetteur (pour body notif) ──────────────────────────
  // Lot masquage : si l'émetteur est l'expert, on persiste le NOM MASQUÉ
  // dans la notif → l'org ne verra "Youssef F" dans son centre de notifs,
  // pas le nom complet. Notifs déjà persistées (pré-lot) restent telles
  // quelles — décision séparée pour un éventuel backfill.
  let senderFirstLast = ''
  if (role === 'expert') {
    senderFirstLast = maskExpertNameForOrg(
      expertUser?.first_name ?? null,
      expertUser?.last_name ?? null,
      (expertUser ?? undefined) as ExpertAccountState | undefined,
    )
  } else {
    const orgRaw = pickRel(pub.organizations as { id: string; company_name: string | null; logo_url: string | null } | { id: string; company_name: string | null; logo_url: string | null }[] | null)
    senderFirstLast = orgRaw?.company_name?.trim() || 'L\'entreprise'
  }

  return {
    ok: true,
    conv,
    role,
    otherUserId,
    otherUserLocale,
    expertUserType: expertUser?.user_type ?? null,
    candTitle: pub.title,
    senderFirstLast,
  }
}

type RouteContext = { params: Promise<{ id: string }> }

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, ctx: RouteContext): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { id: convId } = await ctx.params
  if (!convId || !UUID_REGEX.test(convId)) {
    return json({ error: 'Invalid id', code: 'invalid_id' }, 400)
  }

  const loaded = await loadConvAsParticipant(auth.supabaseAdmin, convId, auth.user.id, auth.organization?.id ?? null)
  if (!loaded.ok) return json({ error: loaded.code, code: loaded.code }, loaded.status)
  const { conv, role } = loaded

  const cand = pickRel(conv.candidatures) as { id: string; profile_id: string; status: string; publication_id: string; unlocked_at: string | null; profiles: unknown; publications: unknown }
  const profile = pickRel(cand.profiles as { id: string; user_id: string; photo_url: string | null; users: unknown } | { id: string; user_id: string; photo_url: string | null; users: unknown }[] | null)
  const expertUser = pickRel(profile?.users as { id: string; first_name: string | null; last_name: string | null; locale: string | null } | { id: string; first_name: string | null; last_name: string | null; locale: string | null }[] | null)
  const pub = pickRel(cand.publications as { id: string; type: string; title: string; status: string | null; published_at: string | null; expires_at: string | null; organization_id: string; organizations: unknown } | { id: string; type: string; title: string; status: string | null; published_at: string | null; expires_at: string | null; organization_id: string; organizations: unknown }[] | null)
  const orgRaw = pickRel(pub?.organizations as { id: string; company_name: string | null; logo_url: string | null } | { id: string; company_name: string | null; logo_url: string | null }[] | null)

  // ── ÉTAT DE VIE dérivé SERVEUR ─────────────────────────────────────────
  //  Même helper, mêmes entrées que /api/me/conversations : le bandeau de
  //  cette vue ne peut donc pas annoncer « archivé » sur un fil que l'inbox
  //  range dans Actives, ni l'inverse. Le client ne recalcule rien : il reçoit
  //  le bucket et se contente de choisir la phrase.
  const lifecycle = deriveCandidatureLifecycle({
    status: cand.status,
    unlocked_at: cand.unlocked_at,
    publication: pub
      ? { status: pub.status, published_at: pub.published_at, expires_at: pub.expires_at }
      : null,
    conversation: { expires_at: conv.expires_at },
  })

  // ── Charger les messages ────────────────────────────────────────────────
  const { data: msgs, error: mErr } = await auth.supabaseAdmin
    .from('messages')
    .select('id, conversation_id, sender_id, content, read_at, created_at')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: true })
    .limit(500)
  if (mErr) {
    console.error('[conversations/[id]/messages:GET] msgs failed', mErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const messages = (msgs ?? []) as { id: string; conversation_id: string; sender_id: string; content: string; read_at: string | null; created_at: string }[]

  // ── Flip read_at uniquement sur les messages REÇUS et non lus ──────────
  //  (cf. précision Lot 3, point 2 : jamais sur ses propres messages)
  const nowIso = new Date().toISOString()
  const toMarkIds = messages.filter((m) => m.sender_id !== auth.user.id && m.read_at === null).map((m) => m.id)
  if (toMarkIds.length > 0) {
    const { error: updErr } = await auth.supabaseAdmin
      .from('messages')
      .update({ read_at: nowIso })
      .in('id', toMarkIds)
    if (updErr) {
      console.error('[conversations/[id]/messages:GET] read flip failed', updErr.message)
    } else {
      // Reflète localement pour la réponse
      for (const m of messages) {
        if (toMarkIds.includes(m.id)) m.read_at = nowIso
      }
    }
  }

  // ── Correspondant (identité MUTUELLE tant que l'échange est vivant) ────
  // L'user courant est l'ORG → le correspondant est l'expert. La divulgation
  // passe par la MÊME fonction que les candidatures et l'inbox, sur l'ÉTAT DE
  // VIE dérivé ci-dessus : dès que le fil est archivé (fenêtre 15 j close,
  // annonce expirée ou retirée, refus), nom et photo se referment. Le CORPS
  // des messages reste tel quel — on ne réécrit pas un historique.
  // Email/phone restent hors périmètre (reveal_contact: false en V1).
  // L'expert (role==='expert') voit l'org normalement (company_name + logo).
  const correspondant = role === 'expert'
    ? {
        kind: 'org' as const,
        name: orgRaw?.company_name ?? null,
        avatar_url: orgRaw?.logo_url ?? null,
      }
    : await (async () => {
        const policy = disclosurePolicyForCandidatureLifecycle({
          candidatureStatus: cand.status,
          lifecycleBucket: lifecycle.bucket,
        })
        const fn = expertUser?.first_name ?? null
        const ln = expertUser?.last_name ?? null
        const fullName = [fn, ln].filter(Boolean).join(' ').trim()
        // Mission S3 : expert en grâce/purge → placeholder prioritaire.
        const accountState = (expertUser ?? undefined) as ExpertAccountState | undefined
        const inDeletion = !!(accountState?.deletion_scheduled_at || accountState?.anonymized_at)
        return {
          kind: 'expert' as const,
          name: inDeletion
            ? maskExpertNameForOrg(fn, ln, accountState)
            : policy.reveal_full_name && fullName
              ? fullName
              : maskExpertNameForOrg(fn, ln),
          // M3 : URL signée (300s). CONDITION inchangée (reveal_photo + photo présente),
          // seule la VALEUR passe en signée (avant : profile.photo_url public).
          avatar_url:
            inDeletion || !policy.reveal_photo || !profile?.photo_url
              ? null
              : await signAvatarUrl(auth.supabaseAdmin, profile.user_id),
        }
      })()

  return json(
    {
      conversation: {
        id: conv.id,
        candidature_id: conv.candidature_id,
        status: conv.status,
        last_message_at: conv.last_message_at,
        expires_at: conv.expires_at,
        is_expired: isExpired(conv.expires_at),
      },
      lifecycle,
      publication: pub ? { id: pub.id, type: pub.type, title: pub.title } : null,
      correspondant,
      me: { user_id: auth.user.id, role },
      messages: messages.map((m) => ({
        id: m.id,
        sender_id: m.sender_id,
        sender_is_me: m.sender_id === auth.user.id,
        content: m.content,
        read_at: m.read_at,
        created_at: m.created_at,
      })),
    },
    200,
  )
}

// ─── POST ──────────────────────────────────────────────────────────────────

type PostBody = { content?: unknown }

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

export async function POST(request: NextRequest, ctx: RouteContext): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { id: convId } = await ctx.params
  if (!convId || !UUID_REGEX.test(convId)) {
    return json({ error: 'Invalid id', code: 'invalid_id' }, 400)
  }

  let body: PostBody
  try {
    body = (await request.json()) as PostBody
  } catch {
    return json({ error: 'Invalid JSON', code: 'invalid_json' }, 400)
  }
  const content = asString(body.content)
  if (!content) return json({ error: 'Empty content', code: 'invalid_content' }, 400)
  if (content.length > MAX_CONTENT_LEN) return json({ error: 'Content too long', code: 'invalid_content' }, 400)

  const loaded = await loadConvAsParticipant(auth.supabaseAdmin, convId, auth.user.id, auth.organization?.id ?? null)
  if (!loaded.ok) return json({ error: loaded.code, code: loaded.code }, loaded.status)
  const { conv, otherUserId, otherUserLocale, expertUserType, candTitle, senderFirstLast, role } = loaded

  // ── Garde envoi : non expirée + status 'open' ──────────────────────────
  if (isExpired(conv.expires_at)) {
    return json({ error: 'Conversation expired', code: 'expired' }, 409)
  }
  if (conv.status !== 'open') {
    return json({ error: 'Conversation closed', code: 'closed' }, 409)
  }

  const cand = pickRel(conv.candidatures) as { id: string; domain_id: string } | null
  if (!cand) return json({ error: 'Not found', code: 'not_found' }, 404)

  // ── INSERT message ─────────────────────────────────────────────────────
  const { data: inserted, error: insErr } = await auth.supabaseAdmin
    .from('messages')
    .insert({
      conversation_id: convId,
      sender_id: auth.user.id,
      domain_id: cand.domain_id,
      content,
    })
    .select('id, sender_id, content, read_at, created_at')
    .single()
  if (insErr || !inserted) {
    console.error('[conversations/[id]/messages:POST] insert failed', insErr?.message)
    return json({ error: 'Insert failed', code: 'db_error' }, 500)
  }
  const msgRow = inserted as { id: string; sender_id: string; content: string; read_at: string | null; created_at: string }

  // ── UPDATE conv.last_message_at (best-effort) ──────────────────────────
  const { error: updErr } = await auth.supabaseAdmin
    .from('conversations')
    .update({ last_message_at: msgRow.created_at })
    .eq('id', convId)
  if (updErr) console.error('[conversations/[id]/messages:POST] last_message_at update failed', updErr.message)

  // ── Notif autre participant (best-effort) ──────────────────────────────
  if (otherUserId) {
    // Parité CDI : si le destinataire est l'expert (role==='org' = expéditeur
    // org → destinataire expert), router le lien selon le user_type de
    // l'expert (expert_cdi → /dashboard/cdi, sinon /dashboard/freelance).
    const link = role === 'expert'
      ? `/dashboard/entreprise/messages/${convId}`
      : `${dashboardUrlForUserType(expertUserType)}/messages/${convId}`
    // Libellés de la cloche : i18n partagée avec l'e-mail du même événement.
    // Ils vivaient en dur ici (NOTIF_TITLE / notifBody) — deux vocabulaires
    // pour un seul événement auraient divergé dès la première reformulation.
    const inapp = newMessageInappLabels(otherUserLocale, senderFirstLast, content)
    const { error: notifErr } = await auth.supabaseAdmin.from('notifications').insert({
      user_id: otherUserId,
      domain_id: cand.domain_id,
      type: NOTIF_TYPE,
      channel: NOTIF_CHANNEL,
      title: inapp.title,
      body: inapp.body,
      link_url: link,
      status: NOTIF_STATUS,
      entity_id: convId,
    })
    if (notifErr) {
      console.error('[conversations/[id]/messages:POST] notif insert failed', notifErr.message)
    } else {
      // ⚠️ PIÈGE VERCEL : sans `after()`, tout travail lancé APRÈS la réponse
      // est TUÉ, silencieusement — l'e-mail ne partirait jamais et aucune
      // erreur n'apparaîtrait nulle part. `after()` + `maxDuration` (en tête
      // de fichier) sont la seule façon correcte de faire ça ici.
      // Best-effort : le dispatcher ne jette jamais, et le try/catch isole
      // une panne Resend de l'envoi du message lui-même, déjà persisté.
      after(async () => {
        try {
          await dispatchNotificationsForUsers(auth.supabaseAdmin, [otherUserId], {
            events: ['new_message'],
          })
        } catch (err) {
          console.error('[conversations/[id]/messages:POST] dispatch failed (best-effort)', err)
        }
      })
    }
  }

  // ── Audit ───────────────────────────────────────────────────────────────
  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: cand.domain_id,
    action: 'message_sent',
    entity_type: 'message',
    entity_id: msgRow.id,
    detail: { conversation_id: convId, candidature_title: candTitle, content_length: content.length },
  })

  return json(
    {
      message: {
        id: msgRow.id,
        sender_id: msgRow.sender_id,
        sender_is_me: true,
        content: msgRow.content,
        read_at: msgRow.read_at,
        created_at: msgRow.created_at,
      },
    },
    201,
  )
}
