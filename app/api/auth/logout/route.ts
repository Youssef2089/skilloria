import { NextRequest } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { clearSessionToken, serializeClearedSessionCookie } from '@/lib/session-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/logout
 *
 * Appelée par le client AVANT `supabase.auth.signOut()`. Efface le
 * `last_session_token` en BDD ET invalide le cookie httpOnly côté
 * navigateur.
 *
 * Comme init-session, on NE peut PAS utiliser `requireAuth` :
 *   - L'user a peut-être déjà reçu un 403 session_superseded
 *     (déconnexion forcée) et essaie quand même de se déconnecter
 *     proprement. On veut nettoyer ses traces côté serveur même si
 *     son cookie ne matche plus.
 *   - On valide juste le Bearer pour s'assurer qu'on a une identité.
 *
 * Si le Bearer est invalide ou absent → 200 quand même, avec cookie
 * invalidé. Le logout doit être idempotent et permissif (l'user ne
 * doit JAMAIS rester bloqué si quelque chose foire côté auth).
 */

function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
  })
}

function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  const clearedCookie = serializeClearedSessionCookie(request)

  const authHeader =
    request.headers.get('authorization') ?? request.headers.get('Authorization')
  const accessToken = authHeader?.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : null

  // Logout permissif : on tente de clear côté BDD si on peut identifier
  // l'user, mais on retourne TOUJOURS 200 + cookie invalidé.
  if (!accessToken) {
    return json({ ok: true, cleared_db: false }, 200, { 'Set-Cookie': clearedCookie })
  }

  const supabaseAdmin = getSupabaseAdmin()
  if (!supabaseAdmin) {
    // Pas de service-role en env — on purge quand même le cookie client.
    return json({ ok: true, cleared_db: false }, 200, { 'Set-Cookie': clearedCookie })
  }

  const { data: userInfo, error: sessionError } = await supabaseAdmin.auth.getUser(accessToken)
  if (sessionError || !userInfo?.user) {
    // Token Supabase invalide → on purge le cookie sans toucher la BDD.
    return json({ ok: true, cleared_db: false }, 200, { 'Set-Cookie': clearedCookie })
  }
  const userId = userInfo.user.id

  const clearRes = await clearSessionToken({ supabaseAdmin, userId })
  return json(
    { ok: true, cleared_db: clearRes.ok },
    200,
    { 'Set-Cookie': clearedCookie },
  )
}
