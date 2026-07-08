import { NextRequest, after } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth-guard'
import { checkRateLimit } from '@/lib/rate-limit'

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

  // Cooldown M2 : plafonne le coût des appels Claude. Check AVANT le after()
  // -> un refus ne programme jamais de travail IA. checkRateLimit est fail-open.
  const allowed60 = await checkRateLimit(supabaseAdmin, 'matching_sync_60s', user.id, 60, 1)
  if (!allowed60) return json({ ok: false, code: 'rate_limited', retry_after_seconds: 60 }, 429)
  const allowedHour = await checkRateLimit(supabaseAdmin, 'matching_sync_1h', user.id, 3600, 10)
  if (!allowedHour) return json({ ok: false, code: 'rate_limited', retry_after_seconds: 3600 }, 429)

  // Récupère le profile_id de l'expert courant
  const { data: profile, error: pErr } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (pErr || !profile) {
    return json({ ok: false, code: 'profile_not_found' }, 404)
  }

  // Exécution via `after()` — on retourne immédiatement, le matching IA
  // (~10-15s) tourne après l'envoi de la response mais AVANT que le runtime
  // serverless ne soit suspendu. Sans `after()`, un `void promise` serait
  // tué par Vercel quand la response part.
  after(async () => {
    try {
      const { runMatchingForExpert } = await import('@/lib/matching')
      const v = await runMatchingForExpert({ supabaseAdmin, profileId: profile.id })
      console.log('[me/sync-matching] done', { profileId: profile.id, status: v.status, proposals: v.proposals.length })
    } catch (err) {
      console.error('[me/sync-matching] threw (after)', err)
    }
  })

  return json({ ok: true, profile_id: profile.id, queued: true }, 200)
}
