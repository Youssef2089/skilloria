// lib/publications/expiry.ts
//
// EXPIRATION DES PUBLICATIONS — CALCULÉE À LA LECTURE (aucun job, aucun batch,
// aucun statut basculé en base ; contrainte figée août 2026).
//
// SOURCE UNIQUE de la règle temporelle. Toute lecture qui décide si une
// publication est encore « active » DOIT passer par ce module — jamais
// reconstruire le filtre à la main (un site oublié = incohérence garantie).
//
// RÈGLE (pur read-time, décision produit) :
//   une publication `status='published'` est ACTIVE tant que
//     COALESCE(expires_at, published_at + vieAnnonceJours) > now()
//   On N'ÉCRIT JAMAIS expires_at (colonne laissée NULL) : le COALESCE traite
//   legacy et nouveau à l'identique. Le terme `expires_at` reste dans la règle
//   pour honorer un éventuel override manuel futur, sans le produire aujourd'hui.
//
// ═══ LA DURÉE N'EST PLUS UNE CONSTANTE, ET ELLE N'A PLUS DE DÉFAUT ══════════
//   `PUBLICATION_TTL_DAYS = 30` a disparu. La durée est réglée en base
//   (`duree_reglages.vie_annonce_jours`) et LUE PAR LES ROUTES, qui la passent
//   ici. Chaque fonction l'exige : `vieAnnonceJours` est un champ REQUIS.
//
//   Pourquoi pas un défaut « pour les cas simples » : un défaut aurait fait
//   deux sources de vérité, et la seconde se serait appliquée en silence
//   exactement là où personne n'aurait pensé à regarder. Un appel qui oublie la
//   durée ne compile pas — c'est le seul garde-fou qui ne s'oublie pas.
//
// ═══ CE CHANGEMENT EST RÉTROACTIF, ET C'EST STRUCTUREL ══════════════════════
//   Puisque `expires_at` n'est jamais écrit, l'activité se recalcule à CHAQUE
//   lecture. Baisser la durée expire donc immédiatement des annonces déjà
//   publiées. C'est l'inverse de la fenêtre d'échange (lib/conversations/expiry.ts),
//   dont la date EST écrite au déblocage. L'écran de réglage dit les deux.

/** Ce que tout lecteur de cette règle doit fournir. Aucun défaut, nulle part. */
export type ContexteExpiration = {
  /** Vie d'une annonce, en jours. Vient de `duree_reglages`, lue par la route. */
  vieAnnonceJours: number
  now?: Date
}

function ttlMs(vieAnnonceJours: number): number {
  return vieAnnonceJours * 24 * 60 * 60 * 1000
}

/** now (ISO) + borne d'entrée « publié depuis moins de TTL » (now - TTL, ISO). */
export function activePublishedBounds(ctx: ContexteExpiration): { nowIso: string; cutoffIso: string } {
  const now = ctx.now ?? new Date()
  return {
    nowIso: now.toISOString(),
    cutoffIso: new Date(now.getTime() - ttlMs(ctx.vieAnnonceJours)).toISOString(),
  }
}

/**
 * Clause PostgREST `.or(...)` exprimant « publication active », SANS COALESCE
 * (non disponible côté PostgREST) mais strictement équivalente :
 *   expires_at > now  OU  (expires_at IS NULL ET published_at > now - TTL)
 *
 * À combiner avec `.eq('status','published')`. Pour une ressource imbriquée
 * (jointure), passer l'option `{ referencedTable: 'publications' }` à `.or()`.
 */
export function activePublishedOrClause(ctx: ContexteExpiration): string {
  const { nowIso, cutoffIso } = activePublishedBounds(ctx)
  return `expires_at.gt.${nowIso},and(expires_at.is.null,published_at.gt.${cutoffIso})`
}

/**
 * Prédicat JS équivalent — pour les lectures par id et la DÉRIVATION du statut
 * effectif (côté serveur uniquement, cf. point 20). Même règle, même durée.
 */
export function isActivePublished(
  row: { status?: string | null; expires_at?: string | null; published_at?: string | null },
  ctx: ContexteExpiration,
): boolean {
  const now = ctx.now ?? new Date()
  if (row.status !== 'published') return false
  if (row.expires_at) return new Date(row.expires_at).getTime() > now.getTime()
  if (!row.published_at) return false
  return new Date(row.published_at).getTime() + ttlMs(ctx.vieAnnonceJours) > now.getTime()
}

/**
 * Date d'expiration EFFECTIVE d'une publication (affichage / avertissement).
 * `null` si non calculable (pas de published_at). Ne lit jamais un statut.
 */
export function effectiveExpiry(
  row: { expires_at?: string | null; published_at?: string | null },
  ctx: ContexteExpiration,
): Date | null {
  if (row.expires_at) return new Date(row.expires_at)
  if (row.published_at) {
    return new Date(new Date(row.published_at).getTime() + ttlMs(ctx.vieAnnonceJours))
  }
  return null
}
