import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Signature des avatars (M3) — bucket 'avatars' PRIVE.
 *
 * Ce module est le SEUL endroit qui génère une URL d'avatar. Toute URL avatar
 * servie au client passe par `signAvatarUrl` (URL signée courte, 300s). Le
 * client ne lit plus jamais l'avatar en direct (bucket privé, pas de policy
 * SELECT anon/authenticated).
 *
 * La GATE (qui a le droit de voir la photo) est décidée par l'APPELANT, au
 * point où il projette déjà `photo_url` conditionnellement (reveal_photo côté
 * org, contexte admin, propre photo). Ce helper ne fait QUE signer — il ne
 * réévalue aucune autorisation.
 */

/** Chemin storage déterministe de l'avatar d'un utilisateur. Source unique du chemin. */
export function avatarStoragePath(userId: string): string {
  return `${userId}/avatar.jpg`
}

/**
 * Signe l'URL de l'avatar d'un utilisateur (TTL 300s), via un client
 * service-role. Fail-safe : retourne `null` sur erreur/absence (jamais de
 * throw) — un avatar non signable => `null` => le front affiche le fallback
 * initiales.
 */
export async function signAvatarUrl(
  admin: SupabaseClient,
  userId: string,
): Promise<string | null> {
  if (!userId) return null
  try {
    const { data, error } = await admin.storage
      .from('avatars')
      .createSignedUrl(avatarStoragePath(userId), 300)
    if (error || !data?.signedUrl) return null
    return data.signedUrl
  } catch {
    return null
  }
}
