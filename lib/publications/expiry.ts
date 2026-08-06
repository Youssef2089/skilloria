// lib/publications/expiry.ts
//
// EXPIRATION DES PUBLICATIONS — 30 jours, CALCULÉE À LA LECTURE (aucun job, aucun
// batch, aucun statut basculé en base ; contrainte figée août 2026).
//
// SOURCE UNIQUE de la règle temporelle. Toute lecture qui décide si une
// publication est encore « active » DOIT passer par ce module — jamais
// reconstruire le filtre à la main (un site oublié = incohérence garantie).
//
// RÈGLE (pur read-time, décision produit) :
//   une publication `status='published'` est ACTIVE tant que
//     COALESCE(expires_at, published_at + 30 jours) > now()
//   On N'ÉCRIT JAMAIS expires_at (colonne laissée NULL) : le COALESCE traite
//   legacy et nouveau à l'identique. Le terme `expires_at` reste dans la règle
//   pour honorer un éventuel override manuel futur, sans le produire aujourd'hui.

export const PUBLICATION_TTL_DAYS = 30

function ttlMs(): number {
  return PUBLICATION_TTL_DAYS * 24 * 60 * 60 * 1000
}

/** now (ISO) + borne d'entrée « publié depuis moins de TTL » (now - TTL, ISO). */
export function activePublishedBounds(now: Date = new Date()): { nowIso: string; cutoffIso: string } {
  return {
    nowIso: now.toISOString(),
    cutoffIso: new Date(now.getTime() - ttlMs()).toISOString(),
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
export function activePublishedOrClause(now: Date = new Date()): string {
  const { nowIso, cutoffIso } = activePublishedBounds(now)
  return `expires_at.gt.${nowIso},and(expires_at.is.null,published_at.gt.${cutoffIso})`
}

/**
 * Prédicat JS équivalent — pour les lectures par id et la DÉRIVATION du statut
 * effectif (côté serveur uniquement, cf. point 20). Même règle, même constante.
 */
export function isActivePublished(
  row: { status?: string | null; expires_at?: string | null; published_at?: string | null },
  now: Date = new Date(),
): boolean {
  if (row.status !== 'published') return false
  if (row.expires_at) return new Date(row.expires_at).getTime() > now.getTime()
  if (!row.published_at) return false
  return new Date(row.published_at).getTime() + ttlMs() > now.getTime()
}

/**
 * Date d'expiration EFFECTIVE d'une publication (affichage / avertissement).
 * `null` si non calculable (pas de published_at). Ne lit jamais un statut.
 */
export function effectiveExpiry(
  row: { expires_at?: string | null; published_at?: string | null },
): Date | null {
  if (row.expires_at) return new Date(row.expires_at)
  if (row.published_at) return new Date(new Date(row.published_at).getTime() + ttlMs())
  return null
}
