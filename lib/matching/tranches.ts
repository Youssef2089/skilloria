/**
 * lib/matching/tranches.ts — UNE LISTE D'IDENTIFIANTS NE TIENT PAS DANS UNE URL.
 *
 * ═══ LE MUR, ET OÙ IL TOMBE VRAIMENT ══════════════════════════════════════
 *   PostgREST reçoit ses filtres dans l'URL. Un `in.(…)` de N identifiants y
 *   écrit N × 37 caractères environ (36 pour un UUID, 1 pour la virgule), plus
 *   l'encodage. À 12 000 profils, c'est ~434 Ko de chaîne — pour une limite
 *   usuelle de 8 à 16 Ko côté serveur ou proxy.
 *
 *   LE MUR TOMBE DONC VERS 220 À 440 IDENTIFIANTS, pas à 12 000. Il est déjà
 *   atteignable, et rien ne le signale : la requête échoue en bloc, ou pire,
 *   est tronquée par un intermédiaire.
 *
 * ═══ LA TRANCHE ═══════════════════════════════════════════════════════════
 *   200 identifiants par requête, soit ~7,4 Ko de filtre : sous la plus basse
 *   des limites usuelles, avec de la marge pour le reste de l'URL. Plus petit
 *   multiplierait les allers-retours sans rien gagner ; plus grand rapprocherait
 *   du mur qu'on vient d'écarter.
 *
 * ⚠️ NE CONVIENT QU'AUX FILTRES POSITIFS (`in`). Un filtre NÉGATIF (`not in`)
 *    ne se découpe PAS ainsi : l'union de « pas dans A » et « pas dans B »
 *    réadmet ce que chaque moitié excluait. Là où l'exclusion doit être
 *    découpée, on la sort de la requête et on l'applique en mémoire.
 */

/**
 * Taille d'une tranche d'identifiants dans un filtre `in`.
 *
 * Écrite ici, une seule fois : trois requêtes du moteur en dépendent, et trois
 * valeurs qui divergent, c'est trois murs à des endroits différents.
 */
export const TAILLE_TRANCHE_IDS = 200

/** Découpe une liste en tranches de `taille` au plus. Jamais de tranche vide. */
export function enTranches<T>(items: readonly T[], taille: number): T[][] {
  if (taille <= 0) throw new Error('taille de tranche invalide')
  const out: T[][] = []
  for (let i = 0; i < items.length; i += taille) out.push(items.slice(i, i + taille))
  return out
}
