import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveCatalogueKey } from '@/lib/billing/config'
import { syncPackage } from '@/lib/billing/catalogue'

/**
 * lib/billing/catalogue-guard.ts — LE CATALOGUE NE DIVERGE PAS DE STRIPE.
 *
 * ┌─ LA DÉCISION, ET CE QU'ELLE COÛTE ──────────────────────────────────────┐
 * │ Si la synchronisation vers Stripe échoue, on REFUSE la modification      │
 * │ locale. Deux prix différents des deux côtés est pire qu'un prix qu'on ne │
 * │ peut pas changer : le premier fait payer un montant que le back-office   │
 * │ n'affiche nulle part, le second se voit tout de suite et se réessaie.    │
 * │                                                                          │
 * │ Le prix à payer est assumé : quand Stripe est indisponible, le prix      │
 * │ n'est pas modifiable. C'est le bon compromis — on ne perd rien d'autre   │
 * │ qu'une minute.                                                           │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ PAS DE CLÉ : ON NE SYNCHRONISE PAS, ET ON N'EMPÊCHE RIEN ──────────────┐
 * │ Sans clé Stripe sur cet environnement, appliquer la règle telle quelle   │
 * │ GÈLERAIT LE BACK-OFFICE : synchro impossible, donc plus aucune           │
 * │ modification d'offre possible — l'exact contraire de « le commerce se    │
 * │ pilote depuis le back-office ».                                          │
 * │                                                                          │
 * │ Sans clé, on ne tente donc RIEN et la modification passe. Il n'y a aucune │
 * │ divergence possible avec un catalogue Stripe qui n'existe pas encore, et │
 * │ la cohérence se rétablira à la première synchro, idempotente.            │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ CE QUI A CHANGÉ LE 22/09/2026, ET POURQUOI ────────────────────────────┐
 * │ La condition était `billingEnabled()` — l'interrupteur d'ENCAISSEMENT.   │
 * │ Elle est devenue « une clé de catalogue valide », par §D.16 : relier     │
 * │ n'est pas encaisser.                                                     │
 * │                                                                          │
 * │ LA CONSÉQUENCE EST VOULUE ET ELLE COÛTE. Sur un environnement qui porte  │
 * │ une clé (le poste de développement, la recette), modifier un prix        │
 * │ POUSSE désormais vers Stripe, et un échec de Stripe REFUSE la            │
 * │ modification. C'est exactement la garantie que ce module existe pour     │
 * │ donner : sans elle, un catalogue relié divergerait dès la première       │
 * │ correction de tarif, en silence, et la divergence ne se verrait qu'au    │
 * │ premier paiement.                                                        │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ ORDRE DES ÉCRITURES, ET LE SEUL RÉSIDU POSSIBLE ───────────────────────┐
 * │ Stripe D'ABORD, la base ENSUITE. Le résidu possible est donc un `Price`  │
 * │ créé chez Stripe que rien ne référence — bénin, invisible du client,     │
 * │ archivable. L'ordre inverse laisserait un prix local que Stripe ignore : │
 * │ une organisation paierait un montant qui n'est plus affiché nulle part.  │
 * └────────────────────────────────────────────────────────────────────────┘
 */

/** Ce que la route doit faire ensuite. */
export type Synchro =
  | { ok: true; ignoree: true }
  | { ok: true; ignoree: false; raison: string }
  | { ok: false; raison: string }

/** Un changement touche-t-il ce qui est VENDU, donc ce que Stripe doit connaître ? */
export function toucheAuCatalogueStripe(champs: Record<string, unknown>): boolean {
  // `active` et `name` voyagent aussi : le Product Stripe porte le libellé, et
  // une offre retirée de la vente doit l'être des deux côtés.
  // `is_free` EN FAIT PARTIE : cocher la case retire l'offre de la vente chez
  // Stripe, la decocher l'y remet. C'est un changement de ce qui est VENDU.
  return ['price_monthly', 'price_yearly', 'currency', 'name', 'description', 'active', 'is_free'].some(
    (c) => c in champs,
  )
}

/**
 * Synchronise AVANT d'écrire, et dit à la route si elle peut poursuivre.
 *
 * `ignoree: true` = rien n'a été tenté (verrou fermé, ou changement qui ne
 * regarde pas Stripe). La route poursuit.
 * `ok: false` = Stripe a refusé ou n'a pas répondu. La route DOIT s'arrêter
 * sans rien écrire, et le dire.
 */
export async function synchroniserAvantEcriture(
  admin: SupabaseClient,
  packageId: string,
  voulu: Record<string, unknown>,
): Promise<Synchro> {
  if (!resolveCatalogueKey().ok) return { ok: true, ignoree: true }
  if (!toucheAuCatalogueStripe(voulu)) return { ok: true, ignoree: true }

  try {
    const out = await syncPackage(admin, packageId, {
      name: voulu.name as string | undefined,
      description: voulu.description as string | null | undefined,
      price_monthly: voulu.price_monthly as string | number | null | undefined,
      currency: voulu.currency as string | undefined,
      active: voulu.active as boolean | undefined,
      is_free: voulu.is_free as boolean | undefined,
    })
    if (out.ok) return { ok: true, ignoree: false, raison: out.result.actions.join(', ') }

    // Une offre NON VENDABLE — sans tarif, par défaut, ou inactive — n'est pas
    // un échec : il n'y a simplement rien à pousser. La modification passe.
    return { ok: true, ignoree: false, raison: `non vendable : ${out.refusal.reason}` }
  } catch (err) {
    // Stripe a refusé ou n'a pas répondu. C'est là, et seulement là, qu'on
    // refuse d'écrire.
    return { ok: false, raison: err instanceof Error ? err.message : String(err) }
  }
}
