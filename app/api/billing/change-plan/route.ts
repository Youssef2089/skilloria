import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { billingEnabled } from '@/lib/billing/config'
import {
  hasLiveSubscription,
  isPurchaseError,
  loadOrgBillingState,
  purchaseMetadata,
  requireBillingAdmin,
  resolveSellablePrice,
  stripeOrRefusal,
} from '@/lib/billing/purchase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/billing/change-plan — CHANGEMENT D'OFFRE, chez nous.
 *
 * Body : { package_id: uuid }
 * Réponse : { effet: 'immediat' | 'a_echeance', ... }
 *
 * ┌─ POURQUOI CHEZ NOUS ET PAS DANS LE PORTAIL STRIPE ──────────────────────┐
 * │ C'est là que se joue la conversion : on veut maîtriser la présentation   │
 * │ du catalogue, ses libellés et ses limites. Le portail sait le faire,     │
 * │ mais à sa façon — sa section « changer d'offre » est explicitement       │
 * │ désactivée dans notre configuration.                                     │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ MONTÉE : IMMÉDIATE ET PRORATISÉE ──────────────────────────────────────┐
 * │ Le client paie plus, il veut la valeur tout de suite. Le delta est       │
 * │ facturé immédiatement (`always_invoice`).                                │
 * │                                                                          │
 * │ Les compteurs de quota ne sont PAS réinitialisés — et il n'y a rien à    │
 * │ faire pour cela : `usage_counters` est indépendant de l'offre, et        │
 * │ `usage_increment` reçoit le nouveau plafond au prochain appel. La marge  │
 * │ revient donc mécaniquement. C'est le bon comportement, et il était déjà  │
 * │ là.                                                                      │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ DESCENTE : À L'ÉCHÉANCE, PAR UN CALENDRIER D'ABONNEMENT ───────────────┐
 * │ Le client a payé son mois, il le garde entier. Aucun remboursement, donc │
 * │ aucun cas de bord de proration.                                          │
 * │                                                                          │
 * │ ⚠️ LE PIÈGE, ET POURQUOI ON UTILISE UN CALENDRIER. Changer le prix avec  │
 * │   `proration_behavior: 'none'` semble faire l'affaire : rien n'est       │
 * │   facturé avant l'échéance. Mais l'abonnement porte AUSSITÔT le nouveau  │
 * │   prix, Stripe émet un `customer.subscription.updated`, et notre webhook │
 * │   — qui applique fidèlement l'état absolu — poserait immédiatement       │
 * │   l'offre inférieure. On retirerait des droits que le client a payés.    │
 * │                                                                          │
 * │   Un `subscriptionSchedule` change le prix À LA DATE VOULUE. L'événement │
 * │   d'abonnement part alors au bon moment, et le webhook n'a rien de       │
 * │   spécial à connaître : il continue d'écrire ce que l'événement dit.     │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ ET LES ANNONCES DÉJÀ PUBLIÉES ? ───────────────────────────────────────┐
 * │ Rien n'est dépublié. Une organisation qui redescend sous le plafond      │
 * │ d'actives garde ses annonces jusqu'à leur expiration naturelle (30 j,    │
 * │ calculée à la lecture) et ne peut plus publier tant qu'elle est au       │
 * │ dessus. Le système se rééquilibre seul, sans batch ni cron — et on ne    │
 * │ détruit pas la valeur des experts qui ont déjà candidaté.                │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Cette route ne pose AUCUN droit : elle demande le changement à Stripe. Les
 * droits suivront par le webhook, immédiatement pour une montée, à l'échéance
 * pour une descente.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/** Prix mensuel d'une offre du catalogue, en unité MAJEURE. Le catalogue fait autorité. */
async function cataloguePrice(
  admin: AuthContext['supabaseAdmin'],
  packageId: string,
): Promise<number | null> {
  const { data, error } = await admin
    .from('packages')
    .select('price_monthly')
    .eq('id', packageId)
    .maybeSingle()
  // ⚠️ `null` VEUT DIRE DEUX CHOSES, ET L'APPELANT N'EN TRAITE QU'UNE.
  //    Sur une panne de lecture, `avant` tombait à `null`, et l’appelant
  //    en concluait une MONTÉE — donc un prélèvement IMMÉDIAT là où une
  //    rétrogradation se programme en fin de période. Le commentaire ne
  //    justifiait que le cas « offre retirée du catalogue » : vrai de celui-là,
  //    faux de la panne, et il couvrait les deux (§E.29).
  //    On LÈVE : on ne facture pas sur un prix qu’on n’a pas su lire.
  if (error) {
    console.error('[billing:change-plan] tarif catalogue illisible', { packageId, message: error.message })
    throw new Error(`cataloguePrice: tarif illisible — ${error.message}`)
  }
  const raw = data?.price_monthly
  if (raw == null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
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
    if (!hasLiveSubscription(state) || !state.stripeSubscriptionId) {
      return json(
        {
          error: 'Aucun abonnement en cours',
          code: 'no_subscription',
          hint: 'Utiliser /api/billing/checkout pour souscrire.',
        },
        409,
      )
    }
    if (state.packageId === packageId) {
      return json({ error: 'Offre déjà en cours', code: 'same_package' }, 409)
    }

    const price = await resolveSellablePrice(auth.supabaseAdmin, packageId)
    if (isPurchaseError(price)) {
      return json({ error: price.message, code: price.code }, price.code === 'package_not_found' ? 404 : 409)
    }

    // ── Montée ou descente ? Tranché sur le CATALOGUE, pas sur Stripe ──────
    //  Le catalogue local fait autorité sur les prix : c'est lui qui dit si
    //  l'organisation monte ou descend. Interroger Stripe pour le savoir
    //  inverserait la relation.
    const [avant, apres] = await Promise.all([
      state.packageId ? cataloguePrice(auth.supabaseAdmin, state.packageId) : Promise.resolve(0),
      cataloguePrice(auth.supabaseAdmin, packageId),
    ])
    // Une offre sans tarif n'est pas vendable, `resolveSellablePrice` l'a déjà
    // refusée : `apres` est donc un nombre. `avant` peut être nul si l'offre
    // d'origine a été retirée du catalogue — on traite alors comme une montée,
    // le cas le plus favorable au client (il paie tout de suite ce qu'il choisit).
    const monte = apres != null && (avant == null || apres >= avant)

    const metadata = purchaseMetadata({
      organizationId: guard.organizationId,
      domainId: auth.domain.id,
      userId: auth.user.id,
      packageSlug: price.slug,
    })

    const subscription = await handle.stripe.subscriptions.retrieve(state.stripeSubscriptionId)
    const itemId = subscription.items?.data?.[0]?.id
    if (!itemId) {
      return json({ error: 'Abonnement sans ligne', code: 'subscription_malformed' }, 502)
    }

    if (monte) {
      await handle.stripe.subscriptions.update(state.stripeSubscriptionId, {
        items: [{ id: itemId, price: price.priceId }],
        // Delta facturé immédiatement : le client paie plus et obtient la
        // valeur tout de suite.
        proration_behavior: 'always_invoice',
        metadata,
      })
      return json({ effet: 'immediat', offre: price.slug }, 200)
    }

    // ── Descente : le changement est PROGRAMMÉ à l'échéance ────────────────
    const schedule = await handle.stripe.subscriptionSchedules.create({
      from_subscription: state.stripeSubscriptionId,
    })
    const phaseCourante = schedule.phases?.[0]
    if (!phaseCourante) {
      return json({ error: 'Calendrier sans phase', code: 'schedule_malformed' }, 502)
    }

    await handle.stripe.subscriptionSchedules.update(schedule.id, {
      phases: [
        {
          // La phase en cours est reconduite TELLE QUELLE, jusqu'à son terme :
          // c'est ce que le client a payé.
          items: phaseCourante.items.map((i) => ({
            price: typeof i.price === 'string' ? i.price : i.price.id,
            quantity: i.quantity ?? 1,
          })),
          start_date: phaseCourante.start_date,
          end_date: phaseCourante.end_date,
        },
        {
          // La nouvelle offre prend effet exactement à l'échéance.
          items: [{ price: price.priceId, quantity: 1 }],
          metadata,
        },
      ],
      end_behavior: 'release',
    })

    return json(
      {
        effet: 'a_echeance',
        offre: price.slug,
        echeance: state.packageValidUntil,
      },
      200,
    )
  } catch (err) {
    console.error('[billing:change-plan] échec', err instanceof Error ? err.message : err)
    return json({ error: 'Change plan failed', code: 'change_plan_failed' }, 502)
  }
}
