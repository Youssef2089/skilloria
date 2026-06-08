import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Client Supabase « user-scoped » côté SERVEUR (mission S3).
 *
 * Construit un client avec la clé ANON + le `Bearer <access_token>` de
 * l'utilisateur dans les headers. Toute opération `auth.*` (updateUser,
 * etc.) s'exécute alors DANS LA SESSION de l'utilisateur — exactement
 * comme si elle venait du navigateur, mais déclenchée depuis une route
 * serveur (donc non contournable + ré-auth vérifiée en amont).
 *
 * Pourquoi pas le client service-role (auth-guard) : `admin.updateUserById`
 * change l'email IMMÉDIATEMENT sans email de confirmation. Pour le
 * changement d'email on VEUT le flux natif « Secure email change » de
 * Supabase (double confirmation ancien + nouvel email) — déclenché
 * uniquement par `auth.updateUser({ email })` sur la session de l'user.
 */
export function getUserScopedClient(accessToken: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    throw new Error('Missing Supabase env (URL or ANON_KEY)')
  }
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}

/** Extrait l'access_token du header Authorization (Bearer). null si absent. */
export function extractBearerToken(request: Request): string | null {
  const h = request.headers.get('authorization') ?? request.headers.get('Authorization')
  if (!h) return null
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : null
}

/** Client anon « anonyme » (sans session) — pour signInWithPassword de vérif. */
export function getAnonClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    throw new Error('Missing Supabase env (URL or ANON_KEY)')
  }
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
