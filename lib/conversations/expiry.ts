// lib/conversations/expiry.ts
//
// FENÊTRE D'ÉCHANGE — à compter du déblocage.
//
// SOURCE UNIQUE de la règle temporelle côté conversation, exactement comme
// lib/publications/expiry.ts l'est côté annonce. Avant, la constante vivait en
// dur dans lib/unlock.ts (`15 * 24 * 60 * 60 * 1000`) et la lecture de
// l'expiration était réimplémentée dans chaque route (`isExpired()` local copié
// 2 fois). Toute lecture qui décide si un échange est encore ouvert DOIT passer
// par ce module.
//
// RÈGLE :
//   `conversations.expires_at` est ÉCRIT à la création (unlock) — contrairement
//   aux publications, la date existe donc réellement en base. Ce module ne
//   change rien à ça : il calcule la date à poser, et lit celle qui est posée.
//
//   expires_at NULL  ⇒ NON expirée (compat conversations legacy Lot 2c)
//   expires_at > now ⇒ NON expirée
//   sinon            ⇒ expirée (lecture seule ; l'écriture est refusée 409)
//
// ═══ LA DURÉE N'EST PLUS UNE CONSTANTE, ET ELLE N'A PLUS DE DÉFAUT ══════════
//   `CONVERSATION_TTL_DAYS = 15` a disparu. La durée vient de
//   `duree_reglages.fenetre_echange_jours`, lue par les routes.
//
// ═══ ET CE CHANGEMENT N'EST PAS RÉTROACTIF ══════════════════════════════════
//   Puisque la date est ÉCRITE au déblocage, une conversation déjà ouverte garde
//   la sienne : régler la fenêtre à 10 jours ne raccourcit AUCUN échange en
//   cours. C'est l'inverse exact de la vie d'une annonce, et la différence n'est
//   pas un choix d'implémentation qu'on pourrait revoir — c'est ce que veut dire
//   « une date écrite » contre « une règle appliquée à la lecture ».
//
//   Seul `isConversationExpired` ne prend donc PAS de durée : il lit une date
//   déjà posée. Les fonctions qui en POSENT ou en CALCULENT une l'exigent.

/** Ce que doit fournir tout appelant qui POSE ou CALCULE une fenêtre. */
export type ContexteFenetreEchange = {
  /** Fenêtre d'échange, en jours. Vient de `duree_reglages`, lue par la route. */
  fenetreEchangeJours: number
}

export function conversationTtlMs(ctx: ContexteFenetreEchange): number {
  return ctx.fenetreEchangeJours * 24 * 60 * 60 * 1000
}

/** Date d'expiration à poser à la création d'une conversation (unlock). */
export function conversationExpiryIso(ctx: ContexteFenetreEchange, from: Date = new Date()): string {
  return new Date(from.getTime() + conversationTtlMs(ctx)).toISOString()
}

/**
 * Prédicat de lecture. NULL ⇒ non expirée (cf. en-tête).
 *
 * AUCUNE DURÉE ICI, ET CE N'EST PAS UN OUBLI : la date est déjà écrite en base.
 * Lui passer la durée du jour pour recalculer serait précisément rendre la
 * fenêtre rétroactive, c'est-à-dire raccourcir un échange en cours qu'on a
 * promis à deux personnes.
 */
export function isConversationExpired(
  expiresAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return false
  return new Date(expiresAt).getTime() <= now.getTime()
}

/**
 * Fenêtre EFFECTIVE d'une conversation, pour l'affichage « ouvert jusqu'au … ».
 * Repli sur `unlocked_at + fenêtre` quand la conversation n'a pas (encore) de
 * ligne — la fenêtre reste calculable, jamais inventée. Ce repli-là CALCULE,
 * donc il exige la durée.
 */
export function effectiveConversationExpiry(
  input: {
    conversationExpiresAt?: string | null
    unlockedAt?: string | null
  },
  ctx: ContexteFenetreEchange,
): Date | null {
  if (input.conversationExpiresAt) return new Date(input.conversationExpiresAt)
  if (input.unlockedAt) {
    return new Date(new Date(input.unlockedAt).getTime() + conversationTtlMs(ctx))
  }
  return null
}
