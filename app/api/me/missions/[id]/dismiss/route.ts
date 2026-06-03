import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'

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

  const { id: publicationId } = await ctx.params
  if (!publicationId || !UUID_REGEX.test(publicationId)) {
    return json({ error: 'Invalid id', code: 'not_found' }, 404)
  }

  const { data: profile, error: pErr } = await auth.supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('user_id', auth.user.id)
    .maybeSingle()
  if (pErr || !profile) {
    return json({ error: 'Profile not found', code: 'not_found' }, 404)
  }

  const { data: match, error: mErr } = await auth.supabaseAdmin
    .from('matches')
    .select('id, status')
    .eq('publication_id', publicationId)
    .eq('profile_id', (profile as { id: string }).id)
    .maybeSingle()
  if (mErr) {
    console.error('[dismiss:POST] match query failed', mErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!match) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }

  const matchRow = match as unknown as { id: string; status: string }
  if (matchRow.status === 'dismissed') {
    return json({ ok: true, already_dismissed: true }, 200)
  }

  const { error: flipErr } = await auth.supabaseAdmin
    .from('matches')
    .update({ status: 'dismissed' })
    .eq('id', matchRow.id)
  if (flipErr) {
    console.error('[dismiss:POST] flip failed', flipErr.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  return json({ ok: true }, 200)
}
