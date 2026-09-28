import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { contexteDepuisAuth, parametresJournal } from '@/lib/journal/contexte'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/me/missions/[id]/dismiss — l'expert décline une opportunité.
 *
 * Flip match.status → 'dismissed'. La mission disparaît du feed (filtre
 * `neq('status','dismissed')` côté GET /api/me/missions).
 *
 * Idempotent : si match déjà dismissed, renvoie 200 quand même.
 * 404 si pas de match pour cet expert sur cette publi.
 *
 * ⚠️ L'ÉCART S'ÉCRIT AU GRAND LIVRE (phase B, 28/09/2026) : `ecarter_mission()`
 *    lit le match SOUS VERROU, vérifie EN BASE que le profil est celui de
 *    l'acteur, écarte et écrit `mission_ecartee` dans la même transaction. Il
 *    ne laissait AUCUNE trace — alors que le moteur ne repropose plus la mission.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: RouteContext): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  // La pièce du geste naît à son entrée, avant toute écriture (§D.26).
  const journal = contexteDepuisAuth(auth)

  const { id: publicationId } = await ctx.params
  if (!publicationId || !UUID_REGEX.test(publicationId)) {
    return json({ error: 'Invalid id', code: 'not_found' }, 404)
  }

  const { data: profile, error: pErr } = await auth.supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('user_id', auth.user.id)
    .maybeSingle()
  // Une lecture de `profiles` en panne n'est pas un profil absent (§E.42) :
  // 503 qui se reessaie, jamais le 404 qui se croit. L'absence reelle garde son code.
  if (pErr) {
    console.error('[me/missions/dismiss] profil ILLISIBLE', { userId: auth.user.id, message: pErr.message })
    return json(
      { error: 'Could not read the profile', code: 'profil_verification_indisponible' },
      503,
    )
  }
  if (!profile) {
    return json({ error: 'Profile not found', code: 'not_found' }, 404)
  }

  const { data: issue, error: rpcErr } = await auth.supabaseAdmin.rpc('ecarter_mission', {
    ...parametresJournal(journal),
    p_publication_id: publicationId,
    p_profile_id: (profile as { id: string }).id,
  })
  if (rpcErr) {
    console.error('[dismiss:POST] écart en échec', rpcErr.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }
  if (issue === 'introuvable') {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }
  if (issue === 'deja_ecartee') {
    return json({ ok: true, already_dismissed: true }, 200)
  }
  return json({ ok: true }, 200)
}
