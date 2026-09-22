import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * lib/billing/catalogue-stripe.ts — LE CATALOGUE STRIPE, PAR MODE.
 *
 * ┌─ UN IDENTIFIANT STRIPE N'EXISTE QUE DANS SON MODE ──────────────────────┐
 * │ Un `price_...` créé avec `sk_test_` n'existe PAS en mode live. Une seule │
 * │ colonne par période rendait donc le passage en production faux EN        │
 * │ SILENCE : le catalogue paraissait relié, et le premier paiement réel     │
 * │ serait sorti « prix hors catalogue » — un paiement encaissé que rien ne  │
 * │ sait rattacher à une offre.                                              │
 * │                                                                          │
 * │ LE MODE EST DONC DANS LA CLÉ PRIMAIRE, pas dans un suffixe de colonne.   │
 * │ Un lecteur qui l'oublie n'obtient pas « l'autre mode » : il obtient DEUX │
 * │ lignes, et doit trancher — donc savoir. La garde est une CLÉ, elle ne    │
 * │ dépend d'aucune discipline (§E.31, même arbitrage que §D.15).            │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ D'OÙ VIENT LE MODE, ET IL N'A PAS LA MÊME ORIGINE PARTOUT ─────────────┐
 * │ · Une action de CATALOGUE (synchroniser) agit avec UNE clé : son mode    │
 * │   est celui de cette clé — `modeDeLaCle(handle.live)`.                   │
 * │ · Le WEBHOOK ne choisit pas : l'événement porte `livemode`, et c'est LUI │
 * │   qui décide — `modeDeLEvenement(event.livemode)`. Lire le mode de la    │
 * │   clé serait supposer que l'endpoint et la clé sont accordés ; c'est     │
 * │   précisément ce qui casse quand on croise les deux tableaux de bord.    │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ CE MODULE EST LE SEUL À LIRE ET ÉCRIRE `packages_stripe`. Un second
 *    lecteur ailleurs ré-ouvrirait la question « quel mode ? » à chaque fois,
 *    et une fois sur deux la réponse serait implicite.
 */

/** Le mode d'un catalogue Stripe. Jamais une chaîne libre. */
export type ModeStripe = 'test' | 'live'

/** Le mode d'une clé, depuis son préfixe (déjà décodé par `resolveCatalogueKey`). */
export function modeDeLaCle(live: boolean): ModeStripe {
  return live ? 'live' : 'test'
}

/**
 * Le mode d'un ÉVÉNEMENT, depuis son `livemode`.
 *
 * Fonction distincte de `modeDeLaCle` alors qu'elle calcule la même chose :
 * leur ORIGINE diffère, et c'est tout l'enjeu. Les fusionner inviterait à
 * passer l'une pour l'autre — et un webhook qui lirait le mode de sa clé
 * accorderait des droits d'après le catalogue du mauvais catalogue.
 */
export function modeDeLEvenement(livemode: boolean): ModeStripe {
  return livemode ? 'live' : 'test'
}

export type LiaisonStripe = {
  packageId: string
  mode: ModeStripe
  productId: string
  priceIdMonthly: string | null
  priceIdYearly: string | null
}

const TABLE = 'packages_stripe'
const COLONNES = 'package_id, mode, product_id, price_id_monthly, price_id_yearly'

type Ligne = {
  package_id: string
  mode: ModeStripe
  product_id: string
  price_id_monthly: string | null
  price_id_yearly: string | null
}

const enLiaison = (r: Ligne): LiaisonStripe => ({
  packageId: r.package_id,
  mode: r.mode,
  productId: r.product_id,
  priceIdMonthly: r.price_id_monthly,
  priceIdYearly: r.price_id_yearly,
})

/** La liaison d'une offre DANS UN MODE. `null` = pas encore reliée dans ce mode. */
export async function lireLiaison(
  admin: SupabaseClient,
  packageId: string,
  mode: ModeStripe,
): Promise<LiaisonStripe | null> {
  const { data, error } = await admin
    .from(TABLE)
    .select(COLONNES)
    .eq('package_id', packageId)
    .eq('mode', mode)
    .maybeSingle()
  if (error) throw new Error(`lecture ${TABLE}: ${error.message}`)
  return data ? enLiaison(data as unknown as Ligne) : null
}

/**
 * Écrit la liaison d'une offre dans un mode.
 *
 * `upsert` sur la clé (package_id, mode) : rejouer la synchronisation ne crée
 * pas une seconde ligne, elle met la première à jour — et **ne touche jamais**
 * la ligne de l'autre mode.
 */
export async function ecrireLiaison(
  admin: SupabaseClient,
  liaison: {
    packageId: string
    mode: ModeStripe
    productId: string
    priceIdMonthly: string | null
  },
): Promise<void> {
  const { error } = await admin.from(TABLE).upsert(
    {
      package_id: liaison.packageId,
      mode: liaison.mode,
      product_id: liaison.productId,
      price_id_monthly: liaison.priceIdMonthly,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'package_id,mode' },
  )
  if (error) throw new Error(`écriture ${TABLE}: ${error.message}`)
}

/**
 * Les offres portant cet identifiant de prix, DANS CE MODE.
 *
 * ⚠️ DEUX REQUÊTES PLUTÔT QU'UN EMBED, DÉLIBÉRÉMENT. Un embed PostgREST vers
 *    `packages` serait plus court — et il deviendrait AMBIGU le jour où une
 *    seconde clé étrangère relierait ces deux tables (§E.18), en cassant toutes
 *    les lectures d'un coup. Ce chemin est celui du webhook : il accorde des
 *    droits, il ne dépend de rien d'optionnel.
 *
 * Retourne la liste BRUTE : c'est l'appelant qui décide ce qu'« aucune » et
 * « plusieurs » signifient, parce que lui seul sait à qui il répond.
 */
export async function offresParPrix(
  admin: SupabaseClient,
  priceId: string,
  mode: ModeStripe,
): Promise<{ packageId: string }[]> {
  const { data, error } = await admin
    .from(TABLE)
    .select('package_id, price_id_monthly, price_id_yearly')
    .eq('mode', mode)
    .or(`price_id_monthly.eq.${priceId},price_id_yearly.eq.${priceId}`)
  if (error) throw new Error(`lecture ${TABLE}: ${error.message}`)
  return ((data ?? []) as { package_id: string }[]).map((r) => ({ packageId: r.package_id }))
}

/**
 * TOUTES les liaisons, TOUS modes confondus.
 *
 * Pour l'écran d'exploitation seulement : il doit dire ce qui est relié dans le
 * mode COURANT **et** ce qui ne l'est pas dans l'autre — sinon on découvre le
 * jour de la bascule que la production n'a jamais été reliée.
 */
export async function lireToutesLesLiaisons(admin: SupabaseClient): Promise<LiaisonStripe[]> {
  const { data, error } = await admin.from(TABLE).select(COLONNES)
  if (error) throw new Error(`lecture ${TABLE}: ${error.message}`)
  return ((data ?? []) as unknown as Ligne[]).map(enLiaison)
}
