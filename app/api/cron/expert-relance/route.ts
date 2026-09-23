import { NextRequest } from 'next/server'
import { sousVerdictDeRun } from '@/lib/cron/verdict-de-run'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { runMatchingForExpert } from '@/lib/matching'
import {
  codeDEchec,
  echouerRelance,
  marquerTentativeRelance,
  prochaineRelance,
  runAcheve,
  solderRelance,
} from '@/lib/matching/relance'
import { prendreBailRun, rendreBailRun } from '@/lib/cron/bail-de-run'

/** Nom du bail. MÊME valeur pour GET et POST : c'est la TÂCHE qu'on garde. */
const JOB = 'expert_relance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Un run peut noter toutes les annonces ouvertes d'un écosystème, par lots.
export const maxDuration = 300

/**
 * GET /api/cron/expert-relance — EXÉCUTE une relance arrivée à échéance.
 *
 * ═══ CE QU'ELLE FINIT ═════════════════════════════════════════════════════
 *   Un expert a modifié son profil. On n'a pas noté tout de suite : on a posé
 *   une échéance à une heure, repoussée à chaque nouvelle modification. Cette
 *   route est ce qui arrive au bout de l'attente.
 *
 *   Sans elle, le report serait une annulation déguisée — et ce serait pire que
 *   le refus franc qu'il remplace.
 *
 * ═══ UNE SEULE RELANCE PAR PASSAGE ════════════════════════════════════════
 *   Vider la file entière supposerait un plafond de durée d'exécution qu'on ne
 *   contrôle pas. Une par passage, toutes les cinq minutes : la file se vide
 *   quand même, et aucun passage ne peut être coupé au milieu.
 *
 * ═══ L'ORDRE DES DEUX ÉCRITURES, ET IL COMPTE ═════════════════════════════
 *   On note l'instant du début AVANT de lancer le run, et on solde APRÈS avec
 *   cet instant-là. Un déclenchement arrivé PENDANT le run porte une échéance
 *   postérieure : il n'est pas soldé, et la relance repartira. Solder avec
 *   `now()` effacerait cette modification-là — le défaut même que ce mécanisme
 *   corrige.
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
  if (!url || !serviceKey) throw new Error('Missing Supabase env (URL or SERVICE_ROLE_KEY)')
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function handle(request: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[expert-relance] CRON_SECRET absent')
    return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
  }
  const authHeader = request.headers.get('authorization') ?? ''
  const querySecret = request.nextUrl.searchParams.get('secret') ?? ''
  if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
    return json({ error: 'Unauthorized', code: 'unauthorized' }, 401)
  }

  const admin = getAdmin()

  // ── BAIL DE RUN — la tâche la plus exposée du dépôt ─────────────────────
  //
  //  CADENCE */5 POUR UN RUN DE 300 s : le chevauchement n'était pas
  //  hypothétique, il était STRUCTUREL — exactement l'arithmétique du défaut de
  //  rejeu de matching fermé au lot 20260912200000, laissée ouverte sur la
  //  route sœur. Deux runs recevaient LE MÊME PROFIL et refaisaient le même
  //  travail d'IA.
  //
  //  FAIL-CLOSED : un bail indisponible ⇒ on ne tourne pas. Pour une tâche
  //  périodique, sauter un passage se rattrape cinq minutes plus tard ; tourner
  //  sans bail rouvre le chevauchement.
  const bail = await prendreBailRun(admin, { job: JOB, maxDurationSec: maxDuration })
  if (bail === 'occupe') {
    // PAS un incident : c'est le cas normal quand un run déborde sur le
    // suivant. On répond 200 pour ne pas polluer la supervision d'alertes.
    return json({ ok: true, relance: null, note: 'Un run est déjà en cours.' }, 200)
  }
  if (bail === 'erreur') {
    return json({ error: 'Run lease unavailable', code: 'bail_indisponible' }, 503)
  }

  try {
    const file = await prochaineRelance(admin)
    if (!file.ok) return json({ error: 'Query failed', code: 'db_error', detail: file.raison }, 500)
    if (!file.profileId) {
      // File vide : ce n'est pas un incident, c'est le cas normal.
      return json({ ok: true, relance: null, note: 'Aucune relance arrivée à échéance.' }, 200)
    }

    // L'instant du début, AVANT le run. C'est lui qui permettra de distinguer un
    // déclenchement d'avant (soldé) d'un déclenchement pendant (conservé).
    const debutRun = new Date()
    // LA TENTATIVE SE COMPTE AVANT LE RUN, comme côté annonce : un processus
    // tué en plein run laisserait sinon un compteur immobile, et la même
    // relance repartirait indéfiniment sans jamais approcher son plafond.
    await marquerTentativeRelance(admin, file.profileId)
    const verdict = await runMatchingForExpert({ supabaseAdmin: admin, profileId: file.profileId })

    // ⚠️ ON NE SOLDE QUE CE QUI A ABOUTI. Solder un run en échec pose le jalon
    //    et rien ne reprend : la modification de profil qui avait déclenché la
    //    relance n'est JAMAIS notée (§E.27 forme B). La décision est prise par
    //    `runAcheve()`, une seule fois pour les deux appelants (§E.20).
    const acheve = runAcheve(verdict)
    let soldee = false
    if (acheve) {
      ;({ soldee } = await solderRelance(admin, file.profileId, debutRun))
    } else {
      await echouerRelance(admin, file.profileId, codeDEchec(verdict))
    }

    // Le verdict est rendu TEL QUEL, y compris en échec. Un pilote qui répond
    // toujours « ok » rend la supervision aveugle.
    return json(
      {
        ok: verdict.status === 'ok',
        relance: file.profileId,
        status: verdict.status,
        acheve,
        soldee,
        note: verdict.notes,
        model: verdict.model,
      },
      200,
    )
  } finally {
    // ON REND LE BAIL SUR TOUS LES CHEMINS, y compris en erreur.
    //
    //  ET CE N'EST PAS UN CONFORT ICI : le délai de grâce vaut 2 × 300 s, soit
    //  dix minutes, pour une cadence de cinq. Sans restitution, un run terminé
    //  en trois secondes bloquerait le tick suivant et la file se viderait à
    //  moitié vitesse. La garantie, elle, ne dépend pas de cet appel : le bail
    //  expire seul, donc un processus tué ne coince rien.
    await rendreBailRun(admin, JOB)
  }
}

/**
 * ⚠️ LE PASSAGE SE CLÔT ICI, ET SUR TOUS LES CHEMINS DE SORTIE.
 *
 *    La tâche écrit son verdict elle-même au lieu de le poser chez `pg_net`,
 *    où il expire en ~6 h avant que la réconciliation ne passe : 7 201 passages
 *    sur 9 853 étaient sans verdict au 22/09/2026, soit 73 %.
 *
 *    Le guichet est PARTAGÉ par les cinq tâches — cinq copies auraient produit
 *    cinq occasions d'oublier une branche de sortie (§E.20), et celle qu'on
 *    oublie est toujours celle de l'échec, qu'on ne joue jamais.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return sousVerdictDeRun(request, JOB, getAdmin, () => handle(request))
}

export async function POST(request: NextRequest): Promise<Response> {
  return sousVerdictDeRun(request, JOB, getAdmin, () => handle(request))
}
