import Stripe from 'stripe'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { resolveBillingKey, type BillingRefusal } from '@/lib/billing/config'

/**
 * lib/billing/stripe.ts — LE CLIENT STRIPE, et rien d'autre.
 *
 * Un seul endroit construit un client Stripe, et il ne le construit QUE si les
 * deux verrous (lib/billing/config.ts) le permettent. Aucune route ne fait
 * `new Stripe(...)` directement : c'est ce qui garantit qu'aucun chemin ne
 * contourne le contrôle de cohérence clé/environnement.
 *
 * ⚠️ `apiVersion` n'est PAS passée. C'est délibéré : le SDK envoie alors la
 *    version d'API sur laquelle IL est figé (stripe@22). Le comportement est
 *    donc déterministe et lié au lockfile — mettre une chaîne à la main
 *    ajouterait une valeur à maintenir en double, qui dériverait du jour où le
 *    SDK bouge.
 */

let cached: { key: string; client: Stripe } | null = null

export type StripeHandle =
  | { ok: true; stripe: Stripe; live: boolean }
  | { ok: false; code: BillingRefusal; detail: string }

/**
 * Client Stripe, sous verrous. Mémoïsé PAR CLÉ : si la variable change (rotation
 * de clé, bascule d'environnement en preview), le cache est invalidé de
 * lui-même plutôt que de servir un client câblé sur l'ancienne.
 */
export function getStripe(): StripeHandle {
  const resolved = resolveBillingKey()
  if (!resolved.ok) return resolved

  if (cached?.key !== resolved.key) {
    cached = {
      key: resolved.key,
      client: new Stripe(resolved.key, {
        // Identifie Skilloria dans les journaux Stripe : indispensable quand on
        // cherche l'origine d'un appel depuis leur tableau de bord.
        appInfo: { name: 'Skilloria' },
        // Deux tentatives suffisent : au-delà, mieux vaut échouer et laisser
        // Stripe rejouer le webhook que retenir une fonction serverless.
        maxNetworkRetries: 2,
      }),
    }
  }
  return { ok: true, stripe: cached.client, live: resolved.live }
}

/**
 * Instance dédiée à la SEULE vérification de signature de webhook.
 *
 * `webhooks.constructEvent` est un calcul LOCAL : un HMAC-SHA256 du corps brut
 * avec le secret de l'ENDPOINT, passé en argument. Il ne fait aucun appel
 * réseau et n'utilise pas la clé d'API de l'instance. On peut donc vérifier une
 * signature même quand les verrous refusent une vraie clé — et c'est
 * nécessaire : mur fermé, on veut quand même AUTHENTIFIER puis JOURNALISER
 * l'événement, sinon on perdrait la trace de ce qui est arrivé pendant la
 * fermeture, sans pour autant enregistrer des corps non vérifiés.
 */
let verifierOnly: Stripe | null = null

export function getSignatureVerifier(): Stripe {
  const live = getStripe()
  if (live.ok) return live.stripe
  if (!verifierOnly) {
    // Clé inerte, jamais transmise à Stripe : seule la signature est calculée.
    verifierOnly = new Stripe('sk_test_verification_de_signature_uniquement', {
      appInfo: { name: 'Skilloria (signature)' },
    })
  }
  return verifierOnly
}

/**
 * Client Supabase service-role, pour les chemins SANS contexte d'auth.
 *
 * Le webhook est le seul appelant : son émetteur est Stripe, pas un
 * utilisateur, donc `requireAuth` n'a rien à valider. Même forme que le
 * `getSupabaseAdmin()` répété dans auth-guard / translations / get-domain-config.
 */
export function getBillingAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Variables Supabase manquantes (URL ou SERVICE_ROLE_KEY)')
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Euros → plus petite unité monétaire (centimes).
 *
 * ┌─ LA CONVERSION VIT ICI, ET NULLE PART AILLEURS ─────────────────────────┐
 * │ `packages.price_monthly` est un numeric(10,2) en unité MAJEURE (euros).  │
 * │ Stripe raisonne en ENTIERS de plus petite unité. Répartir ce « ×100 »    │
 * │ dans plusieurs fichiers, c'est se garantir qu'un jour l'un d'eux         │
 * │ arrondira autrement que les autres — sur de l'argent.                    │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * `Math.round` et non `Math.trunc` : 3.30 * 100 vaut 329.99999999999994 en
 * virgule flottante. Tronquer facturerait 3,29 €.
 *
 * Les devises SANS décimale (JPY, KRW…) ne sont PAS gérées : leur unité mineure
 * EST l'unité majeure, et appliquer ×100 facturerait cent fois trop. La V0 est
 * en EUR (décision produit n°10) ; toute autre devise est REFUSÉE plutôt que
 * convertie de travers.
 */
const DEUX_DECIMALES = new Set([
  'EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK',
])

export function toMinorUnits(
  amount: number | string,
  currency: string,
): { ok: true; value: number } | { ok: false; reason: string } {
  const code = (currency || '').trim().toUpperCase()
  if (!DEUX_DECIMALES.has(code)) {
    return {
      ok: false,
      reason: `devise '${code}' non gérée (conversion en unité mineure non établie)`,
    }
  }
  const n = typeof amount === 'string' ? Number(amount) : amount
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, reason: `montant invalide (${String(amount)})` }
  }
  return { ok: true, value: Math.round(n * 100) }
}

/**
 * Horodatage Stripe (secondes UNIX) → ISO 8601.
 *
 * Retourne null sur une valeur absente ou aberrante plutôt qu'une date de 1970 :
 * une date fausse écrite dans `package_valid_until` retirerait ses droits à une
 * organisation qui a payé.
 */
export function stripeTsToIso(ts: number | null | undefined): string | null {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return null
  return new Date(ts * 1000).toISOString()
}
