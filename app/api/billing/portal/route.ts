import { NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { billingEnabled } from '@/lib/billing/config'
import {
  isPurchaseError,
  loadOrgBillingState,
  requireBillingAdmin,
  stripeOrRefusal,
} from '@/lib/billing/purchase'
import { localeFromRequest } from '@/lib/billing/locale'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/billing/portal — ouvre le PORTAIL CLIENT Stripe.
 *
 * Réponse : { url } — l'appelant redirige le navigateur dessus.
 *
 * ┌─ CE QU'ON DÉLÈGUE, ET CE QU'ON GARDE ───────────────────────────────────┐
 * │ DÉLÉGUÉ au portail : le moyen de paiement, les factures, la             │
 * │   résiliation. Trois écrans qu'on n'écrit pas, et où l'enjeu de          │
 * │   conformité est réel — on ne veut ni manipuler une carte, ni           │
 * │   reconstruire une pile de factures.                                     │
 * │                                                                          │
 * │ GARDÉ chez nous : le CHANGEMENT D'OFFRE. C'est là que se joue la         │
 * │   conversion, et on veut maîtriser la présentation du catalogue. La      │
 * │   configuration du portail désactive donc explicitement cette section.   │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ LE PORTAIL NE CONNAÎT PAS NOS DROITS ──────────────────────────────────┐
 * │ Une résiliation faite depuis le portail ne change `organizations`       │
 * │ QUE PAR LE WEBHOOK. Le portail est une façade sur Stripe, jamais une     │
 * │ source de vérité pour nous. Cette route n'écrit donc rien non plus.      │
 * └────────────────────────────────────────────────────────────────────────┘
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Marqueur de NOTRE configuration de portail, pour la retrouver sans la stocker. */
const CONFIG_TAG = 'skilloria_portal'
const CONFIG_VERSION = 'v1'

/**
 * La configuration du portail, créée au besoin.
 *
 * ┌─ POURQUOI EN CODE, ET PAS DANS LE TABLEAU DE BORD STRIPE ───────────────┐
 * │ « Le changement d'offre reste chez nous » est une décision PRODUIT. La   │
 * │ laisser reposer sur une case cochée dans une interface tierce, qu'un     │
 * │ tiers peut décocher sans que rien ne le signale, reviendrait à ne pas    │
 * │ l'avoir prise. Ici, elle est écrite, relisible et versionnée.            │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Retrouvée par sa métadonnée plutôt que stockée en base : même procédé que la
 * synchronisation du catalogue, et cela évite une colonne de plus pour un
 * identifiant que Stripe détient déjà.
 */
async function ensurePortalConfiguration(stripe: Stripe): Promise<string> {
  const existing = await stripe.billingPortal.configurations.list({ limit: 100, active: true })
  const found = existing.data.find((c) => c.metadata?.[CONFIG_TAG] === CONFIG_VERSION)
  if (found) return found.id

  const created = await stripe.billingPortal.configurations.create({
    business_profile: {},
    features: {
      // Ce qu'on délègue.
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      customer_update: {
        enabled: true,
        // L'adresse de facturation et le numéro de TVA vivent chez Stripe : le
        // client doit pouvoir les corriger sans passer par nous.
        allowed_updates: ['address', 'tax_id', 'email', 'name'],
      },
      subscription_cancel: {
        enabled: true,
        // FIN DE PÉRIODE, jamais immédiat : le client a payé son mois, il le
        // garde. Aucun remboursement au libre-service — une résiliation
        // immédiate reste une action d'administration.
        mode: 'at_period_end',
      },
      // Ce qu'on GARDE : le changement d'offre ne se fait pas ici.
      subscription_update: { enabled: false },
    },
    metadata: { [CONFIG_TAG]: CONFIG_VERSION },
  })
  return created.id
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  if (!billingEnabled()) {
    return json({ error: 'Billing disabled', code: 'billing_disabled' }, 503)
  }

  // Gérer le moyen de paiement et résilier engagent l'organisation autant que
  // souscrire : même garde, même rôle.
  const guard = requireBillingAdmin(auth)
  if (isPurchaseError(guard)) {
    return json({ error: guard.message, code: guard.code }, 403)
  }

  const handle = stripeOrRefusal()
  if (!handle.ok) return json(handle.body, handle.status)

  try {
    const state = await loadOrgBillingState(auth.supabaseAdmin, guard.organizationId)
    if (!state.stripeCustomerId) {
      // Aucun client Stripe = aucun paiement n'a jamais été engagé. On n'en crée
      // pas un pour l'occasion : il n'y aurait ni facture, ni moyen de paiement,
      // ni abonnement à montrer — un écran vide, et un client Stripe orphelin.
      return json(
        { error: 'Aucun dossier de facturation', code: 'no_customer' },
        409,
      )
    }

    const locale = localeFromRequest(request)
    const session = await handle.stripe.billingPortal.sessions.create({
      customer: state.stripeCustomerId,
      configuration: await ensurePortalConfiguration(handle.stripe),
      // Retour sur l'écosystème d'où l'organisation est partie.
      return_url: `${request.nextUrl.origin}/${locale}/dashboard/entreprise/offre`,
      locale: locale as 'fr' | 'en' | 'es' | 'de',
    })

    return json({ url: session.url }, 200)
  } catch (err) {
    console.error('[billing:portal] échec', err instanceof Error ? err.message : err)
    return json({ error: 'Portal failed', code: 'portal_failed' }, 502)
  }
}
