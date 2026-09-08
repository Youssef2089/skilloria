import crypto from 'node:crypto'

/**
 * lib/billing/idempotence.ts — LES CLÉS D'IDEMPOTENCE DE LA SYNCHRO CATALOGUE.
 *
 * ┌─ CE QUE CETTE CLÉ EMPÊCHE ──────────────────────────────────────────────┐
 * │ Deux synchronisations quasi simultanées d'une offre JAMAIS synchronisée  │
 * │ créaient DEUX produits chez Stripe. Le rattrapage reposait sur           │
 * │ `products.search`, dont l'index est DIFFÉRÉ d'environ une minute : la    │
 * │ recherche ne voyait pas le produit créé quelques secondes plus tôt.      │
 * │                                                                          │
 * │ Une clé d'idempotence SUPPRIME la fenêtre au lieu de la contourner :     │
 * │ Stripe reconnaît la seconde requête et renvoie l'objet de la première,   │
 * │ sans rien créer. Il n'y a plus de course à perdre.                       │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ DÉRIVÉE ET STABLE, JAMAIS ALÉATOIRE ───────────────────────────────────┐
 * │ C'est toute la mécanique : deux appels concurrents ne se reconnaissent   │
 * │ QUE s'ils présentent la MÊME clé. Un UUID tiré au hasard, un horodatage, │
 * │ un compteur — tout ce qui diffère d'un appel à l'autre — redonnerait     │
 * │ deux créations distinctes, c'est-à-dire aucune protection.               │
 * │                                                                          │
 * │ Les clés sont donc calculées à partir des SEULES données qui décrivent   │
 * │ l'objet voulu. Mêmes entrées ⇒ même clé, toujours, sur n'importe quelle  │
 * │ machine.                                                                 │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POURQUOI LA CHARGE ENTRE DANS LA CLÉ DU PRODUIT ───────────────────────┐
 * │ Stripe REFUSE une clé déjà vue si les paramètres ont changé. Une clé     │
 * │ réduite au slug provoquerait donc une erreur dure dans ce cas réel :     │
 * │ synchro interrompue avant l'écriture en base, puis renommage de l'offre  │
 * │ au back-office, puis nouvelle synchro — même clé, autre nom, refus.      │
 * │                                                                          │
 * │ En intégrant le nom, la description et la cible, un renommage produit    │
 * │ une clé DIFFÉRENTE : pas d'erreur. Et deux appels CONCURRENTS, qui       │
 * │ lisent la même ligne, produisent la même — la course reste fermée.       │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ CE QUE LA CLÉ NE COUVRE PAS — à dire honnêtement ──────────────────────┐
 * │ Stripe ne mémorise une clé que 24 HEURES. Passé ce délai, la même clé    │
 * │ recrée un objet. Elle ferme donc la COURSE (quelques secondes), pas la   │
 * │ récupération d'un produit orphelin découvert des jours plus tard —       │
 * │ c'est pour ce seul cas que `products.search` reste sur le chemin.        │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Ce module n'importe QUE `node:crypto` : aucune dépendance, aucun appel
 * réseau, aucune lecture d'environnement. C'est ce qui le rend exécutable tel
 * quel par le diagnostic, qui prouve la stabilité des clés au lieu de la
 * supposer.
 */

/** Empreinte courte et déterministe d'une liste de valeurs. */
function empreinte(parties: (string | null | undefined)[]): string {
  // Le séparateur NUL ne peut apparaître dans aucune des valeurs : sans lui,
  // ('ab', 'c') et ('a', 'bc') donneraient la même empreinte.
  const brut = parties.map((p) => p ?? '').join('\u0000')
  return crypto.createHash('sha256').update(brut, 'utf8').digest('hex').slice(0, 16)
}

/**
 * Clé de création d'un Product Stripe.
 *
 * Le slug reste EN CLAIR : la clé apparaît dans les journaux Stripe, et on doit
 * pouvoir dire de quelle offre il s'agit sans rien déchiffrer.
 */
export function cleProduit(pkg: {
  slug: string
  name: string
  description: string | null
  target_role: string
}): string {
  return `skilloria:product:${pkg.slug}:${empreinte([pkg.name, pkg.description, pkg.target_role])}`
}

/**
 * Clé de création d'un Price Stripe.
 *
 * Composée de ce qui définit ÉCONOMIQUEMENT le prix : le produit porteur, la
 * devise et le montant. Deux conséquences voulues :
 *
 *  · rejouer la même synchro ne crée pas un second prix identique — le défaut
 *    survenait dès que l'écriture en base échouait après la création ;
 *  · CHANGER le tarif donne une clé différente, donc un nouveau Price. C'est
 *    exactement le grand-père tarifaire : les abonnements en cours restent sur
 *    l'ancien prix, qui est archivé et non modifié.
 *
 * `productId` en fait partie, et ce n'est pas décoratif : sans lui, la clé
 * pourrait renvoyer un prix rattaché à un produit orphelin d'une tentative
 * précédente, que la base ne référence pas.
 */
export function clePrix(args: {
  slug: string
  productId: string
  currency: string
  unitAmount: number
}): string {
  return `skilloria:price:${args.slug}:${args.productId}:${args.currency.toLowerCase()}:${args.unitAmount}`
}
