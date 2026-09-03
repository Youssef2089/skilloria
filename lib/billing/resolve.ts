import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * lib/billing/resolve.ts — RÉSOUDRE, JAMAIS DEVINER.
 *
 * Un événement Stripe porte des identifiants Stripe. Pour agir, il faut les
 * traduire en identifiants Skilloria : quelle organisation, quel domaine,
 * quelle offre. Ce module ne fait que ça, et REFUSE explicitement chaque fois
 * que la traduction est ambiguë.
 *
 * ┌─ LE CATALOGUE LOCAL FAIT AUTORITÉ ──────────────────────────────────────┐
 * │ On traduit un `price` Stripe en offre Skilloria en cherchant l'offre     │
 * │ DONT ON A ÉCRIT l'identifiant de prix (synchronisation sortante). On ne  │
 * │ lit JAMAIS le montant, le nom ni les métadonnées du prix chez Stripe     │
 * │ pour en déduire quoi que ce soit : Stripe est un moyen d'encaisser, pas  │
 * │ une source de vérité produit.                                            │
 * └────────────────────────────────────────────────────────────────────────┘
 */

/** Clés de métadonnées posées par Skilloria sur les objets Stripe. */
export const META_ORGANIZATION = 'skilloria_organization_id'
export const META_DOMAIN = 'skilloria_domain_id'
export const META_USER = 'skilloria_user_id'
export const META_PACKAGE_SLUG = 'skilloria_package_slug'

export type ResolveFailure = { ok: false; reason: string }
export type Resolved<T> = { ok: true; value: T } | ResolveFailure

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/** Lit une métadonnée Stripe attendue comme UUID. Tout le reste → null. */
export function metaUuid(
  metadata: Stripe$Metadata | null | undefined,
  key: string,
): string | null {
  const raw = metadata?.[key]
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  return UUID.test(t) ? t : null
}

/** Forme minimale d'un sac de métadonnées Stripe, sans importer le SDK ici. */
export type Stripe$Metadata = Record<string, string | undefined>

/**
 * Extrait un identifiant Stripe d'un champ qui, selon la version d'API, est soit
 * une chaîne, soit l'objet développé.
 *
 * Ce n'est pas de la défiance envers le SDK : Stripe a réellement déplacé et
 * re-typé plusieurs de ces champs entre versions d'API (l'abonnement d'une
 * facture, la période d'un abonnement). Extraire prudemment coûte trois lignes
 * et évite qu'une montée de version fasse silencieusement retourner `undefined`.
 */
export function idOf(v: unknown): string | null {
  if (typeof v === 'string' && v) return v
  if (v && typeof v === 'object' && 'id' in v) {
    const id = (v as { id?: unknown }).id
    if (typeof id === 'string' && id) return id
  }
  return null
}

/**
 * ORGANISATION — deux canaux, posés tous les deux à la souscription (Lot 2) :
 *   1. les métadonnées de l'objet Stripe (Customer ET Subscription) ;
 *   2. `organizations.stripe_customer_id`, écrit à la fin du parcours d'achat.
 *
 * Les deux existent parce que l'ORDRE DE LIVRAISON N'EST PAS GARANTI : un
 * `customer.subscription.created` peut arriver AVANT le
 * `checkout.session.completed` qui attache le customer à l'organisation. Le
 * canal métadonnées, lui, ne dépend d'aucun événement antérieur — c'est celui
 * qui rend le traitement insensible au désordre.
 */
export async function resolveOrganization(
  admin: SupabaseClient,
  args: { metadata?: Stripe$Metadata | null; customerId?: string | null },
): Promise<Resolved<string>> {
  const fromMeta = metaUuid(args.metadata, META_ORGANIZATION)
  if (fromMeta) return { ok: true, value: fromMeta }

  if (args.customerId) {
    const { data, error } = await admin
      .from('organizations')
      .select('id')
      .eq('stripe_customer_id', args.customerId)
      .maybeSingle()
    if (error) return { ok: false, reason: `lecture organizations: ${error.message}` }
    if (data?.id) return { ok: true, value: data.id as string }
    return {
      ok: false,
      reason: `customer ${args.customerId} rattaché à aucune organisation, et aucune métadonnée ${META_ORGANIZATION}`,
    }
  }

  return { ok: false, reason: `ni métadonnée ${META_ORGANIZATION} ni customer sur l'événement` }
}

/**
 * ÉCOSYSTÈME D'ACHAT — contexte descriptif, jamais une règle.
 *
 * ┌─ CETTE FONCTION NE LIT AUCUNE TABLE, ET C'EST LE POINT ─────────────────┐
 * │ Elle résolvait auparavant l'écosystème en interrogeant                  │
 * │ `organization_domains`, et refusait quand la réponse était ambiguë.     │
 * │ Deux choses l'ont rendue fausse d'un coup :                             │
 * │                                                                          │
 * │  · L'abonnement N'A PLUS D'ÉCOSYSTÈME. Une organisation accède à tous   │
 * │    les écosystèmes actifs avec un seul abonnement partagé. Il n'y a     │
 * │    plus rien à résoudre pour accorder un droit.                         │
 * │                                                                          │
 * │  · `organization_domains` est une TRACE HISTORIQUE dont le commentaire  │
 * │    de table interdit de tirer une décision. Y lire l'écosystème d'un    │
 * │    paiement serait exactement l'usage proscrit.                         │
 * │                                                                          │
 * │ Et le refus sur ambiguïté était pire encore : il aurait BLOQUÉ          │
 * │ l'enregistrement d'un paiement réel au motif qu'on ne savait pas dire   │
 * │ d'où il venait. On ne refuse jamais de l'argent parce qu'il manque une  │
 * │ étiquette.                                                              │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Ne sert plus qu'à renseigner `transactions.domain_id`, colonne désormais
 * FACULTATIVE et purement descriptive. `null` est le cas NORMAL d'un
 * renouvellement automatique : douze mois après la souscription, un prélèvement
 * ne vient d'aucune page et d'aucun écosystème.
 */
export function purchaseEcosystem(metadata?: Stripe$Metadata | null): string | null {
  return metaUuid(metadata, META_DOMAIN)
}

/**
 * OFFRE — traduction d'un `price` Stripe en ligne du catalogue Skilloria.
 *
 * On cherche l'offre dont on a ÉCRIT l'identifiant de prix. Un prix inconnu du
 * catalogue n'est pas un cas à rattraper : c'est une dérive entre Stripe et le
 * catalogue, et elle doit se voir. L'appelant marque alors l'événement en échec
 * plutôt que d'accorder des droits au hasard.
 *
 * Les deux cadences sont interrogées bien que l'annuelle soit dormante
 * (décision produit n°4) : le jour où elle s'ouvre, la résolution fonctionne
 * sans modification.
 */
export async function resolvePackageByPrice(
  admin: SupabaseClient,
  priceId: string,
): Promise<Resolved<{ id: string; slug: string }>> {
  const { data, error } = await admin
    .from('packages')
    .select('id, slug, active, stripe_price_id_monthly, stripe_price_id_yearly')
    .or(`stripe_price_id_monthly.eq.${priceId},stripe_price_id_yearly.eq.${priceId}`)
  if (error) return { ok: false, reason: `lecture packages: ${error.message}` }

  const rows = (data ?? []) as { id: string; slug: string; active: boolean }[]
  if (rows.length === 0) {
    return { ok: false, reason: `price ${priceId} absent du catalogue Skilloria` }
  }
  if (rows.length > 1) {
    return { ok: false, reason: `price ${priceId} rattaché à ${rows.length} offres` }
  }

  // Une offre RETIRÉE DE LA VENTE reste honorée pour qui la paie déjà : couper
  // les droits d'un abonné parce que l'offre a quitté le catalogue serait lui
  // retirer ce qu'il paie. C'est le pendant du grand-père tarifaire.
  if (!rows[0].active) {
    console.warn(`[billing:resolve] offre '${rows[0].slug}' inactive au catalogue mais honorée (abonnement en cours)`)
  }
  return { ok: true, value: { id: rows[0].id, slug: rows[0].slug } }
}
