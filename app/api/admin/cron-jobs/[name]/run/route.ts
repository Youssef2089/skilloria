import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { cronJobAuditId } from '@/lib/admin/cron-audit-id'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/cron-jobs/[name]/run — DÉCLENCHER une tâche maintenant.
 *
 * Body : { confirm: true }
 *
 * ═══ PAS DE RÉ-AUTHENTIFICATION — ET LA RAISON N'EST PAS « C'EST ANODIN » ══
 *   `purge_deletions_trigger` anonymise des comptes : rien d'anodin là-dedans.
 *   Le risque est nul pour une raison différente et plus solide : les
 *   ÉCHÉANCES SONT CÔTÉ SERVEUR. La purge ne traite que les comptes déjà
 *   échus ; la déclencher n'avance aucune date. Le pire qu'une session
 *   détournée obtienne, c'est l'exécution anticipée de quelques heures d'un
 *   traitement qui allait tourner la nuit suivante.
 *
 *   La désactivation et la reprogrammation, elles, changent un état DURABLE et
 *   restent ré-authentifiées. La différence n'est pas le confort : c'est la
 *   réversibilité.
 *
 *   Ce qui reste exigé : une confirmation NOMMÉE à l'écran (l'action est dite,
 *   pas devinée) et une trace d'audit, comme les autres.
 *
 * ═══ DEUX EXÉCUTIONS SIMULTANÉES ═══════════════════════════════════════════
 *   Empêchées par un verrou consultatif de transaction, en base. Pas un
 *   drapeau `is_running` en table : celui-ci resterait à `true` pour toujours
 *   si le processus tombait entre la pose et la levée, et il faudrait un
 *   second mécanisme pour réparer le premier.
 *
 * ═══ DURÉE ═════════════════════════════════════════════════════════════════
 *   La fonction rejoue `cron.job.command`. Pour les deux purges, cette commande
 *   déclenche un appel pg_net ASYNCHRONE : elle rend la main immédiatement, la
 *   route HTTP travaille de son côté, et le verdict arrivera par la
 *   réconciliation. La réponse de cette route dit donc « déclenché », jamais
 *   « terminé » — et l'écran le formule ainsi.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function isMissingFunction(error: { code?: string | null; message?: string | null }): boolean {
  const code = error.code ?? ''
  if (code === 'PGRST202' || code === '42883') return true
  const msg = (error.message ?? '').toLowerCase()
  return msg.includes('could not find the function') || msg.includes('does not exist')
}

const JOB_NAME_REGEX = /^[A-Za-z0-9_-]{1,128}$/

type Ctx = { params: Promise<{ name: string }> }
type OverviewRow = {
  job_name: string
  active: boolean | null
  criticality: 'legal' | 'technical'
  catalogued: boolean
}

export async function POST(request: NextRequest, ctx: Ctx): Promise<Response> {
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

  let body: { confirm?: unknown }
  try {
    body = (await request.json()) as { confirm?: unknown }
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }
  // Drapeau explicite : une exécution ne part pas sur un POST vide. La garde est
  // faible par nature — c'est la confirmation nommée à l'écran qui porte le sens.
  if (body.confirm !== true) {
    return json({ error: 'Confirmation required', code: 'confirm_required' }, 400)
  }

  const { data: overview, error: overviewErr } = await auth.supabaseAdmin.rpc('admin_cron_jobs_overview')
  if (overviewErr) {
    if (isMissingFunction(overviewErr)) {
      return json({ error: 'Not deployed', code: 'migration_pending', migration: '20260901000003_cron_supervision_read.sql' }, 503)
    }
    console.error('[admin:cron-run] overview failed', overviewErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const job = ((overview ?? []) as OverviewRow[]).find((j) => j.job_name === jobName) ?? null
  if (!job) return json({ error: 'Job not found', code: 'not_found' }, 404)

  const { data: result, error: runErr } = await auth.supabaseAdmin.rpc('admin_cron_run_now', {
    p_job_name: jobName,
    p_triggered_by: auth.user.id,
  })

  if (runErr) {
    if (isMissingFunction(runErr)) {
      return json({ error: 'Not deployed', code: 'migration_pending', migration: '20260902000003_cron_manual_run.sql' }, 503)
    }
    const msg = runErr.message ?? ''
    if (msg.includes('cron_already_running')) {
      return json({ error: 'Already running', code: 'already_running' }, 409)
    }
    if (msg.includes('cron_job_not_found')) {
      return json({ error: 'Job not found', code: 'not_found' }, 404)
    }
    console.error('[admin:cron-run] run_now failed', msg)
    return json({ error: 'Could not trigger', code: 'run_failed' }, 500)
  }

  const row = ((result ?? []) as Array<{ started_at: string; logged_rows: number }>)[0] ?? null

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.user.domain_id,
    action: 'cron_job_triggered_manually',
    entity_type: 'cron_job',
    // UUID dérivé : audit_logs.entity_id est uuid NOT NULL, une tâche pg_cron
    // n'en a pas (cf. lib/admin/cron-audit-id.ts).
    entity_id: cronJobAuditId(jobName),
    detail: {
      job_name: jobName,
      criticality: job.criticality,
      // Déclencher une tâche DÉSACTIVÉE est permis (c'est le mécanisme de
      // rattrapage), mais c'est un fait à conserver : on a exécuté quelque
      // chose que quelqu'un avait peut-être arrêté volontairement.
      was_active: job.active,
      started_at: row?.started_at ?? null,
    },
    request,
  })

  return json({ ok: true, started_at: row?.started_at ?? null }, 200)
}
