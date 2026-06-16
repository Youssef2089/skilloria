import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { getAnonClient, extractBearerToken } from '@/lib/supabase-user-server'
import { signReauthToken } from '@/lib/reauth-token'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type Body = { password?: unknown }

/**
 * POST /api/me/reauth
 *
 * Ré-authentification serveur : l'expert re-saisit son mot de passe. On le
 * VÉRIFIE côté serveur (signInWithPassword sur un client anon jetable) puis
 * on émet un grant HMAC court (5 min) lié à son uid. Les routes sensibles
 * (email, téléphone, mot de passe, suppression) exigent ce grant dans le
 * header `x-reauth-token`.
 *
 * On ne renvoie JAMAIS la session créée par signInWithPassword (client
 * jetable, persistSession:false) — seule la validité du mot de passe compte.
 */
export async function POST(request: NextRequest): Promise<Response> {
  // MOUCHARD TEMP — présence des secrets (jamais la valeur)
  console.log('[MOUCHARD reauth] secret present:', Boolean(process.env.REAUTH_HMAC_SECRET), 'len:', (process.env.REAUTH_HMAC_SECRET || '').length, '| jwt fallback:', Boolean(process.env.SUPABASE_JWT_SECRET))

  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) {
      console.log('[MOUCHARD reauth] requireAuth a échoué → status:', err.status, 'code:', err.body.code) // MOUCHARD TEMP
      return err.toResponse()
    }
    throw err
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const password = typeof body.password === 'string' ? body.password : ''
  if (password.length < 1 || password.length > 200) {
    return json({ error: 'Password required', code: 'invalid_input' }, 400)
  }

  // Email courant LIVE depuis l'auth (et non le miroir public.users.email, qui
  // peut être périmé tant qu'un changement d'email n'est pas confirmé). On le
  // lit via le JWT de la requête → toujours l'email réellement actif côté Auth.
  const accessToken = extractBearerToken(request)
  if (!accessToken) {
    return json({ error: 'Not authenticated', code: 'no_token' }, 401)
  }
  const { data: liveUser, error: liveErr } = await auth.supabaseAdmin.auth.getUser(accessToken)
  const email = liveUser?.user?.email
  if (liveErr || !email) {
    return json({ error: 'User not found', code: 'user_missing' }, 404)
  }

  console.log('[MOUCHARD reauth] email utilisé pour signInWithPassword:', email) // MOUCHARD TEMP

  const anon = getAnonClient()
  const { error: signErr } = await anon.auth.signInWithPassword({
    email,
    password,
  })
  // MOUCHARD TEMP — résultat de la vérif mot de passe (jamais le mot de passe)
  console.log('[MOUCHARD reauth] signInWithPassword:', signErr ? `ÉCHEC → ${signErr.message}` : 'SUCCÈS')
  if (signErr) {
    await logAudit({
      supabaseAdmin: auth.supabaseAdmin,
      user_id: auth.user.id,
      domain_id: auth.user.domain_id,
      action: 'reauth_failed',
      entity_type: 'user',
      entity_id: auth.user.id,
    })
    console.log('[MOUCHARD reauth] sortie → status: 401 code: invalid_password') // MOUCHARD TEMP
    return json({ error: 'Invalid password', code: 'invalid_password' }, 401)
  }

  // MOUCHARD TEMP — signReauthToken peut throw si secret absent/trop court
  let reauth_token: string
  try {
    reauth_token = signReauthToken({ uid: auth.user.id })
    console.log('[MOUCHARD reauth] signReauthToken: SUCCÈS') // MOUCHARD TEMP
  } catch (signTokenErr) {
    // MOUCHARD TEMP — on logge le message du throw puis on re-throw (comportement INCHANGÉ → 500)
    console.log('[MOUCHARD reauth] signReauthToken: THROW →', signTokenErr instanceof Error ? signTokenErr.message : String(signTokenErr))
    console.log('[MOUCHARD reauth] sortie → status: 500 (throw non capturé par la route, géré par Next)') // MOUCHARD TEMP
    throw signTokenErr
  }
  console.log('[MOUCHARD reauth] sortie → status: 200 (token émis)') // MOUCHARD TEMP
  return json({ reauth_token, expires_in: 300 }, 200)
}
