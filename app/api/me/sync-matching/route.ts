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
  // Une lecture de `profiles` en panne n'est pas un profil absent (§E.42) :
  // 503 qui se reessaie, jamais le 404 qui se croit. L'absence reelle garde son code.
  if (pErr) {
    console.error('[me/sync-matching] profil ILLISIBLE', { userId: user.id, message: pErr.message })
    return json(
      { error: 'Could not read the profile', code: 'profil_verification_indisponible' },
      503,
    )
  }
  if (!profile) {
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

  // ── CHEMIN COMPLET : ON REPORTE, ON NE REFUSE PLUS ─────────────────────
  //
  //  ÉLARGI (false → true), trace absente, ou périmètre inchangé (retour de
  //  « ne pas déranger ») : il faut renoter, et renoter coûte.
  //
  //  CE QUI CHANGE, ET C'EST LE SUJET DE CE LOT :
  //    Deux garde-fous de débit refusaient ici — 1 par minute, 10 par heure —
  //    et un refus PERDAIT le déclenchement. Un expert qui basculait sa
  //    disponibilité deux fois de suite voyait le second changement ignoré, et
  //    son flux rester celui d'avant. Rien ne le lui disait.
  //
  //    On pose désormais une échéance à une heure, REPOUSSÉE à chaque nouveau
  //    déclenchement. On attend qu'il ait fini de changer d'avis, puis on note
  //    UNE fois, sur son état final. Le coût reste borné — mieux qu'avant,
  //    puisqu'une rafale ne produit plus qu'un seul run — et plus rien n'est
  //    perdu.
  //
  //    Les deux garde-fous de débit disparaissent donc : ils ne protégeaient
  //    plus rien que la temporisation ne protège mieux, et leur seul effet
  //    restant aurait été d'empêcher de PROGRAMMER une relance.
  const { programmerRelance } = await import('@/lib/matching/relance')
  const prog = await programmerRelance(supabaseAdmin, prof.id, 'ouverture_croisee')
  if (!prog.ok) {
    // Le plafond horaire (garde d'ÉCRITURE, cf. lib/matching/relance.ts) est un
    // refus DÉLIBÉRÉ, pas une panne : il mérite son propre code et un 429. Le
    // confondre avec une erreur serveur ferait chercher une panne inexistante.
    if (prog.raison === 'plafond_horaire') {
      return json({ ok: false, code: 'relance_plafond' }, 429)
    }
    // Une relance non programmée est un changement qui ne sera jamais pris en
    // compte. On rend une erreur plutôt qu'un « ok » : l'écran doit pouvoir le
    // dire, et non laisser croire que c'est parti.
    return json({ ok: false, code: 'relance_non_programmee' }, 500)
  }

  return json(
    { ok: true, profile_id: prof.id, queued: true, mode: 'reportee', due_at: prog.due_at, reportee: prog.reportee },
    200,
  )
}
