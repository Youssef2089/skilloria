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
 *  P3 — le NETTOYAGE d'après-coup (`atomicCleanup`) est RETIRÉ (§D.27) : le compte
 *       et ce que sa voie crée (téléphone, CGU, organisation, appartenance,
 *       promotion) naissent dans la transaction de `handle_new_user`, sur une
 *       preuve signée par le serveur. Il n'y a plus d'« échec en aval » à défaire.
 *       Le piège qu'il fermait reste vrai et se relit dans git (bugs 71e7210 /
 *       e741bf0) : `auth.admin.deleteUser` ne cascade pas sur public.users.
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

/** `true` si l'erreur Supabase/Postgres est une violation d'unicité (23505). */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return code === '23505'
}
