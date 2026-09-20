import type Stripe from 'stripe'
import {
  STATUTS_OUVRANTS as PERIMETRE_STATUTS,
} from '@/lib/billing/perimetre-du-socle'
import type { SupabaseClient } from '@supabase/supabase-js'
import { stripeTsToIso } from '@/lib/billing/stripe'
import {
  idOf,
  metaUuid,
  purchaseEcosystem,
  resolveOrganization,
  resolvePackageByPrice,
  META_USER,
  type Stripe$Metadata,
} from '@/lib/billing/resolve'
import { applyPackageState, attachCustomer, extendValidity } from '@/lib/billing/apply'

/**
 * lib/billing/events.ts — LE TRAITEMENT MÉTIER DES ÉVÉNEMENTS STRIPE.
 *
 * La route (app/api/stripe/webhook) ne fait que : corps brut → signature →
 * réclamation idempotente → CE MODULE → clôture. Toute la logique est ici,
 * testable et lisible d'un bloc.
 *
 * ┌─ TROIS RÈGLES QUI NE SE NÉGOCIENT PAS ──────────────────────────────────┐
 * │ 1. ÉTAT ABSOLU, JAMAIS DE DELTA. Un événement d'abonnement porte l'état  │
 * │    COMPLET de l'abonnement. On écrit ce qu'il dit ; on ne compose        │
 * │    jamais « ancien + changement ». C'est ce qui rend un rejeu inoffensif │
 * │    et le désordre rattrapable.                                           │
 * │                                                                          │
 * │ 2. UN TYPE NON GÉRÉ RÉPOND 200 ET SE JOURNALISE 'ignored'. Jamais une    │
 * │    erreur : Stripe désactive un endpoint qui échoue trop, et on perdrait │
 * │    alors les types qu'on gère.                                           │
 * │                                                                          │
 * │ 3. ON NE DEVINE JAMAIS. Organisation, domaine ou offre non résolus →     │
 * │    échec explicite et visible, pas un choix par défaut. Accorder des     │
 * │    droits au hasard est pire que ne rien accorder.                       │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ RÉPARTITION DES RÔLES ENTRE ÉVÉNEMENTS ────────────────────────────────┐
 * │ `customer.subscription.*` décide QUELLE OFFRE et jusqu'à QUAND. C'est la │
 * │   seule source de l'attribution des droits.                              │
 * │ `invoice.paid` enregistre L'ARGENT et prolonge la validité. Il ne change │
 * │   jamais l'offre — sans quoi deux événements se disputeraient la même    │
 * │   décision, et le désordre déciderait à leur place.                      │
 * │ `checkout.session.completed` ne fait que RATTACHER le customer à         │
 * │   l'organisation. L'attribution suit par `subscription.created`.         │
 * └────────────────────────────────────────────────────────────────────────┘
 */

export type EventOutcome = {
  status: 'processed' | 'ignored'
  organizationId?: string | null
  /** Résumé lisible, journalisé et repris dans la réponse de diagnostic. */
  note: string
}

/** Les statuts d'abonnement Stripe qui ouvrent des droits. */
/**
 * LES STATUTS D'ABONNEMENT QUI OUVRENT DES DROITS.
 *
 * ⚠️ LA LISTE N’EST PLUS ÉCRITE ICI : elle vient de
 *    `lib/billing/perimetre-du-socle`, un module qui **n’importe rien** et
 *    reste donc atteignable depuis un diagnostic exécuté en Node nu
 *    (corollaire de §E.3). Ce fichier-ci importe le SDK Stripe et le client
 *    Supabase : y laisser la liste obligeait le module d’exploitation à en
 *    tenir une copie, et un contrôle à comparer deux copies.
 */
const STATUTS_OUVRANTS = new Set<string>(PERIMETRE_STATUTS)

/**
 * Fin de période d'un abonnement.
 *
 * Stripe a DÉPLACÉ ce champ : longtemps porté par l'abonnement, il vit
 * désormais sur chaque ligne d'abonnement. On lit les deux emplacements, la
 * ligne d'abord. Sans cette précaution, une montée de version d'API rendrait
 * `package_valid_until` silencieusement nul — et retirerait ses droits à toute
 * organisation qui paie.
 */
function subscriptionPeriodEnd(sub: Stripe.Subscription): number | null {
  const item = sub.items?.data?.[0] as { current_period_end?: unknown } | undefined
  const onItem = item?.current_period_end
  if (typeof onItem === 'number') return onItem
  const onSub = (sub as unknown as { current_period_end?: unknown }).current_period_end
  return typeof onSub === 'number' ? onSub : null
}

/** Identifiant d'abonnement porté par une facture (deux emplacements selon la version). */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const direct = idOf((invoice as unknown as { subscription?: unknown }).subscription)
  if (direct) return direct
  const parent = (invoice as unknown as {
    parent?: { subscription_details?: { subscription?: unknown } }
  }).parent
  return idOf(parent?.subscription_details?.subscription)
}

/** Fin de la période facturée, lue sur la première ligne de la facture. */
function invoicePeriodEnd(invoice: Stripe.Invoice): number | null {
  const line = invoice.lines?.data?.[0] as { period?: { end?: unknown } } | undefined
  const end = line?.period?.end
  return typeof end === 'number' ? end : null
}

/**
 * Prix de la première ligne d'une facture — encore un champ que Stripe a
 * déplacé : longtemps `line.price`, il vit désormais sous
 * `line.pricing.price_details.price`. Les deux emplacements sont lus.
 *
 * Ce prix ne sert qu'à RATTACHER la transaction à une offre du catalogue. Il ne
 * décide JAMAIS des droits : l'attribution appartient aux événements
 * d'abonnement, et à eux seuls.
 */
function invoiceFirstPriceId(invoice: Stripe.Invoice): string | null {
  const line = invoice.lines?.data?.[0] as
    | { price?: unknown; pricing?: { price_details?: { price?: unknown } } }
    | undefined
  return idOf(line?.pricing?.price_details?.price) ?? idOf(line?.price)
}

function meta(o: { metadata?: Stripe.Metadata | null } | null | undefined): Stripe$Metadata | null {
  return (o?.metadata ?? null) as Stripe$Metadata | null
}

/** Montant Stripe (unité mineure) → unité majeure, pour `transactions`. */
function toMajor(minor: number | null | undefined): number {
  return typeof minor === 'number' && Number.isFinite(minor) ? minor / 100 : 0
}

/**
 * TVA d'une facture, en unité mineure.
 *
 * Stripe a remplacé le champ scalaire `tax` par une VENTILATION `total_taxes`
 * (plusieurs lignes possibles : TVA nationale, taxe locale…). On somme la
 * ventilation quand elle existe, et on retombe sur l'ancien champ sinon.
 *
 * Vaut 0 tant que Stripe Tax n'est pas activé — et c'est un FAIT enregistré,
 * pas une hypothèse : la base distingue `amount` (réglé), `amount_excl_tax`
 * (HT) et `tax_amount`, précisément pour que le code n'ait jamais à présumer
 * HT ou TTC (décision produit n°9).
 */
function invoiceTaxMinor(invoice: Stripe.Invoice): number {
  const ventilation = (invoice as unknown as { total_taxes?: { amount?: unknown }[] }).total_taxes
  if (Array.isArray(ventilation)) {
    return ventilation.reduce<number>(
      (sum, t) => sum + (typeof t?.amount === 'number' ? t.amount : 0),
      0,
    )
  }
  const legacy = (invoice as unknown as { tax?: unknown }).tax
  return typeof legacy === 'number' ? legacy : 0
}

// ═══════════════════════════════════════════════════════════════════════════
// checkout.session.completed
// ═══════════════════════════════════════════════════════════════════════════

async function onCheckoutCompleted(
  admin: SupabaseClient,
  session: Stripe.Checkout.Session,
): Promise<EventOutcome> {
  const customerId = idOf(session.customer)

  // `client_reference_id` ET les métadonnées : les deux canaux sont posés à la
  // création de la session (Lot 2). Deux canaux parce qu'un seul suffirait
  // jusqu'au jour où il manque.
  const metadata = meta(session)
  const org = await resolveOrganization(admin, {
    metadata: {
      ...(metadata ?? {}),
      ...(session.client_reference_id
        ? { skilloria_organization_id: session.client_reference_id }
        : {}),
    },
    customerId,
  })
  if (!org.ok) return { status: 'ignored', note: `organisation non résolue — ${org.reason}` }

  if (!customerId) {
    return { status: 'ignored', organizationId: org.value, note: 'session sans customer' }
  }

  const attached = await attachCustomer(admin, org.value, customerId)
  if (!attached.ok) throw new Error(attached.reason)

  // Mode 'payment' = achat ponctuel. PLACE RÉSERVÉE (décision produit n°5) :
  // aucun prix à l'unité n'existe au catalogue en V0, mais le jour où l'on en
  // pose un, l'encaissement est déjà enregistré. Aucun droit n'est accordé ici —
  // un complément à l'unité passera par un crédit, pas par un changement d'offre.
  if (session.mode === 'payment') {
    return {
      status: 'processed',
      organizationId: org.value,
      note: `achat ponctuel encaissé (customer rattaché${attached.changed ? '' : ' déjà'}) — aucun droit modifié`,
    }
  }

  return {
    status: 'processed',
    organizationId: org.value,
    note: attached.changed
      ? `customer ${customerId} rattaché à l'organisation`
      : 'customer déjà rattaché (rejeu sans effet)',
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// customer.subscription.created / .updated
// ═══════════════════════════════════════════════════════════════════════════

async function onSubscriptionUpsert(
  admin: SupabaseClient,
  sub: Stripe.Subscription,
  eventAt: Date,
): Promise<EventOutcome> {
  const metadata = meta(sub)
  const customerId = idOf(sub.customer)

  const org = await resolveOrganization(admin, { metadata, customerId })
  if (!org.ok) throw new Error(`organisation non résolue — ${org.reason}`)

  // Un abonnement dont le statut n'ouvre aucun droit (incomplete, unpaid,
  // canceled…) : on enregistre le STATUT, on ne pose PAS d'offre. Une session
  // de paiement abandonnée laisse un abonnement 'incomplete' — il ne doit rien
  // accorder, et il ne doit rien retirer non plus.
  if (!STATUTS_OUVRANTS.has(sub.status)) {
    const outcome = await applyPackageState(admin, {
      organizationId: org.value,
      eventAt,
      packageId: null,
      packageValidUntil: null,
      stripeSubscriptionId: sub.id,
      stripeSubscriptionStatus: sub.status,
    })
    return {
      status: 'processed',
      organizationId: org.value,
      note: `abonnement '${sub.status}' — aucun droit accordé (${outcome})`,
    }
  }

  const priceId = idOf(sub.items?.data?.[0]?.price)
  if (!priceId) throw new Error("abonnement sans prix sur sa première ligne")

  const pkg = await resolvePackageByPrice(admin, priceId)
  if (!pkg.ok) throw new Error(`offre non résolue — ${pkg.reason}`)

  const until = stripeTsToIso(subscriptionPeriodEnd(sub))
  if (!until) throw new Error("fin de période introuvable sur l'abonnement")

  const outcome = await applyPackageState(admin, {
    organizationId: org.value,
    eventAt,
    packageId: pkg.value.id,
    packageValidUntil: until,
    stripeSubscriptionId: sub.id,
    stripeSubscriptionStatus: sub.status,
    packageStartedAt: stripeTsToIso(sub.start_date),
  })
  if (outcome === 'no_row') throw new Error(`organisation ${org.value} introuvable`)

  return {
    status: 'processed',
    organizationId: org.value,
    note:
      outcome === 'stale'
        ? `événement retardataire ignoré (offre '${pkg.value.slug}' non appliquée)`
        : `offre '${pkg.value.slug}' appliquée jusqu'au ${until} (statut ${sub.status})`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// customer.subscription.deleted
// ═══════════════════════════════════════════════════════════════════════════

async function onSubscriptionDeleted(
  admin: SupabaseClient,
  sub: Stripe.Subscription,
  eventAt: Date,
): Promise<EventOutcome> {
  const metadata = meta(sub)
  const org = await resolveOrganization(admin, { metadata, customerId: idOf(sub.customer) })
  if (!org.ok) throw new Error(`organisation non résolue — ${org.reason}`)

  // Retour à l'offre par défaut, PAS de perte d'accès. `package_id` à null
  // suffit : `getOrgEntitlements` retombe alors sur l'offre `is_default` du
  // catalogue, dont la migration des fondations garantit qu'elle est gratuite.
  //
  // `stripe_subscription_id` est remis à null : le laisser empêcherait une
  // nouvelle souscription de la même organisation (index unique), et ferait
  // croire à un abonnement vivant.
  const outcome = await applyPackageState(admin, {
    organizationId: org.value,
    eventAt,
    packageId: null,
    packageValidUntil: null,
    stripeSubscriptionId: null,
    stripeSubscriptionStatus: 'canceled',
  })
  if (outcome === 'no_row') throw new Error(`organisation ${org.value} introuvable`)

  return {
    status: 'processed',
    organizationId: org.value,
    note:
      outcome === 'stale'
        ? 'événement retardataire ignoré (résiliation non appliquée)'
        : "abonnement résilié — retour à l'offre par défaut, accès conservé",
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// invoice.paid — l'argent, et rien que l'argent
// ═══════════════════════════════════════════════════════════════════════════

async function onInvoicePaid(
  admin: SupabaseClient,
  invoice: Stripe.Invoice,
  eventAt: Date,
): Promise<EventOutcome> {
  const customerId = idOf(invoice.customer)
  const metadata = meta(invoice)

  const org = await resolveOrganization(admin, { metadata, customerId })
  if (!org.ok) throw new Error(`organisation non résolue — ${org.reason}`)

  // Étiquette descriptive, sans lecture ni refus : on ne bloque JAMAIS
  // l'enregistrement d'un paiement réel au motif qu'on ignore d'où il vient.
  // null est le cas normal d'un renouvellement automatique.
  const ecosystem = purchaseEcosystem(metadata)

  // ── La pièce comptable ────────────────────────────────────────────────────
  //  Idempotence par la contrainte UNIQUE sur stripe_invoice_id (fondations) :
  //  un rejeu se heurte à la base, il n'est pas arbitré par une lecture.
  //  `ignoreDuplicates` traduit exactement cette intention.
  //
  //  Ni HT ni TTC présumé (décision produit n°9) : les trois montants sont
  //  enregistrés séparément. `tax` vaut 0 tant que Stripe Tax n'est pas activé —
  //  c'est un FAIT enregistré, pas une hypothèse.
  const total = toMajor(invoice.amount_paid)
  const tax = toMajor(invoiceTaxMinor(invoice))
  const priceId = invoiceFirstPriceId(invoice)
  const pkg = priceId ? await resolvePackageByPrice(admin, priceId) : null

  const { error: txErr } = await admin.from('transactions').upsert(
    {
      organization_id: org.value,
      user_id: metaUuid(metadata, META_USER),
      domain_id: ecosystem,
      package_id: pkg?.ok ? pkg.value.id : null,
      stripe_invoice_id: invoice.id,
      stripe_customer_id: customerId,
      stripe_subscription_id: invoiceSubscriptionId(invoice),
      stripe_payment_intent_id: idOf((invoice as unknown as { payment_intent?: unknown }).payment_intent),
      amount: total,
      amount_excl_tax: total - tax,
      tax_amount: tax,
      tax_status: tax > 0 ? 'taxable' : 'none',
      currency: (invoice.currency ?? 'eur').toUpperCase(),
      status: 'success',
      billing_period: invoiceSubscriptionId(invoice) ? 'monthly' : 'one_time',
      period_start: stripeTsToIso(invoice.period_start),
      period_end: stripeTsToIso(invoicePeriodEnd(invoice) ?? invoice.period_end),
      invoice_url: invoice.hosted_invoice_url ?? null,
      livemode: invoice.livemode,
    },
    { onConflict: 'stripe_invoice_id', ignoreDuplicates: true },
  )
  if (txErr) throw new Error(`écriture transactions: ${txErr.message}`)

  // ── La validité ───────────────────────────────────────────────────────────
  //  On PROLONGE, on ne réattribue pas : l'offre est décidée par les événements
  //  d'abonnement, jamais ici. Une facture sans période (achat ponctuel) ne
  //  prolonge rien.
  const until = stripeTsToIso(invoicePeriodEnd(invoice))
  if (!until) {
    return {
      status: 'processed',
      organizationId: org.value,
      note: `paiement de ${total} enregistré (aucune période à prolonger)`,
    }
  }

  const outcome = await extendValidity(admin, {
    organizationId: org.value,
    eventAt,
    until,
    subscriptionStatus: 'active',
  })
  return {
    status: 'processed',
    organizationId: org.value,
    note: `paiement de ${total} enregistré, validité portée au ${until} (${outcome})`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// invoice.payment_failed — la période de grâce
// ═══════════════════════════════════════════════════════════════════════════

async function onInvoicePaymentFailed(
  admin: SupabaseClient,
  invoice: Stripe.Invoice,
  eventAt: Date,
): Promise<EventOutcome> {
  const metadata = meta(invoice)
  const org = await resolveOrganization(admin, { metadata, customerId: idOf(invoice.customer) })
  if (!org.ok) throw new Error(`organisation non résolue — ${org.reason}`)

  // ON NE RETIRE RIEN. On repousse la validité à la prochaine tentative que
  // Stripe annonce. Quand Stripe cesse de réessayer, il n'annonce plus rien :
  // la date cesse d'avancer et l'organisation retombe SEULE sur l'offre par
  // défaut, à la lecture. Zéro batch, zéro cron, zéro échéance à surveiller.
  const nextAttempt = stripeTsToIso(invoice.next_payment_attempt)
  if (!nextAttempt) {
    // Plus de relance prévue : la validité en cours court jusqu'à son terme,
    // puis le moteur retombe. La résiliation effective arrivera, elle, par
    // `customer.subscription.deleted`.
    return {
      status: 'processed',
      organizationId: org.value,
      note: 'échec de paiement, plus de relance prévue — validité laissée à son terme',
    }
  }

  const outcome = await extendValidity(admin, {
    organizationId: org.value,
    eventAt,
    until: nextAttempt,
    subscriptionStatus: 'past_due',
  })
  return {
    status: 'processed',
    organizationId: org.value,
    note: `échec de paiement — grâce portée à la prochaine tentative (${nextAttempt}, ${outcome})`,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Aiguillage
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aiguille un événement vérifié vers son traitement.
 *
 * LÈVE sur échec métier : la route marque alors l'événement 'failed' et répond
 * 500, ce qui déclenche le réessai de Stripe. Un événement dont l'organisation
 * ou l'offre ne se résout pas est un défaut à corriger, pas un cas à absorber
 * en silence.
 *
 * Un TYPE NON GÉRÉ n'est PAS une erreur : il retourne 'ignored', la route
 * répond 200. C'est la règle qui protège l'endpoint de la désactivation.
 */
export async function handleStripeEvent(
  admin: SupabaseClient,
  event: Stripe.Event,
): Promise<EventOutcome> {
  const eventAt = new Date(event.created * 1000)

  switch (event.type) {
    case 'checkout.session.completed':
      return onCheckoutCompleted(admin, event.data.object as Stripe.Checkout.Session)

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      return onSubscriptionUpsert(admin, event.data.object as Stripe.Subscription, eventAt)

    case 'customer.subscription.deleted':
      return onSubscriptionDeleted(admin, event.data.object as Stripe.Subscription, eventAt)

    case 'invoice.paid':
      return onInvoicePaid(admin, event.data.object as Stripe.Invoice, eventAt)

    case 'invoice.payment_failed':
      return onInvoicePaymentFailed(admin, event.data.object as Stripe.Invoice, eventAt)

    default:
      return { status: 'ignored', note: `type non géré : ${event.type}` }
  }
}
