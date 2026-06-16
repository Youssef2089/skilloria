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
 *
 * IMPORTANT — pourquoi `setSession` et pas seulement le header Authorization :
 * les opérations `auth.*` de GoTrue (updateUser email/mot de passe) lisent la
 * SESSION INTERNE du client, PAS le header Authorization global (celui-ci ne
 * sert qu'aux requêtes PostgREST/`from()`). Sans session établie, `updateUser`
 * throw « Auth session missing! ». On injecte donc la session de l'utilisateur
 * à partir de son `access_token` (déjà validé par requireAuth en amont).
 *
 * `setSession` exige un `refresh_token` NON VIDE (contrôle du SDK) mais ne
 * l'utilise PAS tant que l'access_token n'est pas expiré (cas ici : token frais
 * issu de la requête) — il se contente de revalider l'access_token via /user.
 * D'où le placeholder constant : il n'est jamais consommé côté serveur.
 */
export async function getUserScopedClient(accessToken: string): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    throw new Error('Missing Supabase env (URL or ANON_KEY)')
  }
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
  const { error } = await client.auth.setSession({
    access_token: accessToken,
    refresh_token: 'server-no-refresh', // requis non-vide par le SDK ; jamais utilisé (token non expiré)
  })
  if (error) {
    throw new Error(`getUserScopedClient: setSession failed: ${error.message}`)
  }
  return client
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
