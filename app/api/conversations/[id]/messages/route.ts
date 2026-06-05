import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'
import { dashboardUrlForUserType } from '@/lib/auth-routing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
const VALID_LOCALES = ['fr', 'en', 'es', 'de']
function normalizeLocale(raw: string | null | undefined): string {
  if (raw && VALID_LOCALES.includes(raw)) return raw
  return 'fr'
}
const NOTIF_TITLE: Record<string, string> = {
  fr: 'Nouveau message',
  en: 'New message',
  es: 'Nuevo mensaje',
  de: 'Neue Nachricht',
}
function notifBody(loc: string, senderName: string, preview: string): string {
  const previewClip = preview.length > 80 ? `${preview.slice(0, 80)}…` : preview
  if (loc === 'en') return `${senderName} wrote: "${previewClip}"`
  if (loc === 'es') return `${senderName} escribió: «${previewClip}»`
  if (loc === 'de') return `${senderName} schrieb: „${previewClip}"`
  return `${senderName} vous a écrit : « ${previewClip} »`
}

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
      organization_id: string
      organizations: { id: string; company_name: string | null; logo_url: string | null }
        | { id: string; company_name: string | null; logo_url: string | null }[]
    } | { id: string; type: string; title: string; organization_id: string; organizations: unknown }[]
  } | { id: string; profile_id: string; status: string; publication_id: string; domain_id: string; profiles: unknown; publications: unknown }[]
}

function pickRel<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false
  return new Date(expiresAt).getTime() <= Date.now()
}

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
        'candidatures!inner(id, profile_id, status, publication_id, domain_id, ' +
          'profiles!inner(id, user_id, photo_url, users!profiles_user_id_fkey(id, first_name, last_name, locale, user_type)), ' +
          'publications!inner(id, type, title, organization_id, organizations(id, company_name, logo_url)))',
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
  // Sécurité : la conv n'est lisible que si candidature.status='unlocked'
  if (cand.status !== 'unlocked') return { ok: false, status: 404, code: 'not_found' }

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
  let senderFirstLast = ''
  if (role === 'expert') {
    senderFirstLast = [expertUser?.first_name, expertUser?.last_name].filter(Boolean).join(' ').trim() || 'L\'expert'
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

  const cand = pickRel(conv.candidatures) as { id: string; profile_id: string; status: string; publication_id: string; profiles: unknown; publications: unknown }
  const profile = pickRel(cand.profiles as { id: string; user_id: string; photo_url: string | null; users: unknown } | { id: string; user_id: string; photo_url: string | null; users: unknown }[] | null)
  const expertUser = pickRel(profile?.users as { id: string; first_name: string | null; last_name: string | null; locale: string | null } | { id: string; first_name: string | null; last_name: string | null; locale: string | null }[] | null)
  const pub = pickRel(cand.publications as { id: string; type: string; title: string; organization_id: string; organizations: unknown } | { id: string; type: string; title: string; organization_id: string; organizations: unknown }[] | null)
  const orgRaw = pickRel(pub?.organizations as { id: string; company_name: string | null; logo_url: string | null } | { id: string; company_name: string | null; logo_url: string | null }[] | null)

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

  // ── Correspondant (identité MUTUELLE post-unlock) ──────────────────────
  const correspondant = role === 'expert'
    ? {
        kind: 'org' as const,
        name: orgRaw?.company_name ?? null,
        avatar_url: orgRaw?.logo_url ?? null,
      }
    : {
        kind: 'expert' as const,
        name: [expertUser?.first_name, expertUser?.last_name].filter(Boolean).join(' ').trim() || null,
        avatar_url: profile?.photo_url ?? null,
      }

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
    const { error: notifErr } = await auth.supabaseAdmin.from('notifications').insert({
      user_id: otherUserId,
      domain_id: cand.domain_id,
      type: NOTIF_TYPE,
      channel: NOTIF_CHANNEL,
      title: NOTIF_TITLE[otherUserLocale] ?? NOTIF_TITLE.fr,
      body: notifBody(otherUserLocale, senderFirstLast, content),
      link_url: link,
      status: NOTIF_STATUS,
      entity_id: convId,
    })
    if (notifErr) console.error('[conversations/[id]/messages:POST] notif insert failed', notifErr.message)
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
