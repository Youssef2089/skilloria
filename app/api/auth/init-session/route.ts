import { NextRequest } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  generateSessionToken,
  setSessionToken,
  serializeSessionCookie,
} from '@/lib/session-token'
import { logSession } from '@/lib/session-log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/init-session
 *
 * Appelée par le client juste APRÈS un login Supabase réussi
 * (signInWithPassword OU confirm email via /auth/callback). Génère un
 * `last_session_token` cryptographiquement aléatoire, le pose en BDD et
 * renvoie un Set-Cookie httpOnly que le navigateur enverra sur toutes
 * les requêtes futures.
 *
 * IMPORTANT :
 *   - On NE peut PAS utiliser `requireAuth` ici car l'user a peut-être
 *     un cookie ss_token précédent (re-login depuis un autre appareil)
 *     qui ne matchera plus le futur token. On valide donc le Bearer
 *     "à la main" pour récupérer l'user.id, puis on écrase.
 *   - Effet de bord voulu : poser un nouveau token INVALIDE les anciennes
 *     sessions de cet user (autres onglets/appareils) → ils tomberont sur
 *     un 403 `session_superseded` à leur prochain fetch.
 *
 * Body : aucun (vide ou ignoré).
 * Headers attendus : Authorization: Bearer <access_token>
 *
 * Réponse 200 :
 *   - Set-Cookie: ss_token=<uuid>; HttpOnly; ...
 *   - JSON { ok: true }
 */

function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
  })
}

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('missing_env')
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  const authHeader =
    request.headers.get('authorization') ?? request.headers.get('Authorization')
  const accessToken = authHeader?.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : null

  if (!accessToken) {
    return json({ error: 'Not authenticated', code: 'no_token' }, 401)
  }

  let supabaseAdmin: SupabaseClient
  try {
    supabaseAdmin = getSupabaseAdmin()
  } catch {
    return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
  }

  // ── Valide le Bearer Supabase et récupère user.id ───────────────────────
  const { data: userInfo, error: sessionError } = await supabaseAdmin.auth.getUser(accessToken)
  if (sessionError || !userInfo?.user) {
    return json({ error: 'Not authenticated', code: 'invalid_token' }, 401)
  }
  const userId = userInfo.user.id

  // ── Génère + persiste le nouveau session token ──────────────────────────
  const newToken = generateSessionToken()
  const setRes = await setSessionToken({ supabaseAdmin, userId, token: newToken })
  if (!setRes.ok) {
    return json({ error: 'Could not init session', code: 'db_error' }, 500)
  }

  // ── Log best-effort dans session_logs (trace IP/UA + le nouveau token) ──
  await logSession({ supabaseAdmin, user_id: userId, request, session_token: newToken })

  // ── Build response avec Set-Cookie ──────────────────────────────────────
  const cookieStr = serializeSessionCookie(newToken, request)
  return json({ ok: true }, 200, { 'Set-Cookie': cookieStr })
}
