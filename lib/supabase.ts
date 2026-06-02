import { createClient } from '@supabase/supabase-js'

/**
 * Client Supabase anon partagé côté navigateur ET côté composant client.
 *
 * Garde RUNTIME : si NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_ANON_KEY
 * manque ou est vide, on THROW au module-load avec un message clair.
 *
 * Pourquoi : les `!` TypeScript étaient de purs casts sans effet runtime —
 * si l'env était `undefined`/`""`, `createClient` recevait `undefined` comme
 * anon key, et toutes les requêtes /rest/v1/* partaient SANS l'en-tête
 * `apikey`, ce qui donnait un 500 PostgREST silencieux ("No API key found")
 * à la première lecture (e.g. `supabase.from('profiles')`).
 *
 * Avec la garde, le bundle client refuse de se charger → erreur immédiate
 * visible en console plutôt qu'un échec à mi-flow.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || supabaseUrl.trim() === '') {
  throw new Error(
    '[lib/supabase] NEXT_PUBLIC_SUPABASE_URL manquante ou vide dans .env.local — ' +
      'le client Supabase ne peut pas être instancié.',
  )
}
if (!supabaseAnonKey || supabaseAnonKey.trim() === '') {
  throw new Error(
    '[lib/supabase] NEXT_PUBLIC_SUPABASE_ANON_KEY manquante ou vide dans .env.local — ' +
      'supabase-js partirait sans en-tête apikey et toutes les requêtes /rest/v1/* ' +
      'donneraient un 500 "No API key found" côté PostgREST.',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
