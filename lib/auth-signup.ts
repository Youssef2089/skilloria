import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * lib/auth-signup.ts — briques d'inscription serveur PARTAGÉES entre
 * register-org et register-expert. Extraites pour ne pas dupliquer les deux
 * pièges les plus coûteux du parcours org (cf. historique git) :
 *
 *  P1 — signUpWithConfirmation : `admin.createUser` / `admin.generateLink`
 *       n'envoient PAS l'email de confirmation (endpoints admin silencieux par
 *       design GoTrue). SEUL `auth.signUp` sur un client ANON serveur déclenche
 *       le SMTP. (bug 4a1d9ae)
 *  P3 — atomicCleanup : `auth.admin.deleteUser` ne CASCADE PAS sur public.users.
 *       Un signUp réussi puis un échec en aval laisse public.users (+ enfants)
 *       orphelins, ce qui BLOQUE les ré-inscriptions (users_email_key). Cleanup
 *       ordonné obligatoire, chaque delete dans son propre try/catch, jamais de
 *       re-throw. (bugs 71e7210 / e741bf0)
 */

/** Client ANON serveur — le SEUL qui déclenche l'email de confirmation (P1). */
function getSupabaseAnon(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('missing_env')
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export type SignUpResult =
  | { ok: true; userId: string }
  | { ok: false; code: 'email_taken' | 'create_user_failed' | 'missing_env'; message: string }

/**
 * Crée le compte auth.users via `auth.signUp` (P1) — déclenche l'email de
 * confirmation SMTP. Le trigger `handle_new_user` matérialise ensuite
 * public.users (+ public.profiles pour role expert/cdi) de façon transparente.
 *
 * `metadata` alimente `raw_user_meta_data` lu par le trigger (role, domain_slug,
 * firstname, lastname, specialty…). L'appelant reste responsable de la suite
 * (flags phone, org, cleanup) — cette fonction ne fait QUE la création auth.
 */
export async function signUpWithConfirmation(args: {
  email: string
  password: string
  metadata: Record<string, string>
  emailRedirectTo?: string | null
}): Promise<SignUpResult> {
  let anon: SupabaseClient
  try {
    anon = getSupabaseAnon()
  } catch {
    return { ok: false, code: 'missing_env', message: 'Server misconfigured' }
  }

  const { data, error } = await anon.auth.signUp({
    email: args.email,
    password: args.password,
    options: {
      ...(args.emailRedirectTo ? { emailRedirectTo: args.emailRedirectTo } : {}),
      data: args.metadata,
    },
  })

  if (error || !data?.user) {
    // GoTrue renvoie une erreur explicite si l'email est déjà pris
    // (users_email_key). On la mappe pour un message utilisateur propre.
    const msg = (error?.message ?? '').toLowerCase()
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      return { ok: false, code: 'email_taken', message: error?.message ?? 'Email already used' }
    }
    return { ok: false, code: 'create_user_failed', message: error?.message ?? 'Could not create user' }
  }

  return { ok: true, userId: data.user.id }
}

/**
 * Cleanup atomique après un signUp réussi mais un échec en aval (P3).
 *
 * Ordre STRICT : `extraDeletes` (parent-first, ex. organizations pour l'org)
 * PUIS public.users PUIS auth.users. Chaque suppression dans son propre
 * try/catch — un cleanup qui échoue ne doit pas empêcher les suivants. Ne lève
 * JAMAIS : l'appelant reste maître de la réponse d'erreur typée (un re-throw
 * ferait renvoyer à Next un 500 sans corps JSON).
 *
 * `extraDeletes` : suppressions métier ordonnées à jouer AVANT public.users
 * (register-org y passe la suppression de l'organization ; register-expert
 * n'en a aucune — le profil part en CASCADE avec public.users).
 */
export async function atomicCleanup(
  supabaseAdmin: SupabaseClient,
  args: {
    userId: string
    extraDeletes?: Array<{ label: string; run: () => Promise<{ error: unknown } | void> }>
  },
): Promise<void> {
  // 1. Suppressions métier parent-first (ex. organizations → CASCADE members/domains).
  for (const step of args.extraDeletes ?? []) {
    try {
      const res = await step.run()
      if (res && res.error) {
        console.error(`[auth-signup:cleanup] ${step.label} failed`, res.error)
      }
    } catch (err) {
      console.error(`[auth-signup:cleanup] ${step.label} threw`, err instanceof Error ? err.message : String(err))
    }
  }

  // 2. public.users (créé par le trigger). CASCADE emporte organization_members,
  //    session_logs, profiles… selon les FK ON DELETE CASCADE.
  try {
    const { error } = await supabaseAdmin.from('users').delete().eq('id', args.userId)
    if (error) console.error('[auth-signup:cleanup] public.users failed', error.message)
  } catch (err) {
    console.error('[auth-signup:cleanup] public.users threw', err instanceof Error ? err.message : String(err))
  }

  // 3. auth.users (Supabase Auth). Ne cascade PAS sur public.* — d'où l'étape 2.
  try {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(args.userId)
    if (error) console.error('[auth-signup:cleanup] auth.users failed', error.message)
  } catch (err) {
    console.error('[auth-signup:cleanup] auth.users threw', err instanceof Error ? err.message : String(err))
  }
}

/** `true` si l'erreur Supabase/Postgres est une violation d'unicité (23505). */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return code === '23505'
}
