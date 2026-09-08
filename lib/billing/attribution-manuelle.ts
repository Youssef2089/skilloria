import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * lib/billing/attribution-manuelle.ts — ON N'ÉCRASE PAS UN ABONNEMENT PAYÉ.
 *
 * ┌─ CE QUE CE GARDE-FOU EMPÊCHE ───────────────────────────────────────────┐
 * │ Le back-office peut attribuer une offre à la main — c'est fait pour les  │
 * │ comptes pilotes, à qui l'on ouvre des droits sans paiement. Rien n'y     │
 * │ vérifiait si l'organisation avait DÉJÀ un abonnement Stripe.             │
 * │                                                                          │
 * │ Sur une organisation qui paie, l'écriture manuelle produit deux dégâts,  │
 * │ dans cet ordre :                                                         │
 * │   1. l'offre change immédiatement — l'organisation gagne ou perd des     │
 * │      droits sans que rien n'ait été facturé ni remboursé ;               │
 * │   2. le prochain événement Stripe la réécrit — l'admin voit donc son     │
 * │      geste s'annuler tout seul, sans explication.                        │
 * │                                                                          │
 * │ Aucun des deux ne lève d'erreur. Le second efface même la trace du       │
 * │ premier.                                                                 │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ AU SERVEUR, ET NULLE PART AILLEURS ────────────────────────────────────┐
 * │ La garde vit dans les ROUTES, avant l'écriture. Griser un bouton au      │
 * │ back-office ne garderait rien : un POST direct sur la route passerait.   │
 * │ C'est aussi pourquoi elle est ici, partagée — DEUX routes écrivent       │
 * │ `organizations.package_id`, et une garde posée dans une seule se         │
 * │ contourne par l'autre.                                                   │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ « Vivant » se juge sur `package_valid_until`, la MÊME donnée que lit le
 *    moteur de droits — jamais sur le statut Stripe, qui n'est chez nous que de
 *    l'affichage. Une organisation en période de grâce a un abonnement vivant :
 *    lui écraser son offre lui retirerait ce qu'elle a payé.
 */

export type EtatAbonnement = {
  organizationId: string
  stripeSubscriptionId: string | null
  packageValidUntil: string | null
}

/**
 * Les organisations, parmi celles données, qui portent un abonnement Stripe
 * VIVANT. Une seule requête, quel qu'en soit le nombre : la route d'attribution
 * en passe une, celle de migration en passe des centaines.
 */
export async function organisationsAbonnees(
  admin: SupabaseClient,
  organizationIds: string[],
): Promise<EtatAbonnement[]> {
  if (organizationIds.length === 0) return []
  const { data, error } = await admin
    .from('organizations')
    .select('id, stripe_subscription_id, package_valid_until')
    .in('id', organizationIds)
    .not('stripe_subscription_id', 'is', null)
  if (error) throw new Error(`lecture organizations: ${error.message}`)

  const maintenant = Date.now()
  return ((data ?? []) as {
    id: string
    stripe_subscription_id: string | null
    package_valid_until: string | null
  }[])
    .filter(
      (o) =>
        // Sans échéance = abonnement permanent, donc vivant. Avec échéance,
        // vivant tant qu'elle n'est pas passée — période de grâce comprise.
        o.package_valid_until == null ||
        new Date(o.package_valid_until).getTime() > maintenant,
    )
    .map((o) => ({
      organizationId: o.id,
      stripeSubscriptionId: o.stripe_subscription_id,
      packageValidUntil: o.package_valid_until,
    }))
}

/** Vrai si CETTE organisation ne peut pas voir son offre écrasée à la main. */
export async function abonnementStripeVivant(
  admin: SupabaseClient,
  organizationId: string,
): Promise<boolean> {
  return (await organisationsAbonnees(admin, [organizationId])).length > 0
}
