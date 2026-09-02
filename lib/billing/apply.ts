import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * lib/billing/apply.ts — L'ÉCRITURE DES DROITS, sous garde anti-désordre.
 *
 * ┌─ STRIPE SE BRANCHE DERRIÈRE LE MOTEUR COMMERCE ─────────────────────────┐
 * │ Ce module écrit `organization_domains.package_id` et                     │
 * │ `package_valid_until` — EXACTEMENT les deux colonnes que                 │
 * │ `getOrgEntitlements` lit déjà (lib/entitlements.ts). Le moteur n'est pas │
 * │ modifié, ne connaît pas Stripe, et ne fera JAMAIS d'appel réseau pour    │
 * │ lire un droit : une lecture de droits est sur le chemin critique de      │
 * │ `publish` et `unlock`.                                                   │
 * │                                                                          │
 * │ La ligne LOCALE fait foi. Stripe ne fait autorité que sur l'état de      │
 * │ l'encaissement.                                                          │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ LA GARDE ANTI-DÉSORDRE ────────────────────────────────────────────────┐
 * │ Stripe ne garantit AUCUN ordre de livraison. Un                          │
 * │ `customer.subscription.updated` retardataire peut arriver APRÈS le       │
 * │ `customer.subscription.deleted` qui le suit dans le temps réel. Sans     │
 * │ garde, il ressusciterait un abonnement résilié.                          │
 * │                                                                          │
 * │ La garde est dans le WHERE de l'UPDATE, pas dans une lecture préalable : │
 * │   ... where package_source_event_at is null                              │
 * │        or package_source_event_at < <horodatage de l'événement>          │
 * │ Un seul statement, donc aucune course entre deux livraisons simultanées. │
 * │ Même principe que `stripe_event_claim` : on ne lit pas pour décider      │
 * │ d'écrire, on laisse la base arbitrer.                                    │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ JAMAIS DE DELTA. Chaque appel porte l'ÉTAT ABSOLU tel que l'événement le
 *    décrit. On n'incrémente rien, on ne compose rien avec l'état antérieur.
 *    C'est ce qui rend un rejeu inoffensif.
 */

/** Résultat d'une écriture de droits. `stale` = événement retardataire, ignoré. */
export type ApplyOutcome = 'applied' | 'stale' | 'no_row'

export type PackageState = {
  organizationId: string
  domainId: string
  /** `event.created` — l'horodatage qui arbitre le désordre. */
  eventAt: Date
  /** null = retour à l'offre par défaut (le moteur retombe sur `is_default`). */
  packageId: string | null
  /** null = sans échéance. Le moteur la lit et retombe seul quand elle est passée. */
  packageValidUntil: string | null
  /** null = plus d'abonnement rattaché. */
  stripeSubscriptionId: string | null
  /** Affichage uniquement — aucune lecture de droits n'en dépend. */
  stripeSubscriptionStatus: string | null
  /** Renseigné au premier passage seulement (info/audit). */
  packageStartedAt?: string | null
}

/**
 * Écrit l'état d'abonnement sur la ligne (organisation, domaine).
 *
 * Retourne :
 *   - 'applied' : l'état a été écrit ;
 *   - 'stale'   : un événement PLUS RÉCENT avait déjà écrit — on n'écrase pas ;
 *   - 'no_row'  : aucune ligne (organisation, domaine) — anomalie à signaler.
 *
 * La distinction 'stale' / 'no_row' compte : la première est un fonctionnement
 * NORMAL (Stripe rejoue et livre dans le désordre), la seconde est un défaut.
 * Les confondre ferait passer un vrai problème pour du bruit.
 */
export async function applyPackageState(
  admin: SupabaseClient,
  state: PackageState,
): Promise<ApplyOutcome> {
  const iso = state.eventAt.toISOString()

  const patch: Record<string, unknown> = {
    package_id: state.packageId,
    package_valid_until: state.packageValidUntil,
    stripe_subscription_id: state.stripeSubscriptionId,
    stripe_subscription_status: state.stripeSubscriptionStatus,
    package_source_event_at: iso,
  }
  if (state.packageStartedAt !== undefined) {
    patch.package_started_at = state.packageStartedAt
  }

  // Guillemets doubles autour de la date : PostgREST accepte une valeur citée,
  // ce qui met la chaîne ISO à l'abri de son interprétation comme séparateur.
  const { data, error } = await admin
    .from('organization_domains')
    .update(patch)
    .eq('organization_id', state.organizationId)
    .eq('domain_id', state.domainId)
    .or(`package_source_event_at.is.null,package_source_event_at.lt."${iso}"`)
    .select('id')

  if (error) throw new Error(`applyPackageState: ${error.message}`)
  if ((data ?? []).length > 0) return 'applied'

  // Zéro ligne mise à jour : soit la garde a mordu (événement retardataire),
  // soit la ligne n'existe pas. On distingue par une lecture SANS la garde —
  // lecture de diagnostic, elle ne décide d'aucune écriture.
  const { data: exists } = await admin
    .from('organization_domains')
    .select('id')
    .eq('organization_id', state.organizationId)
    .eq('domain_id', state.domainId)
    .maybeSingle()

  return exists ? 'stale' : 'no_row'
}

/**
 * Prolonge la validité SANS toucher à l'offre.
 *
 * ┌─ LA PÉRIODE DE GRÂCE, SANS UNE LIGNE DE CODE TEMPOREL ──────────────────┐
 * │ À l'échec d'un renouvellement, on ne retire RIEN : on repousse           │
 * │ `package_valid_until` à la prochaine tentative que Stripe annonce        │
 * │ (`invoice.next_payment_attempt`). Chaque échec repousse d'autant.        │
 * │ Quand Stripe cesse de réessayer, il n'annonce plus de tentative : la     │
 * │ date cesse d'avancer, `getOrgEntitlements` la voit passée et l'org       │
 * │ retombe SEULE sur l'offre par défaut.                                    │
 * │                                                                          │
 * │ AUCUN batch, AUCUN cron, aucune échéance à surveiller : la règle est     │
 * │ calculée À LA LECTURE par le moteur, qui le faisait déjà.                │
 * │                                                                          │
 * │ Et l'organisation ne perd JAMAIS l'accès : elle redescend sur l'offre    │
 * │ gratuite. Couper l'accès à un client dont la carte a expiré lui          │
 * │ retirerait des candidatures qu'il a déjà payées.                         │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * `Math.max` sur les dates : un événement ne doit jamais RACCOURCIR une
 * validité déjà acquise. Prolonger est sûr, réduire ne l'est pas.
 */
export async function extendValidity(
  admin: SupabaseClient,
  args: {
    organizationId: string
    domainId: string
    eventAt: Date
    until: string
    subscriptionStatus?: string | null
  },
): Promise<ApplyOutcome> {
  const iso = args.eventAt.toISOString()

  const { data: row, error: readErr } = await admin
    .from('organization_domains')
    .select('id, package_valid_until, package_source_event_at')
    .eq('organization_id', args.organizationId)
    .eq('domain_id', args.domainId)
    .maybeSingle()
  if (readErr) throw new Error(`extendValidity (lecture): ${readErr.message}`)
  if (!row) return 'no_row'

  const priorEvent = row.package_source_event_at as string | null
  if (priorEvent && new Date(priorEvent).getTime() >= args.eventAt.getTime()) return 'stale'

  const current = row.package_valid_until as string | null
  const keep =
    current && new Date(current).getTime() > new Date(args.until).getTime() ? current : args.until

  const patch: Record<string, unknown> = {
    package_valid_until: keep,
    package_source_event_at: iso,
  }
  if (args.subscriptionStatus !== undefined) {
    patch.stripe_subscription_status = args.subscriptionStatus
  }

  const { data, error } = await admin
    .from('organization_domains')
    .update(patch)
    .eq('id', row.id as string)
    .or(`package_source_event_at.is.null,package_source_event_at.lt."${iso}"`)
    .select('id')
  if (error) throw new Error(`extendValidity: ${error.message}`)
  return (data ?? []).length > 0 ? 'applied' : 'stale'
}

/**
 * Rattache un Customer Stripe à une organisation.
 *
 * Idempotent, et REFUSE de réattribuer un customer déjà lié à une AUTRE
 * organisation : l'index unique le rejetterait de toute façon, mais échouer ici
 * avec un message lisible vaut mieux qu'une violation de contrainte brute au
 * milieu d'un webhook.
 */
export async function attachCustomer(
  admin: SupabaseClient,
  organizationId: string,
  customerId: string,
): Promise<{ ok: true; changed: boolean } | { ok: false; reason: string }> {
  const { data: holder, error: holderErr } = await admin
    .from('organizations')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()
  if (holderErr) return { ok: false, reason: `lecture organizations: ${holderErr.message}` }

  if (holder?.id) {
    return holder.id === organizationId
      ? { ok: true, changed: false }
      : {
          ok: false,
          reason: `customer ${customerId} déjà rattaché à l'organisation ${holder.id}`,
        }
  }

  const { error } = await admin
    .from('organizations')
    .update({ stripe_customer_id: customerId })
    .eq('id', organizationId)
  if (error) return { ok: false, reason: `écriture stripe_customer_id: ${error.message}` }
  return { ok: true, changed: true }
}
