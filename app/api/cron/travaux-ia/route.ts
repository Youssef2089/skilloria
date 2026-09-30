import { NextRequest } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { sousVerdictDeRun } from '@/lib/cron/verdict-de-run'
import { prendreBailRun, rendreBailRun } from '@/lib/cron/bail-de-run'
import { executerTravauxDus } from '@/lib/travaux-ia/executant'

/** Nom du passage dans `cron_run_log` — le même que celui que pose `reveiller_travaux_ia()` — et du bail. */
const JOB = 'travaux_ia'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Une vérification peut faire trois appels de 45 s ; l'exécutant ne PREND un travail que
// s'il lui reste de quoi le finir. Même plafond que les autres tâches (cron/expert-relance).
export const maxDuration = 300

/**
 * POST /api/cron/travaux-ia — L'EXÉCUTANT des travaux d'IA longs (§D.30).
 *
 * Appelé par la BASE, jamais par un navigateur : `reveiller_travaux_ia()` le réveille
 * au dépôt d'un travail, et le pilote pg_cron `travaux_ia_pilote` chaque minute s'il
 * reste du travail dû. Aucun cron d'hébergeur. Authentifié par `CRON_SECRET`, comme
 * les cinq autres tâches.
 *
 * ═══ DEUX BAUX, ET ILS NE DISENT PAS LA MÊME CHOSE ═════════════════════════
 *   · le bail de CHAQUE TRAVAIL (`prendre_travail_ia`, `for update skip locked`) garantit
 *     qu'un travail n'est exécuté qu'une fois — c'est lui qui porte la justesse ;
 *   · le bail de la ROUTE (celui-ci, comme toute tâche du dépôt) garantit qu'UN SEUL
 *     exécutant tourne : il vide la file dans son budget de temps, et un second réveil
 *     trouve « occupé » — ce n'est pas un incident. Il borne les appels simultanés au
 *     fournisseur d'IA, sans rien retirer à la reprise : un travail dû pendant qu'il
 *     tourne est pris par lui, ou par le pilote à la minute suivante.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

function getAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Missing Supabase env (URL or SERVICE_ROLE_KEY)')
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function handle(request: NextRequest): Promise<Response> {
  const debut = Date.now()
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[travaux-ia] CRON_SECRET absent')
    return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
  }
  if ((request.headers.get('authorization') ?? '') !== `Bearer ${secret}`) {
    return json({ error: 'Unauthorized', code: 'unauthorized' }, 401)
  }
  const admin = getAdmin()

  // FAIL-CLOSED : un bail indisponible ⇒ on ne tourne pas ; le pilote réveillera à la minute suivante.
  const bail = await prendreBailRun(admin, { job: JOB, maxDurationSec: maxDuration })
  if (bail === 'occupe') {
    // PAS un incident : un exécutant vide déjà la file.
    return json({ ok: true, note: 'Un exécutant tourne déjà.' }, 200)
  }
  if (bail === 'erreur') {
    return json({ error: 'Run lease unavailable', code: 'bail_indisponible' }, 503)
  }

  try {
    // On s'arrête de PRENDRE avant la fin : 20 s de marge sous le plafond.
    const bilan = await executerTravauxDus(admin, debut + (maxDuration - 20) * 1000)
    // Le bilan est rendu TEL QUEL, échecs compris : un pilote qui répond toujours « ok » rend la supervision aveugle.
    return json({ ok: bilan.arret !== 'file_illisible', ...bilan }, bilan.arret === 'file_illisible' ? 503 : 200)
  } finally {
    // ON REND LE BAIL SUR TOUS LES CHEMINS : un réveil qui suit ne doit pas attendre la grâce du bail.
    await rendreBailRun(admin, JOB)
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  return sousVerdictDeRun(request, JOB, getAdmin, () => handle(request))
}
