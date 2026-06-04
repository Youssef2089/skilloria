import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/me/missions/summary
 *
 * Compteur léger pour le badge "Missions" de la sidebar (SC5 Lot UX Finitions 2).
 *
 * Option A (validée par Youssef) : NO migration. Réutilisation du status
 * existant matches.status='notified' comme signal "non vu". Quand l'expert
 * ouvre le feed (POST /api/me/missions/mark-viewed), tous ses matches en
 * 'notified' transitent vers 'viewed' → badge se vide automatiquement.
 *
 * Retourne 200 avec { notified_count } même si :
 *   - L'expert n'a pas de profile (count = 0)
 *   - Le profile n'est pas verified (count = 0)
 *  → évite que la sidebar disjoncte avant la vérification IA. Ne fuit aucune
 *  info (juste un entier).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function GET(request: NextRequest): Promise<Response> {
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
    console.error('[me/missions/summary:GET] profile lookup failed', pErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!profile || (profile as { verification_status?: string | null }).verification_status !== 'approved') {
    return json({ notified_count: 0 }, 200)
  }

  // Compteur strict : matches.status='notified' du profile courant.
  // RLS bypass via service_role (requireAuth) — déjà gaté par profile_id.
  const { count, error: cErr } = await auth.supabaseAdmin
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', (profile as { id: string }).id)
    .eq('status', 'notified')

  if (cErr) {
    console.error('[me/missions/summary:GET] count failed', cErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  return json({ notified_count: count ?? 0 }, 200)
}
