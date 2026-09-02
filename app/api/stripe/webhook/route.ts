import { NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { billingEnabled, livemodeMatchesEnvironment, resolveWebhookSecret } from '@/lib/billing/config'
import { getBillingAdmin, getSignatureVerifier, getStripe } from '@/lib/billing/stripe'
import { handleStripeEvent } from '@/lib/billing/events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Le traitement d'un événement fait plusieurs allers-retours en base. Sans
// plafond explicite, une livraison lente serait tuée par la plateforme et
// Stripe rejouerait pour rien.
export const maxDuration = 30

/**
 * POST /api/stripe/webhook — LE POINT D'ENTRÉE DES ÉVÉNEMENTS STRIPE.
 *
 * ┌─ CE N'EST PAS UN BATCH ─────────────────────────────────────────────────┐
 * │ La contrainte projet interdit tout travail ORDONNANCÉ PAR LE TEMPS qui   │
 * │ parcourt des lignes. Un webhook est une requête HTTP ENTRANTE déclenchée │
 * │ par un fait, au même titre qu'un POST utilisateur : il traite UN         │
 * │ événement, au moment où il arrive, sans parcourir quoi que ce soit.      │
 * │ C'est même ce qui ÉVITE de balayer périodiquement les abonnements pour   │
 * │ savoir qui a payé. La règle « zéro batch, zéro cron » est tenue.         │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ LA SEULE ROUTE DE L'APPLICATION SANS `requireAuth` ────────────────────┐
 * │ Ce n'est pas un oubli et ce n'est pas à « corriger ». L'appelant est     │
 * │ Stripe, pas un utilisateur : il n'a ni session, ni jeton, ni domaine.    │
 * │ L'authentification se fait par SIGNATURE CRYPTOGRAPHIQUE du corps.       │
 * │ Ajouter `requireAuth` ici ne renforcerait rien — cela casserait tout.    │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ LE CORPS EST LU BRUT. TOUJOURS. ───────────────────────────────────────┐
 * │                                                                          │
 * │        await request.text()      ✅   et JAMAIS request.json()           │
 * │                                                                          │
 * │ La signature Stripe est un HMAC-SHA256 des OCTETS EXACTS du corps. Un    │
 * │ JSON désérialisé puis re-sérialisé est un autre texte — ordre des clés,  │
 * │ espaces, échappement Unicode — et son HMAC ne correspond plus. La        │
 * │ vérification échouerait sur des événements parfaitement légitimes, de    │
 * │ façon intermittente et incompréhensible. C'est le piège n°1 des          │
 * │ webhooks Stripe.                                                         │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ IDEMPOTENCE PAR CONTRAINTE DE BASE ────────────────────────────────────┐
 * │ `stripe_event_claim` est un unique INSERT ... ON CONFLICT dont la clé    │
 * │ primaire EST l'identifiant Stripe. Deux livraisons simultanées sont      │
 * │ sérialisées par le verrou de ligne de PostgreSQL. Aucune                 │
 * │ lecture-puis-écriture ici : elle aurait précisément le trou qu'on ferme. │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * CODES DE RETOUR — et pourquoi chacun :
 *   200  traité, ignoré, ou doublon. Un TYPE NON GÉRÉ répond 200 : Stripe
 *        désactive un endpoint qui échoue trop, et on perdrait alors les types
 *        qu'on gère.
 *   400  signature invalide ou absente. Refus AVANT toute lecture en base.
 *   500  échec de traitement. Volontaire : c'est ce qui déclenche le réessai
 *        de Stripe. L'événement reste marqué 'failed', donc REJOUABLE.
 *   503  secret de signature absent : on ne peut vérifier personne, on
 *        n'enregistre rien.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type Admin = ReturnType<typeof getBillingAdmin>

/** Clôture du journal. Best-effort : ne masque jamais l'issue du traitement. */
async function mark(
  admin: Admin,
  id: string,
  status: 'processed' | 'ignored' | 'failed',
  error: string | null,
  organizationId: string | null,
): Promise<void> {
  const { error: rpcErr } = await admin.rpc('stripe_event_mark', {
    p_id: id,
    p_status: status,
    p_error: error,
    p_organization_id: organizationId,
  })
  if (rpcErr) console.error('[stripe:webhook] stripe_event_mark a échoué', id, rpcErr.message)
}

export async function POST(request: NextRequest): Promise<Response> {
  // ── 1. Le secret de signature ────────────────────────────────────────────
  //  Testé AVANT tout le reste, y compris avant `ENABLE_BILLING` : sans secret
  //  on ne peut authentifier personne, donc on ne peut rien journaliser de
  //  fiable. Enregistrer un événement non vérifié serait offrir à n'importe qui
  //  un moyen d'écrire dans notre journal.
  const secret = resolveWebhookSecret()
  if (!secret.ok) {
    console.error('[stripe:webhook]', secret.detail)
    return json({ error: 'Webhook not configured', code: secret.code }, 503)
  }

  // ── 2. LE CORPS BRUT, avant toute autre chose ────────────────────────────
  const rawBody = await request.text()
  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return json({ error: 'Missing signature', code: 'signature_missing' }, 400)
  }

  // ── 3. Vérification de signature ─────────────────────────────────────────
  //  Le client Stripe est obtenu SANS les verrous produit : `constructEvent`
  //  est un calcul local (HMAC), il ne fait aucun appel réseau et n'a pas
  //  besoin d'une clé valide pour l'environnement. On veut pouvoir vérifier et
  //  JOURNALISER même quand le mur est fermé — sinon on perdrait la trace des
  //  événements reçus pendant une fermeture.
  const handle = getStripe()
  let event: Stripe.Event
  try {
    event = getSignatureVerifier().webhooks.constructEvent(rawBody, signature, secret.secret)
  } catch (err) {
    // Volontairement laconique : on ne renseigne pas un attaquant sur ce qui a
    // échoué dans sa tentative.
    console.warn('[stripe:webhook] signature invalide', err instanceof Error ? err.message : '')
    return json({ error: 'Invalid signature', code: 'signature_invalid' }, 400)
  }

  const admin = getBillingAdmin()

  // ── 4. Réclamation idempotente ───────────────────────────────────────────
  //  `false` = événement déjà reçu (ou en cours de traitement par une autre
  //  livraison). On répond 200 et on NE FAIT RIEN. C'est ce qui garantit qu'un
  //  événement rejoué trois fois ne crédite pas trois fois.
  const { data: claimed, error: claimErr } = await admin.rpc('stripe_event_claim', {
    p_id: event.id,
    p_type: event.type,
    p_payload: event as unknown as Record<string, unknown>,
    p_livemode: event.livemode,
  })
  if (claimErr) {
    console.error('[stripe:webhook] stripe_event_claim a échoué', event.id, claimErr.message)
    // 500 : Stripe rejouera. Rien n'a été traité, rien n'est incohérent.
    return json({ error: 'Journal unavailable', code: 'event_claim_failed' }, 500)
  }
  if (claimed !== true) {
    return json({ received: true, duplicate: true }, 200)
  }

  // ── 5. Endpoints croisés entre les deux modes Stripe ─────────────────────
  //  Un événement `livemode` reçu hors production (ou l'inverse) signale une
  //  URL d'endpoint copiée d'un tableau de bord à l'autre. On l'ignore et on le
  //  journalise : le traiter appliquerait des droits réels depuis des données
  //  de test, ou l'inverse.
  if (!livemodeMatchesEnvironment(event.livemode)) {
    await mark(admin, event.id, 'ignored', `livemode=${event.livemode} hors de son environnement`, null)
    return json({ received: true, ignored: 'livemode_mismatch' }, 200)
  }

  // ── 6. Le verrou produit ─────────────────────────────────────────────────
  //  Mur fermé : on a vérifié et journalisé (on ne perd pas la trace), mais on
  //  n'applique AUCUN effet. Répondre 200 est délibéré — un 5xx ferait
  //  désactiver l'endpoint par Stripe.
  if (!billingEnabled()) {
    await mark(admin, event.id, 'ignored', 'ENABLE_BILLING absent — mur fermé', null)
    return json({ received: true, ignored: 'billing_disabled' }, 200)
  }
  if (!handle.ok) {
    await mark(admin, event.id, 'ignored', handle.detail, null)
    return json({ received: true, ignored: handle.code }, 200)
  }

  // ── 7. Traitement ────────────────────────────────────────────────────────
  try {
    const outcome = await handleStripeEvent(admin, event)
    await mark(
      admin,
      event.id,
      outcome.status,
      outcome.status === 'ignored' ? outcome.note : null,
      outcome.organizationId ?? null,
    )
    console.log(`[stripe:webhook] ${event.type} ${event.id} → ${outcome.status} : ${outcome.note}`)
    return json({ received: true, status: outcome.status }, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[stripe:webhook] ${event.type} ${event.id} a échoué :`, message)
    // 'failed' rend l'événement REJOUABLE par `stripe_event_claim` ; le 500
    // déclenche le réessai de Stripe. Les deux vont ensemble.
    await mark(admin, event.id, 'failed', message, null)
    return json({ error: 'Handler failed', code: 'handler_failed' }, 500)
  }
}
