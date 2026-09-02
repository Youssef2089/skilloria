import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/cron-jobs/[name]/runs — historique d'exécution d'une tâche.
 *
 * LECTURE SEULE. Renvoie `{ job, runs, total, page, per_page, has_more }`.
 *
 * ═══ POURQUOI LA FICHE RECHARGE AUSSI LA VUE D'ENSEMBLE ════════════════════
 *   On appelle `admin_cron_jobs_overview()` en plus de l'historique, et on y
 *   sélectionne la tâche demandée. Cela coûte une lecture de cinq lignes, et
 *   cela achète deux choses :
 *
 *   1. Un vrai 404. Sans elle, un nom inexistant renverrait « historique vide »
 *      — indiscernable d'une tâche qui n'a jamais tourné, alors que ce sont
 *      deux diagnostics opposés.
 *   2. UN SEUL calcul d'état de santé. Recalculer le verdict ici, sur un jeu de
 *      colonnes différent, garantirait qu'un jour la liste et la fiche se
 *      contredisent. L'écran de détail affiche EXACTEMENT ce que la liste
 *      affiche.
 *
 * ═══ PAGINATION ════════════════════════════════════════════════════════════
 *   `total` est un COUNT exact sur le même jeu que la liste (fenêtre
 *   `count(*) over ()` côté SQL) : le compteur décrit ce qu'on pagine, il ne
 *   peut pas mentir. Aucun écrêtage muet — leçon MAX_ORGS.
 *
 *   OFFSET assumé ici : c'est un historique consulté à la main, et une
 *   exécution insérée pendant la pagination décale au pire une ligne. Le
 *   même choix que /api/admin/list-users.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** `true` si l'erreur signifie « la fonction n'existe pas encore ». */
function isMissingFunction(error: { code?: string | null; message?: string | null }): boolean {
  const code = error.code ?? ''
  if (code === 'PGRST202' || code === '42883') return true
  const msg = (error.message ?? '').toLowerCase()
  return msg.includes('could not find the function') || msg.includes('does not exist')
}

const PER_PAGE = 25
/** Noms pg_cron : le paramètre est un identifiant, pas du texte libre. */
const JOB_NAME_REGEX = /^[A-Za-z0-9_-]{1,128}$/

type Ctx = { params: Promise<{ name: string }> }

type OverviewRow = { job_name: string }

export async function GET(request: NextRequest, ctx: Ctx): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { name } = await ctx.params
  const jobName = decodeURIComponent(name ?? '')
  if (!JOB_NAME_REGEX.test(jobName)) {
    return json({ error: 'Invalid job name', code: 'invalid_name' }, 400)
  }

  const page = Math.max(1, Number.parseInt(request.nextUrl.searchParams.get('page') ?? '1', 10) || 1)
  const offset = (page - 1) * PER_PAGE

  const [overviewRes, runsRes] = await Promise.all([
    auth.supabaseAdmin.rpc('admin_cron_jobs_overview'),
    auth.supabaseAdmin.rpc('admin_cron_job_runs', {
      p_job_name: jobName,
      p_limit: PER_PAGE,
      p_offset: offset,
    }),
  ])

  for (const res of [overviewRes, runsRes]) {
    if (res.error && isMissingFunction(res.error)) {
      console.warn('[admin:cron-jobs/runs] fonction absente — migration non poussée ?', res.error.message)
      return json(
        {
          error: 'Supervision functions not deployed',
          code: 'migration_pending',
          migration: '20260902000000_cron_job_runs_history.sql',
        },
        503,
      )
    }
  }
  if (overviewRes.error || runsRes.error) {
    console.error(
      '[admin:cron-jobs/runs] query failed',
      overviewRes.error?.message ?? runsRes.error?.message,
    )
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  const job = ((overviewRes.data ?? []) as OverviewRow[]).find((j) => j.job_name === jobName) ?? null
  if (!job) {
    // La tâche n'existe pas dans cron.job — distinct d'un historique vide.
    return json({ error: 'Job not found', code: 'not_found' }, 404)
  }

  const runs = (runsRes.data ?? []) as Array<{ total_count: number }>
  // `total_count` est identique sur toutes les lignes (fenêtre) ; 0 ligne = 0
  // exécution, ce qui est un FAIT (« planifiée, jamais exécutée »), pas un vide.
  const total = runs.length > 0 ? Number(runs[0].total_count) : 0

  return json(
    {
      job,
      runs,
      total,
      page,
      per_page: PER_PAGE,
      has_more: offset + runs.length < total,
    },
    200,
  )
}
