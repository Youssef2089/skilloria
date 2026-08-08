// lib/conversations/expiry.ts
//
// FENÊTRE D'ÉCHANGE — 15 jours à compter du déblocage.
//
// SOURCE UNIQUE de la règle temporelle côté conversation, exactement comme
// lib/publications/expiry.ts l'est côté annonce. Avant ce lot la constante
// vivait en dur dans lib/unlock.ts (`15 * 24 * 60 * 60 * 1000`) et la lecture
// de l'expiration était réimplémentée dans chaque route (`isExpired()` local
// copié 2 fois). Toute lecture qui décide si un échange est encore ouvert DOIT
// passer par ce module.
//
// RÈGLE :
//   `conversations.expires_at` est ÉCRIT à la création (unlock) — contrairement
//   aux publications, la date existe donc réellement en base. Ce module ne
//   change rien à ça : il expose la constante et le prédicat de lecture.
//
//   expires_at NULL  ⇒ NON expirée (compat conversations legacy Lot 2c)
//   expires_at > now ⇒ NON expirée
//   sinon            ⇒ expirée (lecture seule ; l'écriture est refusée 409)

export const CONVERSATION_TTL_DAYS = 15

export function conversationTtlMs(): number {
  return CONVERSATION_TTL_DAYS * 24 * 60 * 60 * 1000
}

/** Date d'expiration à poser à la création d'une conversation (unlock). */
export function conversationExpiryIso(from: Date = new Date()): string {
  return new Date(from.getTime() + conversationTtlMs()).toISOString()
}

/** Prédicat de lecture. NULL ⇒ non expirée (cf. en-tête). */
export function isConversationExpired(
  expiresAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return false
  return new Date(expiresAt).getTime() <= now.getTime()
}

/**
 * Fenêtre EFFECTIVE d'une conversation, pour l'affichage « ouvert jusqu'au … ».
 * Repli sur `unlocked_at + TTL` quand la conversation n'a pas (encore) de ligne
 * — la fenêtre reste calculable, jamais inventée.
 */
export function effectiveConversationExpiry(input: {
  conversationExpiresAt?: string | null
  unlockedAt?: string | null
}): Date | null {
  if (input.conversationExpiresAt) return new Date(input.conversationExpiresAt)
  if (input.unlockedAt) return new Date(new Date(input.unlockedAt).getTime() + conversationTtlMs())
  return null
}
