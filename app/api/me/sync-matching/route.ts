import { NextRequest } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/me/sync-matching — déclenche la réconciliation matching pour
 * l'EXPERT courant (best-effort, idempotent).
 *
 * Cas d'usage : événements expert qui changent l'éligibilité ou les critères
 * et qui s'exécutent côté client (pas via une route serveur dédiée). Le seul
 * cas V1 est la bascule availability "Ne pas déranger" → "À l'écoute" (gérée
 * client-side via supabase + RLS dans lib/availability-actions.ts).
 *
 * Garde : requireAuth (le caller est l'expert lui-même). On scope la
 * réconciliation à son profile_id — pas de paramètre d'entrée.
 *
 * Retour rapide : on ne BLOQUE PAS le caller sur l'appel IA (~15s). On fire-
 * and-forget la promesse côté serveur ; côté client useLiveResource revalide
 * /api/me/missions et reflète la nouvelle liste dès qu'elle est en BDD.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { supabaseAdmin, user } = auth

  // Récupère le profile_id de l'expert courant
  const { data: profile, error: pErr } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (pErr || !profile) {
    return json({ ok: false, code: 'profile_not_found' }, 404)
  }

  // Fire-and-forget — on retourne immédiatement, le matching tourne en BG.
  try {
    const { runMatchingForExpert } = await import('@/lib/matching')
    void runMatchingForExpert({ supabaseAdmin, profileId: profile.id })
      .then((v) => console.log('[me/sync-matching] done', { profileId: profile.id, status: v.status, proposals: v.proposals.length }))
      .catch((err) => console.error('[me/sync-matching] threw (non-blocking)', err))
  } catch (err) {
    console.error('[me/sync-matching] import threw (non-blocking)', err)
  }

  return json({ ok: true, profile_id: profile.id, queued: true }, 200)
}
