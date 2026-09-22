import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthContext } from '@/lib/auth-guard'
import { getStripe } from '@/lib/billing/stripe'
import { syncPackage } from '@/lib/billing/catalogue'
import { lireLiaison, modeDeLaCle } from '@/lib/billing/catalogue-stripe'
import { attachCustomer } from '@/lib/billing/apply'
import { META_DOMAIN, META_ORGANIZATION, META_PACKAGE_SLUG, META_USER } from '@/lib/billing/resolve'

/**
 * lib/billing/purchase.ts — LA MÉCANIQUE COMMUNE DU PARCOURS D'ACHAT.
 *
 * Souscrire, changer d'offre et ouvrir le portail partagent quatre besoins :
 * savoir QUI a le droit de payer, retrouver le CLIENT Stripe de l'organisation,
 * traduire une OFFRE du catalogue en prix Stripe, et construire des URL de
 * retour justes. Les trois routes se réduisent alors à leur décision propre.
 *
 * ┌─ AUCUNE DONNÉE DE CARTE NE PASSE PAR ICI ───────────────────────────────┐
 * │ Le parcours est du CHECKOUT HÉBERGÉ : on crée une session côté serveur, │
 * │ le navigateur part chez Stripe, revient. Aucun numéro de carte ne touche │
 * │ notre serveur ni notre DOM — on reste au périmètre PCI-DSS le plus       │
 * │ léger. Corollaire : le SDK NAVIGATEUR de Stripe est INUTILE, et il a été │
 * │ retiré des dépendances. Une bibliothèque cliente non utilisée sur un     │
 * │ projet qui les interdit ne doit pas rester.                              │
 * └────────────────────────────────────────────────────────────────────────┘
 */

/** Refus métier du parcours. Codes stables : ils partent dans les réponses. */
export type PurchaseRefusal =
  | 'no_organization'
  | 'not_org_admin'
  | 'org_not_approved'
  | 'package_not_found'
  | 'package_not_sellable'
  | 'already_subscribed'
  | 'no_subscription'
  | 'no_customer'
  | 'same_package'

export type PurchaseError = { code: PurchaseRefusal; message: string }

/**
 * QUI PEUT ENGAGER UNE DÉPENSE — garde SERVEUR.
 *
 * ┌─ ADMINISTRATEUR D'ORGANISATION, ET PERSONNE D'AUTRE ────────────────────┐
 * │ Pas `editor` : engager une dépense récurrente au nom d'une entreprise    │
 * │ n'est pas du même ordre qu'éditer une annonce. Le rôle `editor` a été    │
 * │ créé pour produire du contenu, pas pour signer.                          │
 * │                                                                          │
 * │ La garde est ICI, au serveur. Masquer le bouton ne garde rien : un POST  │
 * │ direct passerait. `auth.organization.role_in_org` est résolu par         │
 * │ `requireAuth` sur une adhésion ACTIVE — un membre suspendu n'a pas de    │
 * │ contexte d'organisation du tout.                                         │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * L'organisation doit aussi être APPROUVÉE : on n'encaisse pas l'abonnement
 * d'une entreprise dont la vérification n'a pas abouti.
 */
export function requireBillingAdmin(auth: AuthContext): { organizationId: string } | PurchaseError {
  const org = auth.organization
  if (!org) {
    return { code: 'no_organization', message: 'Aucune organisation dans le contexte.' }
  }
  if (org.role_in_org !== 'admin') {
    return {
      code: 'not_org_admin',
      message: "Seul un administrateur de l'organisation peut engager une dépense.",
    }
  }
  if (org.verification_status !== 'approved') {
    return { code: 'org_not_approved', message: "L'organisation n'est pas encore approuvée." }
  }
  return { organizationId: org.id }
}

export function isPurchaseError(v: unknown): v is PurchaseError {
  return typeof v === 'object' && v !== null && 'code' in v && 'message' in v
}

/** L'abonnement tel qu'il vit sur l'ORGANISATION (jamais sur le rattachement). */
export type OrgBillingState = {
  organizationId: string
  companyName: string | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  stripeSubscriptionStatus: string | null
  packageId: string | null
  packageValidUntil: string | null
}

export async function loadOrgBillingState(
  admin: SupabaseClient,
  organizationId: string,
): Promise<OrgBillingState> {
  const { data, error } = await admin
    .from('organizations')
    .select(
      'id, company_name, stripe_customer_id, stripe_subscription_id, stripe_subscription_status, package_id, package_valid_until',
    )
    .eq('id', organizationId)
    .maybeSingle()
  if (error) throw new Error(`lecture organizations: ${error.message}`)
  if (!data) throw new Error(`organisation ${organizationId} introuvable`)
  return {
    organizationId,
    companyName: (data.company_name as string | null) ?? null,
    stripeCustomerId: (data.stripe_customer_id as string | null) ?? null,
    stripeSubscriptionId: (data.stripe_subscription_id as string | null) ?? null,
    stripeSubscriptionStatus: (data.stripe_subscription_status as string | null) ?? null,
    packageId: (data.package_id as string | null) ?? null,
    packageValidUntil: (data.package_valid_until as string | null) ?? null,
  }
}

/**
 * Un abonnement est-il VIVANT ?
 *
 * Fondé sur `package_valid_until`, la même donnée que lit le moteur de droits —
 * pas sur le statut Stripe, qui n'est chez nous que de l'affichage. Un
 * abonnement `past_due` dont la grâce court encore est VIVANT : proposer une
 * nouvelle souscription à cette organisation créerait un doublon facturé.
 */
export function hasLiveSubscription(state: OrgBillingState): boolean {
  if (!state.stripeSubscriptionId) return false
  if (!state.packageValidUntil) return true
  return new Date(state.packageValidUntil).getTime() > Date.now()
}

/**
 * Le prix Stripe d'une offre du catalogue, en la SYNCHRONISANT si besoin.
 *
 * Le catalogue local fait autorité : si l'offre n'a pas encore d'identifiant de
 * prix, on la pousse vers Stripe plutôt que de refuser. La synchronisation est
 * idempotente, donc ce rattrapage ne crée rien en double — et il rend le
 * parcours d'achat autonome, sans dépendre d'une action de back-office
 * préalable qu'on aurait pu oublier.
 *
 * Un refus reste possible et il est explicite : une offre sans tarif, inactive,
 * ou par défaut n'est pas vendable (cf. lib/billing/catalogue.ts).
 */
export async function resolveSellablePrice(
  admin: SupabaseClient,
  packageId: string,
): Promise<{ priceId: string; slug: string } | PurchaseError> {
  const { data, error } = await admin
    .from('packages')
    .select('id, slug')
    .eq('id', packageId)
    .maybeSingle()
  if (error) throw new Error(`lecture packages: ${error.message}`)
  if (!data) return { code: 'package_not_found', message: 'Offre introuvable au catalogue.' }

  // ⚠️ LE MODE EST CELUI DE LA CLÉ QUI VA OUVRIR LA SESSION DE PAIEMENT.
  //    C'est le seul endroit où le mode de la clé est la bonne origine : on
  //    s'apprête à faire payer AVEC elle, donc le prix doit exister dans SON
  //    catalogue. (Le webhook, lui, prend le mode de l'événement — l'origine
  //    n'est pas la même parce que la question n'est pas la même.)
  const handle = getStripe()
  if (!handle.ok) return { code: 'package_not_sellable', message: handle.detail }
  const mode = modeDeLaCle(handle.live)

  const liaison = await lireLiaison(admin, packageId, mode)
  if (liaison?.priceIdMonthly) {
    return { priceId: liaison.priceIdMonthly, slug: data.slug as string }
  }

  const synced = await syncPackage(admin, packageId)
  if (!synced.ok) {
    return { code: 'package_not_sellable', message: synced.refusal.reason }
  }
  if (!synced.result.priceIdMonthly) {
    return { code: 'package_not_sellable', message: 'Aucun prix mensuel après synchronisation.' }
  }
  return { priceId: synced.result.priceIdMonthly, slug: synced.result.slug }
}

/**
 * Le Customer Stripe de l'organisation, créé au besoin.
 *
 * Créé AVANT la session de paiement, et non laissé à la charge de Checkout.
 * Deux raisons :
 *   · les métadonnées Skilloria sont posées à coup sûr, donc le webhook sait
 *     résoudre l'organisation dès le TOUT PREMIER événement — même si celui-ci
 *     arrive avant le retour du navigateur, ce qui est le cas nominal ;
 *   · le moyen de paiement est réutilisable d'un achat à l'autre.
 */
export async function ensureCustomer(
  admin: SupabaseClient,
  stripe: Stripe,
  state: OrgBillingState,
  actor: { userId: string; domainId: string },
): Promise<string> {
  if (state.stripeCustomerId) return state.stripeCustomerId

  // L'e-mail est lu ici plutôt que porté par le contexte d'auth, qui ne le
  // transporte pas. Il sert à Stripe pour l'envoi des reçus ; s'il manque,
  // Checkout le demandera de toute façon — on ne bloque pas un achat pour ça.
  const { data: u } = await admin
    .from('users')
    .select('email')
    .eq('id', actor.userId)
    .maybeSingle()

  const customer = await stripe.customers.create({
    name: state.companyName ?? undefined,
    email: (u?.email as string | null) ?? undefined,
    metadata: {
      [META_ORGANIZATION]: state.organizationId,
      [META_DOMAIN]: actor.domainId,
      [META_USER]: actor.userId,
    },
  })

  const attached = await attachCustomer(admin, state.organizationId, customer.id)
  if (!attached.ok) throw new Error(attached.reason)
  return customer.id
}

/**
 * Métadonnées posées sur la Session, le Customer ET la Subscription.
 *
 * Elles sont ce qui rend le webhook INSENSIBLE À L'ORDRE DE LIVRAISON : un
 * `customer.subscription.created` qui précéderait le
 * `checkout.session.completed` résout quand même son organisation, sans
 * dépendre d'aucun événement antérieur.
 */
export function purchaseMetadata(args: {
  organizationId: string
  domainId: string
  userId: string
  packageSlug?: string
}): Record<string, string> {
  const meta: Record<string, string> = {
    [META_ORGANIZATION]: args.organizationId,
    [META_DOMAIN]: args.domainId,
    [META_USER]: args.userId,
  }
  if (args.packageSlug) meta[META_PACKAGE_SLUG] = args.packageSlug
  return meta
}

/**
 * URL de retour, dérivées de l'ORIGINE DE LA REQUÊTE.
 *
 * Et non d'une variable d'environnement : l'organisation navigue sur l'un
 * quelconque des écosystèmes actifs, et doit revenir LÀ D'OÙ ELLE EST PARTIE.
 * Une URL figée la renverrait sur un autre sous-domaine — déroutant, et
 * contraire à la règle multi-écosystème.
 */
export function returnUrls(origin: string, locale: string): { success: string; cancel: string } {
  return {
    // Le jeton de session est laissé à Stripe : la route de retour ne s'en sert
    // que pour un message. Les DROITS viennent du webhook, jamais d'ici.
    success: `${origin}/api/billing/return?statut=succes&locale=${encodeURIComponent(locale)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel: `${origin}/api/billing/return?statut=annule&locale=${encodeURIComponent(locale)}`,
  }
}

/** Client Stripe sous verrous, ou la réponse 503 qui va avec. */
export function stripeOrRefusal():
  | { ok: true; stripe: Stripe }
  | { ok: false; status: number; body: { error: string; code: string } } {
  const handle = getStripe()
  if (handle.ok) return { ok: true, stripe: handle.stripe }
  console.warn('[billing:purchase]', handle.detail)
  return {
    ok: false,
    status: 503,
    body: { error: 'Billing unavailable', code: handle.code },
  }
}
