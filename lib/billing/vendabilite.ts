/**
 * lib/billing/vendabilite.ts — CE QUI SE VEND SE DÉCIDE SUR LE PRIX.
 *
 * ┌─ LA PROPRIÉTÉ, JAMAIS LE NOM NI LE STATUT ──────────────────────────────┐
 * │ Une offre a quelque chose à relier chez Stripe **si et seulement si on   │
 * │ peut la facturer** : elle est en vente, et son prix mensuel est          │
 * │ strictement positif. Rien d'autre n'entre dans la décision — ni le slug, │
 * │ ni le nom, ni le fait d'être l'offre par défaut.                         │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POURQUOI `is_default` A DISPARU DU CRITÈRE ────────────────────────────┐
 * │ Il y était, et il était REDONDANT : la contrainte de base                │
 * │ `packages_default_must_be_free` impose                                   │
 * │ `is_default ⇒ coalesce(price_monthly, 0) = 0`. Toute offre par défaut    │
 * │ est donc déjà gratuite, donc déjà écartée par le prix.                    │
 * │                                                                          │
 * │ Le garder faisait croire que le STATUT décide, alors que c'est le PRIX.  │
 * │ Et cette croyance a un coût : elle laissait penser que « free » et       │
 * │ « collaboration » sont des cas particuliers, alors qu'une offre payante  │
 * │ qu'on rendrait gratuite demain doit sortir de la vente **toute seule**.  │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ ZÉRO EST GRATUIT, ET N'A DONC RIEN À RELIER ───────────────────────────┐
 * │ `price_monthly = 0` était traité comme « gratuite ET vendable » : la     │
 * │ synchronisation aurait créé chez Stripe un abonnement récurrent à 0,00 € │
 * │ — un objet qui n'encaisse rien, qu'aucun parcours n'ouvre, et qui        │
 * │ apparaîtrait pourtant dans le catalogue Stripe comme une offre réelle.   │
 * │                                                                          │
 * │ Décision de Youssef, 22/09/2026 : **une offre gratuite n'a rien à        │
 * │ relier, quelle qu'elle soit** — que son prix soit `NULL` ou `0`.         │
 * │ Le commentaire de colonne qui disait l'inverse est corrigé par la        │
 * │ migration `commentaire_offre_gratuite`.                                  │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ UNE SEULE IMPLÉMENTATION, ET C'EST TOUT L'OBJET DE CE FICHIER. La règle
 *    vivait en DEUX exemplaires — dans la synchronisation et dans l'écran
 *    d'exploitation — écrits le même jour, déjà différents sur le zéro. Deux
 *    jumeaux ne divergent pas le jour où on les écrit : ils divergent le jour
 *    où l'un des deux est corrigé (§E.20). Ici, la divergence aurait fait dire
 *    à l'écran « rien à relier » sur une offre que la synchro poussait.
 *
 * ⚠️ MODULE PUR — aucun import, aucun accès base. Le diagnostic l'EXÉCUTE, il
 *    ne relit pas une copie de la règle (§E.33).
 */

/** Ce que la décision a besoin de savoir d'une offre. Rien de plus. */
export type OffreAVendre = {
  /** Unité MAJEURE (euros). `null` = aucun tarif défini. */
  price_monthly: string | number | null
  /** Retirée de la vente ? */
  active: boolean
}

export type Vendabilite =
  | { vendable: true }
  | { vendable: false; raison: 'gratuite' | 'inactive' | 'tarif_illisible' }

/**
 * Cette offre a-t-elle quelque chose à relier chez Stripe ?
 *
 * ⚠️ UN TARIF ILLISIBLE N'EST PAS UNE OFFRE GRATUITE. `Number('abc')` rend
 *    `NaN`, et `NaN > 0` est `false` : confondu avec zéro, un tarif corrompu
 *    sortirait SILENCIEUSEMENT de la vente. Il a donc sa propre raison, et
 *    l'écran la montre — c'est une donnée à corriger, pas une offre gratuite.
 */
export function vendabilite(offre: OffreAVendre): Vendabilite {
  if (!offre.active) return { vendable: false, raison: 'inactive' }
  if (offre.price_monthly === null) return { vendable: false, raison: 'gratuite' }

  const n = typeof offre.price_monthly === 'string' ? Number(offre.price_monthly) : offre.price_monthly
  if (!Number.isFinite(n)) return { vendable: false, raison: 'tarif_illisible' }
  if (n <= 0) return { vendable: false, raison: 'gratuite' }

  return { vendable: true }
}

/** La raison, en clair, pour un écran ou un journal. */
export function raisonNonVendable(raison: Exclude<Vendabilite, { vendable: true }>['raison']): string {
  switch (raison) {
    case 'gratuite':
      return 'offre gratuite : rien à facturer, donc rien à relier'
    case 'inactive':
      return 'retirée de la vente'
    case 'tarif_illisible':
      return 'tarif illisible — à corriger au catalogue'
  }
}
