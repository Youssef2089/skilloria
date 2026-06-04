import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/me/missions/mark-viewed
 *
 * Vide le badge "Missions" (SC5 Lot UX Finitions 2). Flippe TOUS les matches
 * de l'expert en status='notified' vers 'viewed'. Idempotent.
 *
 * Garde : requireAuth (service_role). Scope strict matches.profile_id =
 * profile de l'expert courant. Aucune fuite cross-expert.
 *
 * Appelé par /dashboard/{freelance,cdi}/missions au mount → auto-vidant.
 * Réponse 200 avec { updated: number }.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { data: profile, error: pErr } = await auth.supabaseAdmin
    .from('profiles')
    .select('id, verification_status')
    .eq('user_id', auth.user.id)
    .maybeSingle()
  if (pErr) {
    console.error('[me/missions/mark-viewed:POST] profile lookup failed', pErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!profile || (profile as { verification_status?: string | null }).verification_status !== 'approved') {
    return json({ updated: 0 }, 200)
  }

  const { data, error: uErr } = await auth.supabaseAdmin
    .from('matches')
    .update({ status: 'viewed' })
    .eq('profile_id', (profile as { id: string }).id)
    .eq('status', 'notified')
    .select('id')

  if (uErr) {
    console.error('[me/missions/mark-viewed:POST] update failed', uErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  return json({ updated: data?.length ?? 0 }, 200)
}
