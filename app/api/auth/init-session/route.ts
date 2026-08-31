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

  // ── SUSPENSION : on refuse D'OUVRIR la session ──────────────────────────
  //
  // `requireAuth` bloque déjà toute requête d'un compte suspendu ; ce contrôle
  // est le second verrou, et c'est celui qui « bloque le login » au sens propre.
  // Il est placé AVANT `setSessionToken` à dessein — trois conséquences voulues :
  //   • aucun `last_session_token` n'est posé, donc aucun cookie n'est émis :
  //     l'utilisateur n'obtient pas de session à moitié valide ;
  //   • `last_login_at` n'est pas rafraîchi : une tentative refusée n'est pas
  //     une connexion, et ne doit pas remettre à zéro le compteur d'inactivité
  //     qui pilote la purge CNIL ;
  //   • rien n'est écrit dans `session_logs` : le journal des connexions ne
  //     doit contenir que des connexions réussies.
  //
  // Égalité stricte sur 'suspended' — même raison qu'en tête de
  // lib/auth-guard.ts : `!== 'active'` verrouillerait les experts 'in_review'.
  //
  // Lecture best-effort inversée : si le SELECT échoue, on LAISSE PASSER. Une
  // panne de lecture ne doit pas verrouiller toute la plateforme au login ;
  // `requireAuth` reste le garde de référence et refusera à la requête
  // suivante. On ne transforme pas un garde-fou en point de défaillance
  // unique (même principe que `countActiveAdmins`, lib/org-members.ts).
  const { data: statusRow, error: statusErr } = await supabaseAdmin
    .from('users')
    .select('status')
    .eq('id', userId)
    .maybeSingle()
  if (statusErr) {
    console.error('[init-session] status lookup failed — login laissé passer', {
      userId,
      msg: statusErr.message,
    })
  } else if ((statusRow as { status?: string | null } | null)?.status === 'suspended') {
    return json({ error: 'Account suspended', code: 'account_suspended' }, 403)
  }

  // ── Génère + persiste le nouveau session token ──────────────────────────
  const newToken = generateSessionToken()
  const setRes = await setSessionToken({ supabaseAdmin, userId, token: newToken })
  if (!setRes.ok) {
    return json({ error: 'Could not init session', code: 'db_error' }, 500)
  }

  // ── DERNIER CONTACT (purge CNIL inactivité) ──────────────────────────────
  //   init-session est le point de passage UNIQUE du login → on y rafraîchit
  //   last_login_at (colonne jadis morte, cf. migration 20260709000009) ET on
  //   remet inactivity_warning_sent_at à NULL dans la MÊME opération : un compte
  //   averti puis revenu doit pouvoir être ré-averti s'il redevient inactif plus
  //   tard. Best-effort : un échec ici ne doit pas bloquer le login (le token de
  //   session, lui, est déjà posé) — au pire le compteur d'inactivité stagne un
  //   cycle, sans conséquence de sécurité.
  //   NB : volontairement PAS dans setSessionToken() — ce helper sert aussi à
  //   /revoke-others (rotation hors login), qui ne doit pas compter comme un login.
  const { error: activityErr } = await supabaseAdmin
    .from('users')
    .update({
      last_login_at: new Date().toISOString(),
      inactivity_warning_sent_at: null,
    })
    .eq('id', userId)
  if (activityErr) {
    console.error('[init-session] last_login_at refresh failed', {
      userId,
      msg: activityErr.message,
    })
  }

  // ── Log best-effort dans session_logs (trace IP/UA + le nouveau token) ──
  await logSession({ supabaseAdmin, user_id: userId, request, session_token: newToken })

  // ── Build response avec Set-Cookie ──────────────────────────────────────
  const cookieStr = serializeSessionCookie(newToken, request)
  return json({ ok: true }, 200, { 'Set-Cookie': cookieStr })
}
