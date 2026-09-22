import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { isProduction } from '@/lib/env'
import { siteOrigin } from '@/lib/site-url'
import { resolveCatalogueKey, resolveWebhookSecret } from '@/lib/billing/config'
import { lireToutesLesLiaisons, modeDeLaCle } from '@/lib/billing/catalogue-stripe'
import {
  etatCatalogueRelie,
  type EtatCatalogueRelie,
  type OffreCatalogue,
} from '@/lib/stripe-exploitation/catalogue-relie'
import { listeLue } from '@/lib/lecture/liste'
import { indisponible, disponible, type LectureStripe } from '@/lib/stripe-exploitation/etat'
import { etatJournal, type LigneJournal, type StatutEvenement } from '@/lib/stripe-exploitation/journal'
import {
  comparerDroits,
  type AbonnementStripe,
  type CataloguePrix,
  type DroitLocal,
} from '@/lib/stripe-exploitation/ecarts'
import { etatRaccordement } from '@/lib/stripe-exploitation/raccordement'
import { MINUTES_AVANT_COINCE } from '@/lib/stripe-exploitation/journal'
import { logAudit } from '@/lib/audit'
import { lireAbonnements, lireEndpoints } from '@/lib/stripe-exploitation/lecture-stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// La comparaison pagine chez Stripe (abonnements + points de réception). Sans
// plafond explicite, une exploitation qui grossit se ferait couper au milieu —
// et un écart calculé sur la moitié des abonnements serait FAUX, ce qui est
// pire qu'aucun écart.
export const maxDuration = 60

/**
 * GET /api/admin/facturation — CE QUE STRIPE NE PEUT PAS SAVOIR.
 *
 * ┌─ UNE SEULE ROUTE POUR TROIS SURFACES, ET C'EST §E.36 ───────────────────┐
 * │ Le journal, les écarts et la santé du raccordement lisent tous les       │
 * │ trois la MÊME source : l'API Stripe et notre base. Trois routes qui      │
 * │ liraient séparément tomberaient ensemble sur la même panne — et l'une    │
 * │ dirait « rien à signaler » pendant qu'une autre dirait « je ne sais      │
 * │ pas ». C'est la forme exacte de §E.36, et le remède n'est pas de         │
 * │ corriger les trois : c'est de n'en avoir QU'UNE.                         │
 * │                                                                          │
 * │ Une lecture, un type, trois consommateurs. Ils ne peuvent plus diverger  │
 * │ puisqu'ils ne lisent plus séparément.                                    │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ ON NE RECOPIE PAS STRIPE ──────────────────────────────────────────────┐
 * │ Aucun montant, aucune facture, aucun litige, aucun remboursement ne      │
 * │ transite ici : ils vivent dans le tableau de bord Stripe, et un écran    │
 * │ qui les recopierait divergerait de sa source au premier écart de         │
 * │ synchronisation. Cette route ne rend QUE la comparaison des deux états   │
 * │ — ce que Stripe, seul, ne peut pas savoir.                               │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ LECTURE SEULE. AUCUN VERBE D'ÉCRITURE N'EST EXPORTÉ ───────────────────┐
 * │ Pas de POST, pas de PATCH, pas de DELETE. Corriger automatiquement un    │
 * │ écart qu'on ne comprend pas encore, c'est appliquer un remède au hasard  │
 * │ sur de l'argent — rétablir des droits qu'on aurait dû retirer, ou        │
 * │ retirer des droits payés. L'écran CONSTATE ; la correction est un geste  │
 * │ humain, pris en connaissance de cause.                                   │
 * └────────────────────────────────────────────────────────────────────────┘
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Bornes du journal. Un écran qui affiche tout ce qui existe devient illisible (§E.26). */
const LIMITE_DEFAUT = 100
const LIMITE_MAX = 500

const STATUTS: readonly StatutEvenement[] = ['received', 'processed', 'ignored', 'failed']

function estStatut(v: string | null): v is StatutEvenement {
  return v !== null && (STATUTS as readonly string[]).includes(v)
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const admin = auth.supabaseAdmin
  const maintenant = new Date()

  const url = new URL(request.url)
  const limite = Math.max(
    1,
    Math.min(LIMITE_MAX, Number(url.searchParams.get('limite') ?? LIMITE_DEFAUT) || LIMITE_DEFAUT),
  )
  const statutDemande = url.searchParams.get('statut')

  // ── 1. LE JOURNAL ────────────────────────────────────────────────────────
  let requeteJournal = admin
    .from('stripe_events')
    .select('id, type, status, livemode, attempts, error, organization_id, received_at, processed_at')
    .order('received_at', { ascending: false })
    .limit(limite)
  if (estStatut(statutDemande)) requeteJournal = requeteJournal.eq('status', statutDemande)

  const journalBrut = await requeteJournal

  // `listeLue` plutôt qu'un `?? []` : une lecture en panne et un journal vide
  // sont deux faits opposés, et le second est rassurant à tort (§E.22).
  // C'est aussi ici la seule chose qui empêche d'écrire « aucun événement reçu »
  // quand la vérité est « je n'ai pas pu lire le journal ».
  // ⚠️ `error` EST TRANSPORTÉE TELLE QUELLE, ET LA PROJECTION N'A LIEU QU'APRÈS.
  //    Mapper d'abord puis tester l'erreur produirait un tableau vide sur une
  //    panne — la valeur neutre exacte que `listeLue` existe pour interdire.
  //    Ici, `error` non nulle rend `{ etat: 'indisponible' }` et les lignes ne
  //    sont jamais atteintes.
  const journal = etatJournal(
    listeLue<LigneJournal>({
      data:
        journalBrut.data === null
          ? null
          : journalBrut.data.map((l) => ({
              id: l.id as string,
              type: l.type as string,
              statut: l.status as StatutEvenement,
              livemode: l.livemode as boolean,
              tentatives: Number(l.attempts ?? 0),
              erreur: (l.error as string | null) ?? null,
              organizationId: (l.organization_id as string | null) ?? null,
              recuLe: l.received_at as string,
              cloturLe: (l.processed_at as string | null) ?? null,
            })),
      error: journalBrut.error,
    }),
    maintenant,
  )

  // ── 2. LES DEUX PHOTOS, LUES EN PARALLÈLE ────────────────────────────────
  const [organisationsRes, packagesRes, liaisons, abonnementsLus, endpointsLus] = await Promise.all([
    admin
      .from('organizations')
      .select(
        'id, company_name, stripe_customer_id, stripe_subscription_id, package_id, package_valid_until, package_source_event_at',
      ),
    admin.from('packages').select('id, slug, price_monthly, is_default, active'),
    // Les identifiants Stripe ne vivent plus sur `packages` : ils sont clés
    // PAR MODE dans `packages_stripe` (migration `catalogue_stripe_par_mode`).
    lireToutesLesLiaisons(admin).catch(() => null),
    lireAbonnements(),
    lireEndpoints(),
  ])

  // ── 3. LE CATALOGUE LOCAL FAIT FOI ───────────────────────────────────────
  //  On traduit un prix Stripe en offre Skilloria par l'identifiant de prix
  //  QUE NOUS AVONS ÉCRIT. On ne lit jamais le montant ni le nom du produit
  //  chez Stripe : ce serait rouvrir la double source de vérité que tout le
  //  socle évite. C'est une décision figée.
  //  ⚠️ ET LE CATALOGUE A UN MODE. Un `price_...` de test n'existe pas en
  //  live : construire la table de traduction sans filtrer sur le mode ferait
  //  résoudre un abonnement live avec un prix de test, ou l'inverse.
  const cleCatalogue = resolveCatalogueKey()
  const modeCourant = cleCatalogue.ok ? modeDeLaCle(cleCatalogue.live) : null

  const slugParId = new Map<string, string>()
  for (const p of packagesRes.data ?? []) slugParId.set(p.id as string, p.slug as string)

  const catalogue: CataloguePrix = new Map()
  for (const l of liaisons ?? []) {
    if (modeCourant !== null && l.mode !== modeCourant) continue
    const slug = slugParId.get(l.packageId)
    if (!slug) continue
    for (const prix of [l.priceIdMonthly, l.priceIdYearly]) {
      if (typeof prix === 'string' && prix) catalogue.set(prix, { packageId: l.packageId, slug })
    }
  }

  //  LE RACCORDEMENT DU CATALOGUE — ce qui est relié, et dans quel mode.
  //
  //  Il se lit SANS `ENABLE_BILLING` : relier n'est pas encaisser (§D.16), et
  //  c'est justement avant d'ouvrir l'encaissement qu'on a besoin de savoir si
  //  le catalogue est prêt. Une clé absente n'est pas « zéro offre reliée » :
  //  c'est `impossible`, avec son motif.
  const catalogueRelie: EtatCatalogueRelie =
    !cleCatalogue.ok
      ? {
          etat: 'impossible',
          motif:
            cleCatalogue.code === 'billing_key_missing'
              ? 'cle_absente'
              : cleCatalogue.code === 'billing_key_env_mismatch'
                ? 'cle_env_mismatch'
                : 'cle_malformee',
          detail: cleCatalogue.detail,
        }
      : liaisons === null || packagesRes.error
        ? {
            etat: 'impossible',
            motif: 'lecture_locale',
            detail: packagesRes.error?.message ?? 'lecture de packages_stripe en échec',
          }
        : etatCatalogueRelie({
            modeCourant: modeDeLaCle(cleCatalogue.live),
            offres: (packagesRes.data ?? []).map(
              (p): OffreCatalogue => ({
                id: p.id as string,
                slug: p.slug as string,
                priceMonthly: (p.price_monthly as string | number | null) ?? null,
                isDefault: Boolean(p.is_default),
                active: Boolean(p.active),
              }),
            ),
            liaisons,
          })
  const slugParPackage = slugParId

  // ── 4. LA LECTURE LOCALE PEUT ÉCHOUER, ET ELLE NE SE DÉGUISE PAS ─────────
  //  Une erreur sur `organizations` ou `packages` n'est PAS « zéro écart ».
  //  Elle emprunte la même branche `'impossible'` que les pannes Stripe, avec
  //  son motif propre : l'exploitant doit savoir de quel côté regarder.
  const abonnementsPourComparaison: LectureStripe<AbonnementStripe[]> =
    organisationsRes.error || packagesRes.error
      ? indisponible(
          'lecture_locale',
          organisationsRes.error?.message ?? packagesRes.error?.message ?? 'lecture locale en échec',
        )
      : abonnementsLus.etat === 'indisponible'
        ? indisponible(abonnementsLus.motif, abonnementsLus.detail)
        : disponible(abonnementsLus.valeur.abonnements)

  const locaux: DroitLocal[] = (organisationsRes.data ?? []).map((o) => ({
    organizationId: o.id as string,
    organizationName: (o.company_name as string | null) ?? null,
    stripeCustomerId: (o.stripe_customer_id as string | null) ?? null,
    stripeSubscriptionId: (o.stripe_subscription_id as string | null) ?? null,
    packageId: (o.package_id as string | null) ?? null,
    packageSlug: slugParPackage.get((o.package_id as string) ?? '') ?? null,
    packageValidUntil: (o.package_valid_until as string | null) ?? null,
    packageSourceEventAt: (o.package_source_event_at as string | null) ?? null,
  }))

  const ecarts = comparerDroits({
    locaux,
    abonnements: abonnementsPourComparaison,
    catalogue,
    maintenant,
  })

  // ── 5. LA SANTÉ DU RACCORDEMENT ──────────────────────────────────────────
  //  `abonnementsOuvrants` reste `null` quand on n'a pas pu lire Stripe. Le
  //  remplacer par 0 dirait « il n'y a rien à recevoir », ce qui éteindrait
  //  l'alerte de silence au moment précis où on ne sait plus rien (§E.22).
  const OUVRANTS = new Set(['active', 'trialing', 'past_due'])
  const abonnementsOuvrants =
    abonnementsLus.etat === 'disponible'
      ? abonnementsLus.valeur.abonnements.filter((a) => OUVRANTS.has(a.statut)).length
      : null

  // Le dernier événement se lit sur le JOURNAL COMPLET, jamais sur la page
  // affichée : un filtre `statut=failed` ferait croire au silence dès qu'aucun
  // événement n'a échoué — c'est-à-dire exactement quand tout va bien.
  const dernierRes = await admin
    .from('stripe_events')
    .select('received_at, livemode')
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // ⚠️ `dernier` reste null AUSSI quand la lecture échoue, et c'est délibéré :
  //    `classerRaccordement` ne déclenche l'alerte de silence que s'il y a
  //    quelque chose à recevoir, donc un `null` de panne n'invente aucune
  //    alerte. Mais il ne l'ÉTEINT pas non plus en affichant une fausse date.
  const dernier = dernierRes.error ? null : dernierRes.data
  const sante = etatRaccordement(
    {
      secretPresent: resolveWebhookSecret().ok,
      production: isProduction(),
      endpoints: endpointsLus,
      origineDuSite: siteOrigin(),
      dernierRecuLe: dernier === null ? null : (dernier.received_at as string),
      dernierLivemode: dernier === null ? null : (dernier.livemode as boolean),
      abonnementsOuvrants,
    },
    maintenant,
  )

  // ── 6. LA DERNIÈRE NUIT VÉRIFIÉE ─────────────────────────────────────────
  const nuitRes = await admin
    .from('stripe_reconciliation_runs')
    .select('etat, motif_impossible, fenetre_debut, fenetre_fin, evenements_stripe, evenements_locaux, manquants, ids_manquants, tronque, ran_at')
    .order('ran_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return json({
    journal,
    ecarts,
    sante,
    // Ce qui est relié chez Stripe, et DANS QUEL MODE. Sans lui, un catalogue
    // relié en test se lisait comme un catalogue prêt pour la production.
    catalogue_relie: catalogueRelie,
    // `null` = on n'a pas pu lire l'historique. `'aucune'` = la vérification n'a
    // jamais tourné. Les deux appellent des actions opposées, et la même absence
    // les confondrait (même distinction que `etatRepartition`).
    derniere_nuit: nuitRes.error ? null : (nuitRes.data ?? 'aucune'),
    // La lecture du journal a-t-elle été bornée — l'écran doit pouvoir le dire
    // plutôt que de laisser croire qu'il montre tout (§E.26).
    journal_limite: limite,
    journal_filtre: estStatut(statutDemande) ? statutDemande : null,
    abonnements_tronques:
      abonnementsLus.etat === 'disponible' ? abonnementsLus.valeur.tronque : null,
  })
}

/**
 * POST /api/admin/facturation — ROUVRIR UN ÉVÉNEMENT COINCÉ.
 *
 * ┌─ CE QUE CE BOUTON FAIT, ET CE QU’IL NE FAIT PAS ───────────────────────┐
 * │ Il repasse UNE ligne de `'received'` à `'failed'`. Rien d'autre : il    │
 * │ ne rejoue pas l’événement, il ne touche à aucun droit, il n’écrit ni    │
 * │ abonnement ni transaction. Il REND la ligne réclamable par             │
 * │ `stripe_event_claim`, dont le `where se.status = 'failed'` est la       │
 * │ garde d’idempotence — elle reste intacte.                               │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POURQUOI UN HUMAIN, ET PAS UN DÉLAI DE GRÂCE AUTOMATIQUE ─────────────┐
 * │ Un `received` qui redeviendrait réclamable tout seul au bout de N       │
 * │ minutes ouvrirait une course avec un processus LENT MAIS VIVANT — et    │
 * │ transformerait une propriété vérifiable en pari sur un chronomètre.     │
 * │ Arbitrage rendu par Youssef le 20/09/2026 : reprise EXPLICITE, tracée,  │
 * │ déclenchée par un humain. Le délai automatique est REFUSÉ.              │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ LA CONDITION QUI REND CE BOUTON ACCEPTABLE, ET ELLE EST MESURÉE ──────┐
 * │ Rejouer un événement doit être INOFFENSIF. Ça l’est aujourd’hui, par    │
 * │ construction et non par chance :                                        │
 * │  · `applyPackageState` écrit l’ÉTAT ABSOLU, jamais un delta, sous la    │
 * │    garde `package_source_event_at` — son en-tête dit lui-même « c’est   │
 * │    ce qui rend un rejeu inoffensif » ;                                  │
 * │  · `extendValidity` rend `'stale'` si un événement plus récent a écrit ; │
 * │  · l’écriture de `transactions` est un `upsert` adossé à un INDEX       │
 * │    UNIQUE PARTIEL sur `stripe_invoice_id` (§E.31 : la garde est dans le │
 * │    schéma, elle ne dépend d’aucune discipline).                          │
 * │                                                                          │
 * │ D’où le cas que l’architecte a posé — un `invoice.paid` de trois jours  │
 * │ dont l’abonnement est résilié depuis : le rejeu écrit la transaction    │
 * │ (c’est un FAIT, l’argent a été pris) et la prolongation de validité     │
 * │ rend `'stale'`, parce que la résiliation est plus récente.              │
 * │ **L’abonnement résilié ne ressuscite pas.**                              │
 * │                                                                          │
 * │ ⚠️ CETTE PROPRIÉTÉ EST GARDÉE PAR `diag-billing-socle`, ET SANS CE      │
 * │    CONTRÔLE CE BOUTON N’EXISTERAIT PAS. Un SEPTIÈME gestionnaire qui    │
 * │    écrirait un delta — un remboursement, un avoir, un compteur — la     │
 * │    casserait EN SILENCE, et la reprise deviendrait un double crédit.    │
 * └────────────────────────────────────────────────────────────────────────┘
 */
export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  let corps: { evenement_id?: unknown; motif?: unknown }
  try {
    corps = (await request.json()) as { evenement_id?: unknown; motif?: unknown }
  } catch {
    return json({ error: 'Invalid body', code: 'bad_request' }, 400)
  }
  const evenementId = typeof corps.evenement_id === 'string' ? corps.evenement_id.trim() : ''
  const motif = typeof corps.motif === 'string' ? corps.motif.trim() : ''
  if (!evenementId) {
    return json({ error: 'Missing event id', code: 'evenement_id_manquant' }, 400)
  }
  // LE MOTIF EST EXIGÉ, et ce n’est pas une formalité : une reprise d’argent
  // sans raison écrite est une reprise que personne ne saura expliquer dans
  // six mois. C’est la moitié « tracée » de l’arbitrage.
  if (motif.length < 10) {
    return json({ error: 'A reason is required', code: 'motif_requis' }, 400)
  }

  // ⚠️ LA GARDE EST DANS LE `WHERE`, PAS DANS UNE LECTURE PRÉALABLE (§E.31).
  //    Lire puis écrire laisserait une fenêtre où le processus d’origine
  //    clôture entre les deux — et on rouvrirait un événement déjà traité.
  //    Les trois conditions sont portées par l'UPDATE lui-même : la ligne est
  //    encore en `'received'`, et elle l'est depuis plus longtemps que le
  //    plafond de durée du webhook ne le permet.
  const limite = new Date(Date.now() - MINUTES_AVANT_COINCE * 60_000).toISOString()
  const { data: rouvertes, error: majErr } = await auth.supabaseAdmin
    .from('stripe_events')
    .update({ status: 'failed', error: `rouvert manuellement — ${motif}` })
    .eq('id', evenementId)
    .eq('status', 'received')
    .lt('received_at', limite)
    .select('id, type, received_at')

  if (majErr) {
    console.error('[admin:facturation] réouverture en panne', { evenementId, message: majErr.message })
    return json(
      { error: 'Could not reopen the event', code: 'reouverture_indisponible' },
      503,
    )
  }
  // Zéro ligne : la ligne n’est plus coincée — déjà clôturée, ou trop récente.
  // Ce n’est PAS une erreur, et ce n’est pas un succès : on le dit.
  if (!rouvertes || rouvertes.length === 0) {
    return json(
      { error: 'Event is not stuck (any more)', code: 'evenement_non_coince' },
      409,
    )
  }

  const ligne = rouvertes[0] as { id: string; type: string; received_at: string }
  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'stripe_event_reouvert',
    entity_type: 'stripe_event',
    entity_id: ligne.id,
    detail: { type: ligne.type, recu_le: ligne.received_at, motif },
    request,
  })

  return json({ rouvert: true, evenement_id: ligne.id, type: ligne.type }, 200)
}
