import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { billingEnabled } from '@/lib/billing/config'
import {
  ensureCustomer,
  hasLiveSubscription,
  isPurchaseError,
  loadOrgBillingState,
  purchaseMetadata,
  requireBillingAdmin,
  resolveSellablePrice,
  returnUrls,
  stripeOrRefusal,
} from '@/lib/billing/purchase'
import { localeFromRequest } from '@/lib/billing/locale'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/billing/checkout — ouvre une session de paiement HÉBERGÉE.
 *
 * Body : { package_id: uuid }
 * Réponse : { url } — l'appelant redirige le navigateur dessus.
 *
 * ┌─ CHECKOUT HÉBERGÉ, JAMAIS DE FORMULAIRE INTÉGRÉ ────────────────────────┐
 * │ Aucune donnée de carte ne touche ce serveur ni notre DOM : la saisie a   │
 * │ lieu chez Stripe. On reste au périmètre PCI-DSS le plus léger, et le SDK │
 * │ navigateur devient inutile — il a été retiré des dépendances.            │
 * │                                                                          │
 * │ Cette route ne renvoie qu'une URL. Elle n'accorde AUCUN droit : les      │
 * │ droits viennent du webhook, et de lui seul.                              │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ LE VERROU RESTE FERMÉ ─────────────────────────────────────────────────┐
 * │ Sans ENABLE_BILLING, ou sans clé cohérente avec l'environnement, on      │
 * │ répond 503. Le refus est au SERVEUR : masquer un bouton ne garde rien.   │
 * └────────────────────────────────────────────────────────────────────────┘
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export async function POST(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  // ── Verrou produit, AVANT toute autre chose ──────────────────────────────
  if (!billingEnabled()) {
    return json({ error: 'Billing disabled', code: 'billing_disabled' }, 503)
  }

  // ── Qui peut engager une dépense ─────────────────────────────────────────
  const guard = requireBillingAdmin(auth)
  if (isPurchaseError(guard)) {
    return json({ error: guard.message, code: guard.code }, 403)
  }

  let body: { package_id?: unknown }
  try {
    body = (await request.json()) as { package_id?: unknown }
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_body' }, 400)
  }
  const packageId = typeof body.package_id === 'string' ? body.package_id.trim() : ''
  if (!UUID.test(packageId)) {
    return json({ error: 'Invalid package_id', code: 'invalid_package_id' }, 400)
  }

  const handle = stripeOrRefusal()
  if (!handle.ok) return json(handle.body, handle.status)

  try {
    const state = await loadOrgBillingState(auth.supabaseAdmin, guard.organizationId)

    // ── Un seul abonnement à la fois ───────────────────────────────────────
    //  Fondé sur `package_valid_until`, la même donnée que lit le moteur de
    //  droits — pas sur le statut Stripe. Une organisation en période de grâce
    //  a un abonnement VIVANT : lui ouvrir un second parcours la ferait payer
    //  deux fois. Le changement d'offre a sa propre route.
    if (hasLiveSubscription(state)) {
      return json(
        {
          error: 'Organisation déjà abonnée',
          code: 'already_subscribed',
          hint: 'Utiliser /api/billing/change-plan pour changer d’offre.',
        },
        409,
      )
    }

    const price = await resolveSellablePrice(auth.supabaseAdmin, packageId)
    if (isPurchaseError(price)) {
      return json({ error: price.message, code: price.code }, price.code === 'package_not_found' ? 404 : 409)
    }

    const customerId = await ensureCustomer(auth.supabaseAdmin, handle.stripe, state, {
      userId: auth.user.id,
      domainId: auth.domain.id,
    })

    const locale = localeFromRequest(request)
    const urls = returnUrls(request.nextUrl.origin, locale)
    const metadata = purchaseMetadata({
      organizationId: guard.organizationId,
      domainId: auth.domain.id,
      userId: auth.user.id,
      packageSlug: price.slug,
    })

    const session = await handle.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: price.priceId, quantity: 1 }],
      // DEUX canaux de rattachement, posés ensemble : `client_reference_id` et
      // les métadonnées. Le webhook n'a alors besoin d'AUCUN événement
      // antérieur pour savoir de quelle organisation il parle — c'est ce qui le
      // rend insensible à l'ordre de livraison.
      client_reference_id: guard.organizationId,
      metadata,
      subscription_data: { metadata },
      success_url: urls.success,
      cancel_url: urls.cancel,
      // Stripe traduit son propre écran : aucune clé i18n à écrire de notre côté.
      locale: locale as 'fr' | 'en' | 'es' | 'de',
      // Collectées chez Stripe, pas chez nous : l'adresse de facturation et le
      // numéro de TVA manquent en base, et c'est très bien ainsi tant que
      // Stripe Tax n'est pas tranché.
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      allow_promotion_codes: true,
    })

    if (!session.url) {
      return json({ error: 'Session sans URL', code: 'checkout_no_url' }, 502)
    }
    return json({ url: session.url }, 200)
  } catch (err) {
    console.error('[billing:checkout] échec', err instanceof Error ? err.message : err)
    return json({ error: 'Checkout failed', code: 'checkout_failed' }, 502)
  }
}
