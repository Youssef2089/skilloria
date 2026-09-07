import { NextRequest } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { runMatchingForExpert } from '@/lib/matching'
import { prochaineRelance, solderRelance } from '@/lib/matching/relance'

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

  const file = await prochaineRelance(admin)
  if (!file.ok) return json({ error: 'Query failed', code: 'db_error', detail: file.raison }, 500)
  if (!file.profileId) {
    // File vide : ce n'est pas un incident, c'est le cas normal.
    return json({ ok: true, relance: null, note: 'Aucune relance arrivée à échéance.' }, 200)
  }

  // L'instant du début, AVANT le run. C'est lui qui permettra de distinguer un
  // déclenchement d'avant (soldé) d'un déclenchement pendant (conservé).
  const debutRun = new Date()
  const verdict = await runMatchingForExpert({ supabaseAdmin: admin, profileId: file.profileId })
  const { soldee } = await solderRelance(admin, file.profileId, debutRun)

  // Le verdict est rendu TEL QUEL, y compris en échec. Un pilote qui répond
  // toujours « ok » rend la supervision aveugle.
  return json(
    {
      ok: verdict.status === 'ok',
      relance: file.profileId,
      status: verdict.status,
      soldee,
      note: verdict.notes,
      model: verdict.model,
    },
    200,
  )
}

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request)
}

export async function POST(request: NextRequest): Promise<Response> {
  return handle(request)
}
