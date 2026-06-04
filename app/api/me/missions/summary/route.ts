import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/me/missions/summary
 *
 * Compteur léger pour le badge "Missions" de la sidebar (SC5 Lot UX
 * Finitions 2, sémantique verrouillée).
 *
 * Définition : missions MATCHÉES non encore CANDIDATÉES par l'expert.
 *  = COUNT(matches.publication_id du profile courant) MINUS
 *    COUNT(candidatures.publication_id du même profile).
 *
 * Auto-vidant : se vide naturellement quand l'expert candidate (POST
 * /api/candidatures crée une candidature → la publication sort du set
 * matched-sans-candidature). Aucun flip de matches.status (le badge
 * "Nouveau" par carte côté MissionCard reste piloté par
 * match_status='notified'|'pending', sémantique existante intacte).
 *
 * Implémentation : 2 SELECT batch courts + diff client-side. Pas de jointure
 * inverse côté DB (Supabase JS ne sait pas exprimer LEFT JOIN ... IS NULL
 * trivialement). Coût acceptable (les volumes restent O(50-200) matches par
 * expert). Scope strict profile_id (gate auth.user.id).
 *
 * Retourne 200 même si :
 *   - profile absent (count=0)
 *   - non vérifié (count=0)
 *  → la sidebar reste inerte avant la vérif IA, pas d'info fuitée (juste un
 *  entier).
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
    return json({ pending_count: 0 }, 200)
  }

  const profileId = (profile as { id: string }).id

  // 1. publication_id des matches actifs (hors 'dismissed', cohérent avec
  //    /api/me/missions qui exclut les dismissed du feed).
  const { data: matchRows, error: mErr } = await auth.supabaseAdmin
    .from('matches')
    .select('publication_id')
    .eq('profile_id', profileId)
    .neq('status', 'dismissed')
  if (mErr) {
    console.error('[me/missions/summary:GET] matches query failed', mErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const matchedPubIds = new Set(
    ((matchRows ?? []) as { publication_id: string }[]).map((r) => r.publication_id),
  )
  if (matchedPubIds.size === 0) {
    return json({ pending_count: 0 }, 200)
  }

  // 2. publication_id des candidatures déjà déposées par ce profil (tous
  //    statuts confondus — une candidature retirée/refusée reste un "déjà
  //    candidaté").
  const { data: candRows, error: cErr } = await auth.supabaseAdmin
    .from('candidatures')
    .select('publication_id')
    .eq('profile_id', profileId)
  if (cErr) {
    console.error('[me/missions/summary:GET] candidatures query failed', cErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const candidatedPubIds = new Set(
    ((candRows ?? []) as { publication_id: string }[]).map((r) => r.publication_id),
  )

  // 3. Diff : matchées MINUS candidatées.
  let pendingCount = 0
  for (const pid of matchedPubIds) {
    if (!candidatedPubIds.has(pid)) pendingCount++
  }

  return json({ pending_count: pendingCount }, 200)
}
