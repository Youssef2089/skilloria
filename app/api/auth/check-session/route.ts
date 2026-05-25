import { NextRequest } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/check-session
 *
 * Endpoint léger qui déclenche `requireAuth` (et donc la vérification 11F
 * cookie ss_token vs users.last_session_token) sans logique métier.
 *
 * Pourquoi cette route existe :
 *   Le mécanisme de session unique 11F (auth-guard.ts) ne s'active QUE lors
 *   d'un appel à une route /api/* protégée. Or les dashboards consomment
 *   leurs données via Supabase REST + RLS direct — donc auth-guard n'est
 *   JAMAIS sollicité tant que l'user reste sur le dashboard.
 *
 *   Trou de sécurité : un user éjecté par un autre login resterait
 *   connecté indéfiniment sur le dashboard.
 *
 *   Cette route est appelée périodiquement (toutes les 60s) par le
 *   composant <SessionHeartbeat /> via secureFetch — qui intercepte
 *   automatiquement le 403 `session_superseded` et redirige vers
 *   /connexion?reason=session_superseded.
 *
 * Comportement :
 *   - 200 { ok: true } si la session est valide
 *   - 401 { code: 'no_token' | 'invalid_token' } si Bearer manque/invalide
 *   - 403 { code: 'session_superseded' } si le cookie ne matche pas
 *     users.last_session_token (autre login a écrasé)
 *   - 403 { code: 'domain_mismatch' } si x-subdomain ne correspond pas
 *
 * Aucune mutation, aucun side-effect. Coût ≈ 1 SELECT users.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    await requireAuth(request)
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
}
