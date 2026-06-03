import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/me/conversations — inbox du user courant (expert OU membre org).
 *
 * Garde (service_role) :
 *  - requireAuth
 *  - L'user est participant d'une conversation s'il est :
 *      • l'expert : profiles.user_id == auth.uid() ET candidature.profile_id == profiles.id
 *      • OU un membre actif de l'org propriétaire de candidature.publication.
 *
 * Retour : conversations où candidature.status='unlocked', triées par
 *   last_message_at DESC NULLS LAST, puis created_at DESC.
 *
 * Pour chaque conversation :
 *   - conversation : id, status, last_message_at, expires_at, is_expired
 *   - publication  : id, title, type
 *   - correspondant: { kind:'expert'|'org', name, avatar_url } — projeté
 *     SERVEUR via service_role (D3, identité MUTUELLE post-unlock cf. D6).
 *   - last_message : { content (clip 140), created_at, sender_is_me }
 *   - unread_count : messages WHERE sender_id != auth.uid() AND read_at IS NULL.
 *
 * Note expiry (D5) :
 *   expires_at NULL ⇒ NON expiré (compat conv legacy Lot 2c) ;
 *   expires_at > now() ⇒ NON expiré ;
 *   sinon ⇒ is_expired = true (lecture seule côté UI, écriture bloquée route).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type ConversationRow = {
  id: string
  candidature_id: string
  status: string
  last_message_at: string | null
  expires_at: string | null
  created_at: string
  candidatures: {
    id: string
    status: string
    profile_id: string
    publication_id: string
    profiles: {
      id: string
      user_id: string
      users: { id: string; first_name: string | null; last_name: string | null } | { id: string; first_name: string | null; last_name: string | null }[]
      photo_url?: string | null
    } | { id: string; user_id: string; users: { id: string; first_name: string | null; last_name: string | null } | { id: string; first_name: string | null; last_name: string | null }[]; photo_url?: string | null }[]
    publications: {
      id: string
      type: string
      title: string
      organization_id: string
      organizations: { id: string; company_name: string | null; logo_url: string | null } | { id: string; company_name: string | null; logo_url: string | null }[]
    } | { id: string; type: string; title: string; organization_id: string; organizations: { id: string; company_name: string | null; logo_url: string | null } | { id: string; company_name: string | null; logo_url: string | null }[] }[]
  } | { id: string; status: string; profile_id: string; publication_id: string; profiles: unknown; publications: unknown }[]
}

function pickRel<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false
  return new Date(expiresAt).getTime() <= Date.now()
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const userId = auth.user.id

  // ── Résoudre les conversations où l'user est participant ────────────────
  //  Plus simple en 2 queries jointes : on prend candidatures.status='unlocked'
  //  où profile.user_id = me OU une publi appartenant à mon org active.
  //  Pour rester service_role et éviter une OR sur RLS, on fait deux SELECT :
  //   (1) candidatures unlocked liées à mon profile (expert)
  //   (2) candidatures unlocked sur des publis de mon org (membre)
  //  Puis on charge les conversations correspondantes en une 3e query.

  // (1) Expert
  const candIdsExpert: string[] = []
  const { data: myProfile } = await auth.supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()
  if (myProfile) {
    const { data: rows } = await auth.supabaseAdmin
      .from('candidatures')
      .select('id')
      .eq('profile_id', (myProfile as { id: string }).id)
      .eq('status', 'unlocked')
    for (const r of (rows ?? []) as { id: string }[]) candIdsExpert.push(r.id)
  }

  // (2) Org membre actif
  const candIdsOrg: string[] = []
  if (auth.organization?.id) {
    const { data: pubs } = await auth.supabaseAdmin
      .from('publications')
      .select('id')
      .eq('organization_id', auth.organization.id)
    const pubIds = ((pubs ?? []) as { id: string }[]).map((p) => p.id)
    if (pubIds.length > 0) {
      const { data: rows } = await auth.supabaseAdmin
        .from('candidatures')
        .select('id')
        .in('publication_id', pubIds)
        .eq('status', 'unlocked')
      for (const r of (rows ?? []) as { id: string }[]) candIdsOrg.push(r.id)
    }
  }

  const candIds = Array.from(new Set([...candIdsExpert, ...candIdsOrg]))
  if (candIds.length === 0) {
    return json({ conversations: [] }, 200)
  }

  // (3) Charger les conversations + chaîne d'identité
  const { data: convs, error: convErr } = await auth.supabaseAdmin
    .from('conversations')
    .select(
      'id, candidature_id, status, last_message_at, expires_at, created_at, ' +
        'candidatures!inner(id, status, profile_id, publication_id, ' +
          'profiles!inner(id, user_id, photo_url, users!profiles_user_id_fkey(id, first_name, last_name)), ' +
          'publications!inner(id, type, title, organization_id, organizations(id, company_name, logo_url)))',
    )
    .in('candidature_id', candIds)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(200)
  if (convErr) {
    console.error('[me/conversations:GET] query failed', convErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const convRows = (convs ?? []) as unknown as ConversationRow[]

  // ── Pour chaque conv : last message + unread count ─────────────────────
  const convIds = convRows.map((c) => c.id)
  const lastMsgByConv = new Map<string, { content: string; created_at: string; sender_id: string }>()
  const unreadByConv = new Map<string, number>()
  if (convIds.length > 0) {
    // Last message par conv (1 par conv, on lit le plus récent global puis filtre)
    const { data: msgs } = await auth.supabaseAdmin
      .from('messages')
      .select('conversation_id, content, created_at, sender_id, read_at')
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false })
      .limit(500)
    const seen = new Set<string>()
    for (const m of ((msgs ?? []) as { conversation_id: string; content: string; created_at: string; sender_id: string; read_at: string | null }[])) {
      if (!seen.has(m.conversation_id)) {
        seen.add(m.conversation_id)
        lastMsgByConv.set(m.conversation_id, { content: m.content, created_at: m.created_at, sender_id: m.sender_id })
      }
      if (m.sender_id !== userId && m.read_at === null) {
        unreadByConv.set(m.conversation_id, (unreadByConv.get(m.conversation_id) ?? 0) + 1)
      }
    }
  }

  // ── DTO : projection correspondant + last_message + unread ──────────────
  const conversations = convRows.map((conv) => {
    const c = pickRel(conv.candidatures) as ConversationRow['candidatures'] extends (infer X)[] | infer Y ? Y : never
    const cand = c as unknown as {
      id: string; status: string; profile_id: string; publication_id: string;
      profiles: unknown; publications: unknown;
    } | null
    const profile = pickRel(cand?.profiles as { id: string; user_id: string; photo_url: string | null; users: unknown } | { id: string; user_id: string; photo_url: string | null; users: unknown }[] | null)
    const u = pickRel(profile?.users as { id: string; first_name: string | null; last_name: string | null } | { id: string; first_name: string | null; last_name: string | null }[] | null)
    const pub = pickRel(cand?.publications as { id: string; type: string; title: string; organization_id: string; organizations: unknown } | { id: string; type: string; title: string; organization_id: string; organizations: unknown }[] | null)
    const org = pickRel(pub?.organizations as { id: string; company_name: string | null; logo_url: string | null } | { id: string; company_name: string | null; logo_url: string | null }[] | null)

    // L'user courant est-il l'expert ou l'org ?
    const isMeExpert = profile?.user_id === userId
    const correspondant = isMeExpert
      ? {
          kind: 'org' as const,
          name: org?.company_name ?? null,
          avatar_url: org?.logo_url ?? null,
        }
      : {
          kind: 'expert' as const,
          name: [u?.first_name, u?.last_name].filter(Boolean).join(' ').trim() || null,
          avatar_url: profile?.photo_url ?? null,
        }

    const lastMsg = lastMsgByConv.get(conv.id) ?? null
    const lastMsgPreview = lastMsg
      ? {
          content: lastMsg.content.length > 140 ? `${lastMsg.content.slice(0, 140)}…` : lastMsg.content,
          created_at: lastMsg.created_at,
          sender_is_me: lastMsg.sender_id === userId,
        }
      : null

    return {
      id: conv.id,
      candidature_id: conv.candidature_id,
      status: conv.status,
      last_message_at: conv.last_message_at,
      expires_at: conv.expires_at,
      is_expired: isExpired(conv.expires_at),
      created_at: conv.created_at,
      publication: pub ? { id: pub.id, type: pub.type, title: pub.title } : null,
      correspondant,
      last_message: lastMsgPreview,
      unread_count: unreadByConv.get(conv.id) ?? 0,
    }
  })

  return json({ conversations }, 200)
}
