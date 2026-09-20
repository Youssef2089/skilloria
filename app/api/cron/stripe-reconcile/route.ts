import { NextRequest } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { prendreBailRun, rendreBailRun } from '@/lib/cron/bail-de-run'
import { motifEstNormal } from '@/lib/stripe-exploitation/etat'
import { lireEvenements } from '@/lib/stripe-exploitation/lecture-stripe'
import { TYPES_TRAITES } from '@/lib/stripe-exploitation/raccordement'

/** Nom du bail ET du job pg_cron. MÊME valeur : c'est la TÂCHE qu'on garde. */
const JOB = 'stripe_reconcile_trigger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Deux paginations (Stripe puis la base) sur une fenêtre de 24 h. Le plafond
// Hobby est 60 ; les crons longs montent à 300, et une vérification coupée au
// milieu rendrait un écart FAUX — plus dangereux qu'aucun écart.
export const maxDuration = 300

/**
 * GET /api/cron/stripe-reconcile — CE QU'ON AURAIT DÛ RECEVOIR.
 *
 * ┌─ POURQUOI ELLE EXISTE, ET STRIPE LE RECOMMANDE LUI-MÊME ────────────────┐
 * │ La livraison d'un webhook n'est pas une garantie. Elle peut échouer, être │
 * │ rejetée par une signature devenue fausse, ou tomber pendant une           │
 * │ indisponibilité de notre côté — et dans le cas de la signature, la route  │
 * │ répond 400 AVANT d'écrire quoi que ce soit : il ne reste AUCUNE trace.    │
 * │                                                                          │
 * │ L'API Events est la seule source qui sache ce qui a EXISTÉ. Elle conserve │
 * │ 30 jours : au-delà, un événement manqué devient introuvable, et le trou   │
 * │ définitif. C'est ce qui impose une cadence quotidienne.                   │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ ELLE SIGNALE. ELLE NE RETRAITE PAS. ───────────────────────────────────┐
 * │ Aucun événement n'est rejoué ici, aucun droit n'est écrit, aucune offre  │
 * │ n'est appliquée. Retraiter automatiquement un événement de paiement est  │
 * │ un lot à lui seul : il faut décider ce qu'on fait d'un `invoice.paid`    │
 * │ vieux de trois jours dont l'abonnement a déjà été résilié depuis — et    │
 * │ cette décision est un arbitrage d'argent, pas une ligne de code.         │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ LE RAPPROCHEMENT SE FAIT PAR IDENTIFIANT, JAMAIS PAR FENÊTRE DE TEMPS ─┐
 * │ On demande à Stripe les événements d'une fenêtre, puis on cherche CES    │
 * │ identifiants-là dans notre journal. Comparer deux fenêtres de temps      │
 * │ ferait dépendre le verdict de l'écart entre `created` chez Stripe et     │
 * │ `received_at` chez nous — c'est-à-dire de la latence réseau et de        │
 * │ l'horloge des deux machines. Un identifiant, lui, ne dérive pas.         │
 * └────────────────────────────────────────────────────────────────────────┘
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function getAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Missing Supabase env (URL or SERVICE_ROLE_KEY)')
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * LA MARGE DE DÉCANTATION, ET ELLE EST LA DIFFÉRENCE ENTRE UN ÉCART UTILE ET UN BRUIT.
 *
 * Un événement créé il y a trois minutes peut légitimement ne pas encore être
 * arrivé : Stripe le livre, on le traite, la ligne s'écrit. Sans marge, chaque
 * passage dénoncerait les quelques événements en vol comme « manquants » —
 * l'écart ne serait JAMAIS nul, et un écart toujours rouge n'est plus lu.
 *
 * La fenêtre s'arrête donc une heure avant maintenant. Rien n'est perdu : le
 * passage du lendemain commence exactement là où celui-ci s'arrête (24 h de
 * fenêtre, 24 h de cadence), donc la couverture est CONTINUE et sans trou.
 */
const MARGE_DE_DECANTATION_MS = 60 * 60 * 1000
const FENETRE_MS = 24 * 60 * 60 * 1000

/** `.in()` sur une liste trop longue fait une URL trop longue. On découpe. */
const TAILLE_LOT = 200

async function handle(request: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[stripe-reconcile] CRON_SECRET absent')
    return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
  }
  const authHeader = request.headers.get('authorization') ?? ''
  const querySecret = request.nextUrl.searchParams.get('secret') ?? ''
  if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
    return json({ error: 'Unauthorized', code: 'unauthorized' }, 401)
  }

  const admin = getAdmin()

  // Fail-closed : sans bail on ne tourne pas. Sauter un passage se rattrape le
  // lendemain ; deux passages simultanés écriraient deux lignes de constat pour
  // la même nuit, et l'historique mentirait sur sa propre cadence.
  const bail = await prendreBailRun(admin, { job: JOB, maxDurationSec: maxDuration })
  if (bail === 'occupe') {
    return json({ ok: true, note: 'Une vérification est déjà en cours.' }, 200)
  }
  if (bail === 'erreur') {
    return json({ error: 'Run lease unavailable', code: 'bail_indisponible' }, 503)
  }

  const debutChrono = Date.now()
  const jusqua = new Date(debutChrono - MARGE_DE_DECANTATION_MS)
  const depuis = new Date(jusqua.getTime() - FENETRE_MS)

  /**
   * Écrit le constat. `etat` D'ABORD : la contrainte de base refuse un compteur
   * posé à côté d'un état 'impossible', et refuse un état 'impossible' sans
   * motif. On ne peut donc pas écrire « 0 manquant » sur une nuit où l'on n'a
   * rien pu comparer — c'est la garde qui porte tout le module.
   */
  const consigner = async (ligne: Record<string, unknown>): Promise<void> => {
    const { error } = await admin.from('stripe_reconciliation_runs').insert({
      fenetre_debut: depuis.toISOString(),
      fenetre_fin: jusqua.toISOString(),
      duree_ms: Date.now() - debutChrono,
      ...ligne,
    })
    if (error) {
      // On journalise bruyamment et on laisse la route rendre son verdict : le
      // travail a eu lieu, le perdre en silence serait pire. L'écran verra
      // « aucune vérification depuis N jours », ce qui est vrai de sa trace.
      console.error('[stripe-reconcile] écriture du constat en échec', error.message)
    }
  }

  try {
    // ── 1. CE QUE STRIPE A ─────────────────────────────────────────────────
    const chezStripe = await lireEvenements({ depuis, jusqua, types: TYPES_TRAITES })
    if (chezStripe.etat === 'indisponible') {
      await consigner({ etat: 'impossible', motif_impossible: chezStripe.motif })
      // ⚠️ MUR FERMÉ = CAS NOMINAL, PAS UNE PANNE. Répondre 500 sur
      //    `billing_disabled` ferait apparaître un incident permanent dans
      //    l'historique des tâches planifiées — et on apprendrait à l'ignorer,
      //    exactement au moment où il dirait vrai.
      const normal = motifEstNormal(chezStripe.motif)
      console[normal ? 'log' : 'error'](
        `[stripe-reconcile] comparaison impossible — ${chezStripe.motif} : ${chezStripe.detail}`,
      )
      return json(
        { ok: normal, etat: 'impossible', motif: chezStripe.motif },
        normal ? 200 : 503,
      )
    }

    const evenements = chezStripe.valeur.evenements
    const ids = evenements.map((e) => e.id)

    // ── 2. CE QUE NOUS AVONS, CHERCHÉ PAR IDENTIFIANT ──────────────────────
    const connus = new Set<string>()
    for (let i = 0; i < ids.length; i += TAILLE_LOT) {
      const lot = ids.slice(i, i + TAILLE_LOT)
      const { data, error } = await admin.from('stripe_events').select('id').in('id', lot)
      if (error) {
        // ⚠️ ON NE POURSUIT PAS AVEC UN LOT MANQUANT. Un lot non lu ferait
        //    passer ses 200 événements pour « absents chez nous » : on
        //    annoncerait une perte massive sur une panne de lecture. C'est
        //    §E.22 dans sa forme la plus coûteuse — un chiffre faux, alarmant,
        //    au moment de décider.
        await consigner({ etat: 'impossible', motif_impossible: 'lecture_locale' })
        console.error('[stripe-reconcile] lecture du journal local en échec', error.message)
        return json({ error: 'Journal unreadable', code: 'lecture_locale' }, 503)
      }
      for (const l of data ?? []) connus.add(l.id as string)
    }

    const manquants = evenements.filter((e) => !connus.has(e.id))

    await consigner({
      etat: 'compare',
      evenements_stripe: evenements.length,
      evenements_locaux: connus.size,
      manquants: manquants.length,
      ids_manquants: manquants.map((e) => e.id),
      tronque: chezStripe.valeur.tronque,
    })

    if (manquants.length > 0) {
      // Un écart non nul est soit un événement manqué, soit un défaut de
      // traitement. Les deux sont de VRAIS problèmes, et ils remontent dans
      // /admin/supervision — où le rouge est réservé à ce qui ne se fait pas.
      console.error(
        `[stripe-reconcile] ${manquants.length} événement(s) chez Stripe et absents du journal :`,
        manquants.map((e) => `${e.id} (${e.type})`).join(', '),
      )
    }

    return json({
      ok: true,
      etat: 'compare',
      fenetre: { debut: depuis.toISOString(), fin: jusqua.toISOString() },
      evenements_stripe: evenements.length,
      evenements_locaux: connus.size,
      manquants: manquants.length,
      ids_manquants: manquants.map((e) => e.id),
      tronque: chezStripe.valeur.tronque,
    })
  } finally {
    await rendreBailRun(admin, JOB)
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request)
}

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request)
}
