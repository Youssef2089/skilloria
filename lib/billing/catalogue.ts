import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getStripeCatalogue, toMinorUnits } from '@/lib/billing/stripe'
import {
  ecrireLiaison,
  lireLiaison,
  modeDeLaCle,
  type LiaisonStripe,
  type ModeStripe,
} from '@/lib/billing/catalogue-stripe'
import { META_PACKAGE_SLUG } from '@/lib/billing/resolve'
import { cleProduit, clePrix } from '@/lib/billing/idempotence'
import { raisonNonVendable, vendabilite } from '@/lib/billing/vendabilite'

/**
 * lib/billing/catalogue.ts — SYNCHRONISATION SORTANTE, JAMAIS ENTRANTE.
 *
 * ┌─ LE CATALOGUE SKILLORIA FAIT AUTORITÉ ──────────────────────────────────┐
 * │ Le prix est écrit au back-office. Ce module le POUSSE vers Stripe et     │
 * │ range les identifiants obtenus dans `packages_stripe`, CLÉS PAR MODE.    │
 * │                                                                          │
 * │ On ne LIT JAMAIS un prix depuis Stripe pour en déduire quoi que ce soit. │
 * │ Le seul montant lu chez Stripe l'est pour COMPARER et détecter une       │
 * │ dérive — jamais pour l'écrire en base, jamais pour l'afficher. Stripe     │
 * │ est un moyen d'encaisser, pas une source de vérité produit.              │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ LES PRIX STRIPE SONT IMMUABLES ────────────────────────────────────────┐
 * │ On n'édite pas un `Price` : on en crée un NOUVEAU et on archive l'ancien. │
 * │ Conséquence VOULUE : les abonnements en cours restent sur l'ancien prix. │
 * │ C'est le grand-père tarifaire (décision produit n°2), et c'est aussi la  │
 * │ protection juridique — on ne change pas le prix d'un contrat en cours.   │
 * │                                                                          │
 * │ Corollaire à ne pas oublier au Lot 4 : deux clients d'une même offre     │
 * │ peuvent payer deux prix différents. L'écran admin d'une organisation     │
 * │ doit donc afficher le prix RÉELLEMENT FACTURÉ (transactions), pas le     │
 * │ prix catalogue — sinon le back-office ment.                             │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ CE MODULE EST BRANCHÉ SUR TROIS CHEMINS, et la nuance compte :
 *    · `create-package` — CRÉER une offre payante la relie DANS LA MÊME ACTION,
 *      et si Stripe refuse, l'offre créée est SUPPRIMÉE : elle n'existe jamais
 *      à moitié ;
 *    · `update-package` — modifier prix, devise, nom ou mise en vente
 *      synchronise AVANT d'écrire, et refuse d'écrire si Stripe refuse ;
 *    · `/api/admin/synchroniser-catalogue` — le RATTRAPAGE : les offres créées
 *      quand aucune clé n'était présente, et le passage en production.
 *    Aucune offre ne se relie donc à la main au quotidien (§D.16).
 */

export type SyncResult = {
  packageId: string
  slug: string
  /**
   * LE MODE DANS LEQUEL CETTE SYNCHRO A EU LIEU.
   *
   * Il fait partie du résultat, et pas seulement du stockage : un rapport qui
   * dit « 4 offres reliées » sans dire DANS QUEL MODE est exactement le
   * silence qui rendait le passage en production faux.
   */
  mode: ModeStripe
  /** Ce qui a réellement changé chez Stripe. */
  actions: string[]
  productId: string
  priceIdMonthly: string | null
}

export type SyncRefusal = { packageId: string; slug: string; reason: string }

type PackageRow = {
  id: string
  slug: string
  name: string
  description: string | null
  price_monthly: string | number | null
  currency: string
  is_default: boolean
  /** L'intention DÉCLARÉE. C'est elle qui décide, jamais le prix (§D.18). */
  is_free: boolean
  active: boolean
  target_role: string
}

/**
 * ⚠️ PLUS AUCUNE COLONNE `stripe_*` ICI. Elles ont été supprimées de `packages`
 *    par la migration `catalogue_stripe_par_mode` : les identifiants vivent
 *    dans `packages_stripe`, clés PAR MODE. Une colonne sans mode ne pouvait
 *    pas dire si son contenu existait en test ou en live.
 */
const COLUMNS =
  'id, slug, name, description, price_monthly, currency, is_default, is_free, active, target_role'

/**
 * Une offre est-elle VENDABLE ?
 *
 * ⚠️ LA RÈGLE N'EST PLUS ÉCRITE ICI, ELLE EST DÉLÉGUÉE — et c'est le point.
 *    Elle vivait aussi dans l'écran d'exploitation, en DEUX exemplaires écrits
 *    le même jour, et déjà différents sur le cas du prix nul. Deux jumeaux ne
 *    divergent pas quand on les écrit : ils divergent quand on corrige l'un
 *    des deux (§E.20). La divergence aurait fait dire à l'écran « rien à
 *    relier » sur une offre que cette fonction poussait.
 *
 *    La règle, sa raison et le sort de `is_default` vivent désormais dans
 *    [lib/billing/vendabilite.ts](./vendabilite.ts), module pur.
 *
 * ⚠️ `is_default` A DISPARU DU CRITÈRE, ET RIEN N'A CHANGÉ : la contrainte
 *    `packages_default_must_be_free` impose qu'une offre par défaut soit
 *    gratuite, donc le prix l'écarte déjà. Ce qui rendait la collaboration
 *    vendable sans code (décision produit n°8) tient toujours — et tient
 *    MIEUX : il suffit de lui poser un prix positif.
 */
function sellability(pkg: PackageRow): { ok: true } | { ok: false; reason: string } {
  const v = vendabilite({ is_free: pkg.is_free, active: pkg.active })
  return v.vendable ? { ok: true } : { ok: false, reason: raisonNonVendable(v.raison) }
}

/**
 * Product Stripe miroir de l'offre. Idempotent sur le produit DÉJÀ LIÉ dans ce
 * mode d'abord, puis sur la métadonnée de slug — le slug est en LECTURE SEULE
 * après création au back-office, c'est donc une clé de rapprochement stable.
 */
async function ensureProduct(
  stripe: Stripe,
  pkg: PackageRow,
  liaison: LiaisonStripe | null,
  actions: string[],
): Promise<string> {
  if (liaison?.productId) {
    await stripe.products.update(liaison.productId, {
      name: pkg.name,
      description: pkg.description ?? undefined,
      active: pkg.active,
    })
    actions.push('product mis à jour')
    return liaison.productId
  }

  // RÉCUPÉRATION LONGUE, et non protection contre les doublons.
  //
  //  Un product a pu être créé lors d'une synchro interrompue avant l'écriture
  //  en base. Cette recherche le retrouve — mais elle ne garantit RIEN sur le
  //  court terme : l'index de recherche de Stripe est différé d'environ une
  //  minute, il ne voit pas un produit créé quelques secondes plus tôt.
  //
  //  Ce n'est donc plus elle qui empêche le doublon : c'est la clé
  //  d'idempotence, juste en dessous. Elle reste ici pour le SEUL cas qu'une
  //  clé ne couvre pas — un orphelin découvert plus de 24 h après, au-delà de
  //  la fenêtre de mémorisation de Stripe.
  const found = await stripe.products.search({
    query: `metadata['${META_PACKAGE_SLUG}']:'${pkg.slug}'`,
    limit: 2,
  })
  if (found.data.length === 1) {
    actions.push('product existant retrouvé par métadonnée')
    return found.data[0].id
  }

  // LA CLÉ FERME LA COURSE. Deux synchros concurrentes de la même offre
  // présentent la même clé dérivée : Stripe renvoie l'objet de la première au
  // lieu d'en créer un second. Voir lib/billing/idempotence.
  const created = await stripe.products.create(
    {
      name: pkg.name,
      description: pkg.description ?? undefined,
      metadata: { [META_PACKAGE_SLUG]: pkg.slug, skilloria_target_role: pkg.target_role },
    },
    { idempotencyKey: cleProduit(pkg) },
  )
  actions.push('product créé')
  return created.id
}

/**
 * Price Stripe pour la cadence mensuelle.
 *
 * Si un prix existe et que son montant correspond DÉJÀ au catalogue, on ne
 * touche à rien — la synchro est rejouable sans créer de prix à chaque passage.
 * Sinon on crée le nouveau puis on archive l'ancien, DANS CET ORDRE : si
 * l'archivage échoue, on a un prix en trop (bénin, corrigeable) plutôt qu'une
 * offre sans aucun prix vendable (bloquant).
 *
 * La cadence annuelle est DORMANTE (décision produit n°4) : la colonne existe,
 * aucune offre ne la renseigne, ce module ne la pousse pas.
 */
async function ensureMonthlyPrice(
  stripe: Stripe,
  pkg: PackageRow,
  productId: string,
  liaison: LiaisonStripe | null,
  actions: string[],
): Promise<string> {
  const minor = toMinorUnits(pkg.price_monthly as number | string, pkg.currency)
  if (!minor.ok) throw new Error(`offre '${pkg.slug}' : ${minor.reason}`)

  const connu = liaison?.priceIdMonthly ?? null
  if (connu) {
    const existing = await stripe.prices.retrieve(connu)
    // Comparaison SEULEMENT : ce montant ne sera jamais écrit en base.
    const sameAmount = existing.unit_amount === minor.value
    const sameCurrency = (existing.currency ?? '').toUpperCase() === pkg.currency.toUpperCase()
    if (existing.active && sameAmount && sameCurrency) {
      actions.push('price inchangé')
      return connu
    }
  }

  // Clé dérivée du produit, de la devise et du MONTANT : rejouer la même
  // synchro ne crée pas un second prix identique (le défaut survenait dès que
  // l'écriture en base échouait après la création), tandis qu'un changement de
  // tarif donne une clé différente — donc bien un nouveau Price, comme le veut
  // le grand-père tarifaire.
  const created = await stripe.prices.create(
    {
      product: productId,
      currency: pkg.currency.toLowerCase(),
      unit_amount: minor.value,
      recurring: { interval: 'month' },
      metadata: { [META_PACKAGE_SLUG]: pkg.slug },
    },
    {
      idempotencyKey: clePrix({
        slug: pkg.slug,
        productId,
        currency: pkg.currency,
        unitAmount: minor.value,
      }),
    },
  )
  actions.push(`price créé (${minor.value} ${pkg.currency})`)

  if (connu && connu !== created.id) {
    // Archivé APRÈS création du remplaçant. Les abonnements en cours restent
    // rattachés au prix archivé et continuent d'être facturés à ce montant :
    // c'est exactement le grand-père tarifaire.
    await stripe.prices.update(connu, { active: false })
    actions.push('ancien price archivé (abonnements en cours préservés)')
  }
  return created.id
}

/**
 * Synchronise UNE offre du catalogue vers Stripe.
 *
 * Retourne une REFUS explicite (et non une erreur) quand l'offre n'est pas
 * vendable : ce n'est pas une panne, c'est une décision du catalogue.
 */
export async function syncPackage(
  admin: SupabaseClient,
  packageId: string,
  /**
   * Valeurs VOULUES, quand la synchro précède l'écriture locale.
   *
   * ┌─ POURQUOI CE PARAMÈTRE EXISTE ──────────────────────────────────────┐
   * │ La règle est : REFUSER la modification locale si la synchro échoue —  │
   * │ deux prix différents des deux côtés est pire qu'un prix qu'on ne peut │
   * │ pas changer. Pour tenir cette règle il faut synchroniser AVANT        │
   * │ d'écrire ; or à cet instant la base porte encore l'ANCIEN prix, et    │
   * │ une synchro qui la relit pousserait donc l'ancien.                    │
   * │                                                                        │
   * │ D'où ces valeurs passées explicitement. Sans elles, la règle serait   │
   * │ « écrire puis synchroniser », et un échec laisserait précisément la   │
   * │ divergence qu'on veut interdire.                                      │
   * └──────────────────────────────────────────────────────────────────────┘
   */
  voulu?: Partial<
    Pick<PackageRow, 'name' | 'description' | 'price_monthly' | 'currency' | 'active' | 'is_free'>
  >,
): Promise<{ ok: true; result: SyncResult } | { ok: false; refusal: SyncRefusal }> {
  const handle = getStripeCatalogue()
  if (!handle.ok) {
    return { ok: false, refusal: { packageId, slug: '?', reason: handle.detail } }
  }

  const { data, error } = await admin.from('packages').select(COLUMNS).eq('id', packageId).maybeSingle()
  if (error) throw new Error(`lecture packages: ${error.message}`)
  if (!data) return { ok: false, refusal: { packageId, slug: '?', reason: 'offre introuvable' } }

  const pkg = { ...(data as unknown as PackageRow), ...(voulu ?? {}) }
  const sellable = sellability(pkg)
  if (!sellable.ok) {
    return { ok: false, refusal: { packageId, slug: pkg.slug, reason: sellable.reason } }
  }

  // ⚠️ LE MODE VIENT DE LA CLÉ QUI VA AGIR, ET DE RIEN D'AUTRE. C'est elle qui
  //    va créer les objets chez Stripe : leurs identifiants n'existeront que
  //    dans son mode. Le déduire d'ailleurs (une variable, l'environnement)
  //    reviendrait à ranger un identifiant de test dans le catalogue live.
  const mode = modeDeLaCle(handle.live)
  const liaison = await lireLiaison(admin, pkg.id, mode)

  const actions: string[] = []
  const productId = await ensureProduct(handle.stripe, pkg, liaison, actions)
  const priceId = await ensureMonthlyPrice(handle.stripe, pkg, productId, liaison, actions)

  // Écriture en base APRÈS Stripe : si Stripe échoue, la base n'a pas bougé et
  // la synchro est simplement rejouable. L'inverse laisserait des identifiants
  // pointant vers des objets inexistants.
  await ecrireLiaison(admin, {
    packageId: pkg.id,
    mode,
    productId,
    priceIdMonthly: priceId,
  })

  return {
    ok: true,
    result: { packageId: pkg.id, slug: pkg.slug, mode, actions, productId, priceIdMonthly: priceId },
  }
}

/**
 * Synchronise TOUTES les offres vendables du catalogue.
 *
 * Chaque offre est traitée indépendamment : l'échec de l'une n'empêche pas les
 * autres. Le résultat rend compte des trois issues — synchronisées, refusées
 * (non vendables), en échec — sans les confondre.
 */
export async function syncCatalogue(
  admin: SupabaseClient,
): Promise<{
  synced: SyncResult[]
  refused: SyncRefusal[]
  failed: { packageId: string; slug: string; error: string }[]
}> {
  const synced: SyncResult[] = []
  const refused: SyncRefusal[] = []
  const failed: { packageId: string; slug: string; error: string }[] = []

  const { data, error } = await admin.from('packages').select('id, slug')
  if (error) throw new Error(`lecture packages: ${error.message}`)

  for (const row of (data ?? []) as { id: string; slug: string }[]) {
    try {
      const out = await syncPackage(admin, row.id)
      if (out.ok) synced.push(out.result)
      else refused.push(out.refusal)
    } catch (err) {
      failed.push({
        packageId: row.id,
        slug: row.slug,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { synced, refused, failed }
}
