import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { requireReauth } from '@/lib/reauth-token'
import { extractBearerToken, getUserScopedClient } from '@/lib/supabase-user-server'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type Body = { new_email?: unknown }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * POST /api/me/email — changer l'email (mission S3, section 2).
 *
 * VOIE NATIVE SUPABASE « Secure email change » (décision A1) : on appelle
 * `auth.updateUser({ email })` DANS LA SESSION de l'user (client user-scoped
 * = clé anon + son Bearer). Supabase envoie alors les emails de confirmation
 * (ancien + nouvel email selon le réglage « Secure email change » du projet) ;
 * la bascule de l'email n'a lieu qu'APRÈS confirmation. JAMAIS un UPDATE direct
 * de colonne.
 *
 * Ré-auth EXIGÉE en renfort (header x-reauth-token) — non contournable.
 * Borné à auth.uid().
 */
export async function POST(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const reauthFail = requireReauth(request, auth.user.id)
  if (reauthFail) return reauthFail

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const new_email = typeof body.new_email === 'string' ? body.new_email.trim().toLowerCase() : ''
  if (!EMAIL_RE.test(new_email) || new_email.length > 254) {
    return json({ error: 'Invalid email', code: 'invalid_email' }, 400)
  }

  const accessToken = extractBearerToken(request)
  if (!accessToken) {
    return json({ error: 'Not authenticated', code: 'no_token' }, 401)
  }

  // Flux natif : déclenche l'email de confirmation Supabase. La bascule réelle
  // se fait quand l'user clique le lien reçu (gérée par /auth/callback existant).
  const userClient = await getUserScopedClient(accessToken)
  const { error: updErr } = await userClient.auth.updateUser({ email: new_email })
  if (updErr) {
    // Email déjà pris / identique / rate-limit : message générique, pas de leak.
    console.error('[me/email] updateUser failed', updErr.message)
    const code =
      updErr.message.toLowerCase().includes('registered') ||
      updErr.message.toLowerCase().includes('already')
        ? 'email_taken'
        : 'email_change_failed'
    return json({ error: 'Could not change email', code }, 400)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.user.domain_id,
    action: 'email_change_requested',
    entity_type: 'user',
    entity_id: auth.user.id,
    detail: { new_email },
  })

  return json({ ok: true, confirmation_sent: true }, 200)
}
