import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Helper centralisé pour logger une connexion dans `session_logs`.
 *
 * Best-effort : si l'insert échoue, on log un warning mais on ne propage
 * jamais l'erreur — un crash du logging ne doit pas faire échouer le login.
 *
 * Schéma (rappel) :
 *   session_logs(user_id, ip_address inet, user_agent text, login_at, session_token)
 *
 * C2 : la colonne `session_token` est write-only (jamais lue/comparée nulle
 * part). On a CESSÉ d'y écrire le token — on ne stocke plus aucun secret de
 * session dans `session_logs` (la colonne reste NULL). Le param
 * `session_token` est conservé pour compat d'appel mais n'est plus persisté.
 */
export type SessionLogParams = {
  supabaseAdmin: SupabaseClient
  user_id: string
  request: NextRequest | Request
  session_token?: string | null
}

function extractIp(request: NextRequest | Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    // x-forwarded-for peut contenir une chaîne "client, proxy1, proxy2"
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp.trim()
  return null
}

function extractUserAgent(request: NextRequest | Request): string | null {
  const ua = request.headers.get('user-agent')
  return ua ? ua.slice(0, 1000) : null
}

export async function logSession(params: SessionLogParams): Promise<void> {
  const { supabaseAdmin, user_id, request } = params

  try {
    const ip_address = extractIp(request)
    const user_agent = extractUserAgent(request)

    // C2 : on n'écrit PLUS le token de session (write-only, jamais lu) →
    // colonne `session_token` laissée NULL, aucun secret stocké.
    const { error } = await supabaseAdmin.from('session_logs').insert({
      user_id,
      ip_address,
      user_agent,
    })

    if (error) {
      console.error('[session-log] insert failed', {
        user_id,
        msg: error.message,
      })
    }
  } catch (err) {
    console.error('[session-log] insert threw', {
      user_id,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}
