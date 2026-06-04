import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/me/candidatures — liste les candidatures de l'expert courant.
 *
 *  Garde : requireAuth → service_role.
 *  Source : candidatures.profile_id = profile.user_id == auth.uid().
 *  Filtre : ne renvoie pas les 'withdrawn' (l'expert s'est retiré).
 *
 *  DTO : id, publication_id, publication.title, publication.type, status,
 *  status_reason, ai_match_score, unlocked_at, created_at, conversation_id si
 *  unlocked.
 *
 *  Tri : created_at DESC (les plus récentes d'abord).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type CandRow = {
  id: string
  publication_id: string
  status: string
  status_reason: string | null
  ai_match_score: number | null
  unlocked_at: string | null
  cover_message: string | null
  created_at: string
  publications: {
    id: string
    type: string
    title: string
    status: string
  } | { id: string; type: string; title: string; status: string }[] | null
}

function pickRel<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  // Profile expert
  const { data: profile, error: pErr } = await auth.supabaseAdmin
    .from('profiles')
    .select('id, user_id')
    .eq('user_id', auth.user.id)
    .maybeSingle()
  if (pErr) {
    console.error('[me/candidatures:GET] profile lookup failed', pErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!profile) {
    return json({ candidatures: [] }, 200)
  }

  // Candidatures + publication
  const { data: rows, error: cErr } = await auth.supabaseAdmin
    .from('candidatures')
    .select(
      'id, publication_id, status, status_reason, ai_match_score, unlocked_at, ' +
        'cover_message, created_at, ' +
        'publications!inner(id, type, title, status)',
    )
    .eq('profile_id', (profile as { id: string }).id)
    .neq('status', 'withdrawn')
    .order('created_at', { ascending: false })
    .limit(200)
  if (cErr) {
    console.error('[me/candidatures:GET] candidatures query failed', cErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  // Conversation_id pour les unlocked (batch query)
  const unlockedCandIds = ((rows ?? []) as unknown as CandRow[]).filter(r => r.status === 'unlocked').map(r => r.id)
  const convByCand = new Map<string, string>()
  if (unlockedCandIds.length > 0) {
    const { data: convs } = await auth.supabaseAdmin
      .from('conversations')
      .select('id, candidature_id')
      .in('candidature_id', unlockedCandIds)
    for (const c of ((convs ?? []) as { id: string; candidature_id: string }[])) {
      convByCand.set(c.candidature_id, c.id)
    }
  }

  const candidatures = ((rows ?? []) as unknown as CandRow[]).map(r => {
    const pub = pickRel(r.publications)
    return {
      id: r.id,
      publication_id: r.publication_id,
      publication: pub ? { id: pub.id, type: pub.type, title: pub.title, status: pub.status } : null,
      status: r.status,
      status_reason: r.status_reason,
      ai_match_score: r.ai_match_score,
      unlocked_at: r.unlocked_at,
      cover_message: r.cover_message,
      created_at: r.created_at,
      conversation_id: r.status === 'unlocked' ? (convByCand.get(r.id) ?? null) : null,
    }
  })

  return json({ candidatures }, 200)
}
