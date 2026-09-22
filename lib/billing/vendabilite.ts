/**
 * lib/billing/vendabilite.ts — CE QUI SE VEND SE DÉCIDE SUR UNE INTENTION.
 *
 * ┌─ LA CASE « GRATUITE », PAS LE PRIX ─────────────────────────────────────┐
 * │ Une offre a quelque chose à relier chez Stripe si et seulement si elle   │
 * │ est **en vente** et **déclarée payante**. La décision se lit dans une    │
 * │ intention écrite — `packages.is_free` — et non plus dans une déduction.  │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POURQUOI LA DÉDUCTION NE SUFFISAIT PAS ────────────────────────────────┐
 * │ La règle a d'abord été « prix nul ou zéro ⇒ gratuite ». Exacte, et       │
 * │ IMPLICITE : l'intention n'était écrite nulle part.                       │
 * │                                                                          │
 * │ Conséquence, et elle se paie en argent : **une offre payante saisie à 0  │
 * │ par erreur sortait de la vente EN SILENCE** — aucun refus, aucune        │
 * │ alerte, elle cessait simplement d'être reliée, et le premier client qui  │
 * │ voulait y souscrire ne pouvait plus. Dans l'autre sens, rien n'empêchait │
 * │ une offre déclarée gratuite de porter un prix.                           │
 * │                                                                          │
 * │ L'intention se dit maintenant, et la BASE garantit qu'elle et le prix ne │
 * │ se contredisent jamais (`packages_gratuite_coherente`, dans les deux     │
 * │ sens). Le code n'a donc pas à re-vérifier le prix : ce serait une        │
 * │ seconde règle, qui divergerait de la première (§E.20, §E.31).            │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ CE QUI A DISPARU AVEC LE PRIX, ET POURQUOI C'EST JUSTE ────────────────┐
 * │ · `is_default` n'a jamais été un critère valide : la contrainte          │
 * │   `packages_default_must_be_free` dit désormais `is_default ⇒ is_free`,  │
 * │   donc une offre par défaut est écartée **parce qu'elle est gratuite**.  │
 * │ · `tarif_illisible` n'a plus lieu d'être : ce cas existait parce qu'on   │
 * │   lisait un nombre arrivé en chaîne depuis PostgREST. On ne lit plus de  │
 * │   nombre du tout. La cohérence du prix est garantie en base, et un       │
 * │   montant impossible à convertir est refusé **au moment de pousser**,    │
 * │   par `toMinorUnits`, avec sa propre erreur.                             │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ UNE SEULE IMPLÉMENTATION. La règle vivait en deux exemplaires — la
 *    synchronisation et l'écran d'exploitation — déjà différents sur le zéro.
 *    Deux jumeaux ne divergent pas le jour où on les écrit, mais le jour où
 *    l'un des deux est corrigé (§E.20).
 *
 * ⚠️ MODULE PUR — aucun import, aucun accès base. Le diagnostic l'EXÉCUTE, il
 *    ne relit pas une copie de la règle (§E.33).
 */

/** Ce que la décision a besoin de savoir d'une offre. Rien de plus. */
export type OffreAVendre = {
  /** L'intention DÉCLARÉE : cette offre est gratuite. Jamais déduite du prix. */
  is_free: boolean
  /** Retirée de la vente ? */
  active: boolean
}

export type Vendabilite =
  | { vendable: true }
  | { vendable: false; raison: 'gratuite' | 'inactive' }

/**
 * Cette offre a-t-elle quelque chose à relier chez Stripe ?
 *
 * L'ordre compte pour la RAISON, pas pour le verdict : une offre gratuite ET
 * retirée de la vente est d'abord « retirée de la vente », parce que c'est ce
 * qu'un administrateur vient de faire et ce qu'il s'attend à lire.
 */
export function vendabilite(offre: OffreAVendre): Vendabilite {
  if (!offre.active) return { vendable: false, raison: 'inactive' }
  if (offre.is_free) return { vendable: false, raison: 'gratuite' }
  return { vendable: true }
}

/** La raison, en clair, pour un écran ou un journal. */
export function raisonNonVendable(raison: Exclude<Vendabilite, { vendable: true }>['raison']): string {
  switch (raison) {
    case 'gratuite':
      return 'offre déclarée gratuite : rien à facturer, donc rien à relier'
    case 'inactive':
      return 'retirée de la vente'
  }
}
