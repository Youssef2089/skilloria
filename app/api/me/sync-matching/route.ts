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

  // Hint client OPTIONNEL { reason } : lu en TÉLÉMÉTRIE uniquement, JAMAIS pour
  // décider (le client n'est pas autoritaire — cf. audit sécurité). Best-effort.
  let clientReason: string | null = null
  try {
    const body = (await request.json().catch(() => null)) as { reason?: unknown } | null
    if (body && typeof body.reason === 'string') clientReason = body.reason
  } catch {
    /* body vide/non-JSON → ignoré */
  }

  // Profil courant : id + flags d'ouverture croisée ACTUELS + trace du dernier
  // run. La trace permet de DÉRIVER le sens du changement de scope côté serveur.
  const { data: profile, error: pErr } = await supabaseAdmin
    .from('profiles')
    .select('id, open_to_cdi, open_to_freelance, last_matching_scope, users!profiles_user_id_fkey!inner(user_type)')
    .eq('user_id', user.id)
    .maybeSingle()
  if (pErr || !profile) {
    return json({ ok: false, code: 'profile_not_found' }, 404)
  }
  const prof = profile as unknown as {
    id: string
    open_to_cdi: boolean | null
    open_to_freelance: boolean | null
    last_matching_scope: { crossOpen?: boolean } | null
    users: { user_type: string | null } | { user_type: string | null }[] | null
  }
  const uRel = Array.isArray(prof.users) ? prof.users[0] : prof.users
  const userType = uRel?.user_type === 'expert_cdi' ? 'expert_cdi' : 'expert_freelance'
  const currentCrossOpen =
    (userType === 'expert_freelance' && prof.open_to_cdi === true) ||
    (userType === 'expert_cdi' && prof.open_to_freelance === true)
  const traceCrossOpen = prof.last_matching_scope?.crossOpen === true

  // ── SENS DÉRIVÉ SERVEUR ────────────────────────────────────────────────
  //  RÉTRÉCI (crossOpen true → false) : le pool n'a fait que se réduire → un
  //  simple élagage SQL suffit (ZÉRO Claude). On le sort du cooldown IA et on
  //  lui applique un rate-limit PERMISSIF (10/min) : le coût est purement DB.
  //  La trace DOIT exister et valoir true, l'état courant DOIT être false.
  if (traceCrossOpen && !currentCrossOpen) {
    const allowedPrune = await checkRateLimit(supabaseAdmin, 'matching_prune_60s', user.id, 60, 10)
    if (!allowedPrune) return json({ ok: false, code: 'rate_limited', retry_after_seconds: 60 }, 429)

    after(async () => {
      try {
        const { runPruneForExpert } = await import('@/lib/matching')
        const r = await runPruneForExpert({ supabaseAdmin, profileId: prof.id })
        console.log('[me/sync-matching] prune done', { profileId: prof.id, ok: r.ok, deleted: r.deleted, kept: r.kept, hint: clientReason })
      } catch (err) {
        console.error('[me/sync-matching] prune threw (after)', err)
      }
    })

    return json({ ok: true, profile_id: prof.id, queued: true, mode: 'prune' }, 200)
  }

  // ── CHEMIN IA COMPLET — STRICTEMENT INCHANGÉ ───────────────────────────
  //  ÉLARGI (false → true), trace absente/null, OU scope inchangé (ex. retour
  //  de DND) : il faut (re)scorer → run IA complet sous cooldown M2 STRICT.
  // Cooldown M2 : plafonne le coût des appels Claude. Check AVANT le after()
  // -> un refus ne programme jamais de travail IA. checkRateLimit est fail-open.
  const allowed60 = await checkRateLimit(supabaseAdmin, 'matching_sync_60s', user.id, 60, 1)
  if (!allowed60) return json({ ok: false, code: 'rate_limited', retry_after_seconds: 60 }, 429)
  const allowedHour = await checkRateLimit(supabaseAdmin, 'matching_sync_1h', user.id, 3600, 10)
  if (!allowedHour) return json({ ok: false, code: 'rate_limited', retry_after_seconds: 3600 }, 429)

  // Exécution via `after()` — on retourne immédiatement, le matching IA
  // (~10-15s) tourne après l'envoi de la response mais AVANT que le runtime
  // serverless ne soit suspendu. Sans `after()`, un `void promise` serait
  // tué par Vercel quand la response part.
  after(async () => {
    try {
      const { runMatchingForExpert } = await import('@/lib/matching')
      const v = await runMatchingForExpert({ supabaseAdmin, profileId: prof.id })
      console.log('[me/sync-matching] done', { profileId: prof.id, status: v.status, proposals: v.proposals.length })
    } catch (err) {
      console.error('[me/sync-matching] threw (after)', err)
    }
  })

  return json({ ok: true, profile_id: prof.id, queued: true, mode: 'full' }, 200)
}
