import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { loadTranslations } from '@/lib/translations'
import { routing, type Locale } from '@/i18n/routing'
import { buildPublicationSynthesis } from '@/lib/publication-synthesis'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/me/candidatures — liste les candidatures de l'expert courant.
 *
 *  Garde : requireAuth → service_role.
 *  Source : candidatures.profile_id = profile.user_id == auth.uid().
 *  Filtre : ne renvoie pas les 'withdrawn' (l'expert s'est retiré).
 *
 *  DTO : id, publication_id, publication = PublicationSynthesis (synthèse
 *  parlante via helper partagé), status, status_reason, ai_match_score,
 *  unlocked_at, cover_message, created_at, conversation_id si unlocked.
 *
 *  Tri : created_at DESC (les plus récentes d'abord).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function normalizeLocale(raw: string | null): Locale {
  return (routing.locales as readonly string[]).includes(raw ?? '')
    ? (raw as Locale)
    : routing.defaultLocale
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
  publications: unknown
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

  const locale = normalizeLocale(new URL(request.url).searchParams.get('locale'))

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

  // Candidatures + publication enrichie (Lot synthèse parlante).
  //  Le SELECT publications est élargi pour alimenter buildPublicationSynthesis.
  const [candResult, translations] = await Promise.all([
    auth.supabaseAdmin
      .from('candidatures')
      .select(
        'id, publication_id, status, status_reason, ai_match_score, unlocked_at, ' +
          'cover_message, created_at, ' +
          'publications!inner(' +
          'id, type, title, branch_id, speciality_id, budget_min, budget_max, ' +
          'location, work_mode, duration, start_date, seniority, ' +
          'confidential, status, ' +
          'branches(id, name), specialities(id, name)' +
          ')',
      )
      .eq('profile_id', (profile as { id: string }).id)
      .neq('status', 'withdrawn')
      .order('created_at', { ascending: false })
      .limit(200),
    loadTranslations(locale),
  ])
  if (candResult.error) {
    console.error('[me/candidatures:GET] candidatures query failed', candResult.error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const rows = (candResult.data ?? []) as unknown as CandRow[]

  // Conversation_id pour les unlocked (batch query)
  const unlockedCandIds = rows.filter((r) => r.status === 'unlocked').map((r) => r.id)
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

  const candidatures = rows.map((r) => {
    const pubRaw = pickRel(r.publications as Parameters<typeof buildPublicationSynthesis>[0] | Parameters<typeof buildPublicationSynthesis>[0][] | null)
    const publication = pubRaw
      ? {
          ...buildPublicationSynthesis(pubRaw, translations),
          status: (pubRaw as { status?: string }).status ?? null,
        }
      : null
    return {
      id: r.id,
      publication_id: r.publication_id,
      publication,
      status: r.status,
      status_reason: r.status_reason,
      ai_match_score: r.ai_match_score,
      unlocked_at: r.unlocked_at,
      cover_message: r.cover_message,
      created_at: r.created_at,
      conversation_id: r.status === 'unlocked' ? convByCand.get(r.id) ?? null : null,
    }
  })

  return json({ candidatures }, 200)
}
