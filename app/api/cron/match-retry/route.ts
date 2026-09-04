import { NextRequest } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { runMatchingForPublication } from '@/lib/matching'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Un run peut noter des dizaines de milliers de profils par lots.
export const maxDuration = 300

/**
 * GET /api/cron/match-retry — REJOUE UN run de mise en relation inachevé.
 *
 * ═══ POURQUOI CE PILOTE EXISTE ═════════════════════════════════════════════
 *   Deux pilotes applicatifs déclenchent déjà la mise en relation : le
 *   navigateur après publication, et le rattrapage à la lecture. Ils suffisent
 *   quand quelqu'un est là. Personne ne l'est un vendredi soir, et une annonce
 *   publiée à ce moment-là resterait sans candidats jusqu'au lundi sans que
 *   personne ne sache pourquoi.
 *
 *   L'ordonnancement vit dans la BASE (pg_cron), comme les purges légales, et ne
 *   dépend d'aucun ordonnanceur d'hébergeur.
 *
 * ═══ UN SEUL RUN PAR PASSAGE, ET C'EST DÉLIBÉRÉ ════════════════════════════
 *   Traiter la file entière supposerait un plafond de durée d'exécution qu'on ne
 *   contrôle pas. Un run par passage, toutes les cinq minutes : la file se vide
 *   quand même, et aucun passage ne peut être coupé au milieu.
 *
 * ═══ CE QU'IL NE FAIT PAS ══════════════════════════════════════════════════
 *   Il ne referme JAMAIS un run qu'il n'a pas achevé. Au-delà du plafond de
 *   tentatives, le run reste inachevé donc VISIBLE dans matching_health() : un
 *   trou qui reste ouvert vaut mieux qu'un trou refermé sur une erreur.
 */

const MAX_TENTATIVES = 5

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

async function handle(request: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[match-retry] CRON_SECRET absent')
    return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
  }
  const authHeader = request.headers.get('authorization') ?? ''
  const querySecret = request.nextUrl.searchParams.get('secret') ?? ''
  if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
    return json({ error: 'Unauthorized', code: 'unauthorized' }, 401)
  }

  const admin = getAdmin()

  // Le plus ANCIEN d'abord : une annonce oubliée ne doit pas être doublée par
  // une plus récente à chaque passage.
  const { data, error } = await admin.rpc('next_unfinished_matching_run', {
    p_max_attempts: MAX_TENTATIVES,
  })
  if (error) {
    console.error('[match-retry] recherche du run à rejouer en échec', error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  const publicationId = typeof data === 'string' ? data : null
  if (!publicationId) {
    // File vide : ce n'est pas un incident, c'est le cas normal.
    return json({ ok: true, rejoue: null, note: 'Aucun run inachevé à rejouer.' }, 200)
  }

  const verdict = await runMatchingForPublication({ supabaseAdmin: admin, publicationId })

  // On rend le verdict TEL QUEL, y compris quand il a échoué. Un pilote qui
  // répond toujours « ok » rend la supervision aveugle : c'est exactement le
  // motif que ce projet corrige partout.
  return json(
    {
      ok: verdict.status === 'ok',
      rejoue: publicationId,
      status: verdict.status,
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
