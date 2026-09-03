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
 * « L'objet n'existe pas » — le cas NORMAL, et de loin le plus fréquent : la
 * plupart des comptes n'ont jamais déposé de photo.
 *
 * Il faut le distinguer de tout le reste, parce que les deux se ressemblent
 * vus d'ici : un stockage tombé et un compte sans photo produisent la même
 * absence d'URL. Sans cette distinction, ou bien on ne journalise rien — et
 * une panne de stockage est invisible pour toujours — ou bien on journalise
 * tout, et le signal disparaît sous le bruit d'un cas parfaitement banal.
 */
export function estObjetIntrouvable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const statut = (error as { status?: unknown; statusCode?: unknown }).status
    ?? (error as { statusCode?: unknown }).statusCode
  if (statut === 404 || statut === '404') return true
  const message = String((error as { message?: unknown }).message ?? '')
  return /not\s*found|does not exist|no such/i.test(message)
}

/**
 * Signe l'URL de l'avatar d'un utilisateur (TTL 300s), via un client
 * service-role.
 *
 * FAIL-SAFE INCHANGÉ : retourne `null` sur erreur comme sur absence, sans
 * jamais lever. Un avatar non signable ⇒ `null` ⇒ le front affiche les
 * initiales. Ce comportement est le bon et n'est pas modifié : une photo
 * manquante ne doit casser aucun écran.
 *
 * CE QUI CHANGE : la panne ne passe plus SOUS SILENCE. Auparavant, `if (error
 * || !data?.signedUrl) return null` traitait à l'identique un compte sans
 * photo et un stockage indisponible — sans une ligne de journal. Personne
 * n'aurait jamais su que le stockage était tombé : tous les avatars se
 * seraient simplement changés en initiales, ce qui a l'air normal.
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

    if (error) {
      if (!estObjetIntrouvable(error)) {
        console.error('[avatar] signature impossible — stockage en défaut', {
          userId,
          message: error.message,
        })
      }
      return null
    }
    if (!data?.signedUrl) {
      // Ni erreur ni URL : réponse incohérente du stockage. Jamais normal.
      console.error('[avatar] réponse sans URL signée', { userId })
      return null
    }
    return data.signedUrl
  } catch (err) {
    console.error('[avatar] exception pendant la signature', {
      userId,
      cause: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
