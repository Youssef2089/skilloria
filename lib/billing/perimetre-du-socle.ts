/**
 * lib/billing/perimetre-du-socle.ts — CE QUE LE SOCLE STRIPE TRAITE.
 *
 * ⚠️ CE MODULE N'IMPORTE RIEN, ET C'EST SA RAISON D'ÊTRE.
 *
 *    Deux listes gouvernent l'encaissement : les six types d'événements que le
 *    socle sait traiter, et les statuts d'abonnement qui ouvrent des droits.
 *    Elles vivaient dans `lib/billing/events.ts` — qui importe le SDK Stripe et
 *    le client Supabase — et le module d'exploitation en tenait donc une COPIE,
 *    déclarée jumeau assumé (§E.20), parce que ses fichiers ne doivent porter
 *    AUCUN import exécutable : `diag-ecarts-stripe` les exécute en Node nu,
 *    sans base, sans réseau et sans chargeur d'alias (corollaire de §E.3).
 *
 *    Un contrôle qui compare deux copies empêche la divergence ; il ne supprime
 *    pas le jumeau. Ce fichier le supprime : une seule source, et elle reste
 *    atteignable des deux côtés parce qu'elle ne traîne aucune dépendance.
 *
 *    **Ne rien importer ici est donc une CONTRAINTE, pas un style.** Le premier
 *    `import` exécutable ajouté dans ce fichier rendrait `diag-ecarts-stripe`
 *    inexécutable — ni vert ni rouge, et personne ne saurait depuis quand.
 */

/**
 * LES SIX TYPES D'ÉVÉNEMENTS QUE `handleStripeEvent` TRAITE.
 *
 * Le `switch` de `lib/billing/events.ts` ne se lit pas à l'exécution : cette
 * liste ne peut pas en être dérivée. Ce qui garantit qu'ils ne divergent pas est
 * `diag-ecarts-stripe`, qui confronte les deux — un contrôle, pas une promesse.
 */
export const TYPES_TRAITES = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
] as const

/**
 * LES STATUTS D'ABONNEMENT QUI OUVRENT DES DROITS.
 *
 * `past_due` en fait partie : la période de grâce est un choix produit — on ne
 * coupe pas l'accès au premier prélèvement refusé.
 */
export const STATUTS_OUVRANTS = ['active', 'trialing', 'past_due'] as const

export function ouvreDesDroits(statut: string | null | undefined): boolean {
  return statut != null && (STATUTS_OUVRANTS as readonly string[]).includes(statut)
}
