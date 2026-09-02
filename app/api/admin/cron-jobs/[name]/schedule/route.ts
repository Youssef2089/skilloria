import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { requireReauth } from '@/lib/reauth-token'
import { logAudit } from '@/lib/audit'
import { cronJobAuditId } from '@/lib/admin/cron-audit-id'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/cron-jobs/[name]/schedule — REPROGRAMMER une tâche.
 *
 * Body   : { frequency, minutes[], hour, days_of_week?[], day_of_month?, confirm_name }
 * Header : `x-reauth-token` obligatoire.
 *
 * ═══ AUCUNE EXPRESSION CRON N'EST ACCEPTÉE ═════════════════════════════════
 *   Le client n'envoie JAMAIS `"0 3 * * *"`. Il envoie des composants typés,
 *   que la base assemble. Raison : pg_cron valide la FORME d'une expression,
 *   pas sa SATISFIABILITÉ — `0 3 30 2 *` (30 février) est acceptée sans erreur
 *   et ne se déclenchera jamais. Aucune exception, aucune trace, la tâche
 *   s'arrête en silence.
 *
 *   Accepter une chaîne, c'est se donner un contrôle à écrire. Accepter des
 *   composants bornés, c'est rendre l'erreur IRREPRÉSENTABLE. Le plafond du
 *   jour du mois à 28 élimine la classe entière du problème.
 *
 * ═══ LE REFUS DE CHAÎNE NOMME ET PROPOSE ═══════════════════════════════════
 *   Un refus qui dit « non » oblige à deviner. Sur une violation de chaîne, on
 *   renvoie la tâche concernée, l'écart exigé, le sens (amont/aval), ET
 *   l'horaire valide le plus proche calculé par la base.
 *
 * ═══ LES DEUX BARRIÈRES, COMME LA BASCULE ══════════════════════════════════
 *   `requireReauth` + nom de la tâche retapé, revalidé ici. Un horaire faux est
 *   plus dangereux qu'une désactivation : la désactivation se VOIT (bandeau
 *   rouge permanent), un horaire jamais satisfait ne se voit pas.
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
const FREQUENCIES = ['daily', 'weekly', 'monthly'] as const
type Frequency = (typeof FREQUENCIES)[number]

/** Entier borné, ou `null`. Les bornes sont RÉPÉTÉES en base (règle 20). */
function asBoundedInt(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v)) return null
  return v >= min && v <= max ? v : null
}

function asBoundedIntArray(v: unknown, min: number, max: number, maxLen: number): number[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > maxLen) return null
  const out: number[] = []
  for (const x of v) {
    const n = asBoundedInt(x, min, max)
    if (n === null) return null
    out.push(n)
  }
  return [...new Set(out)]
}

type Ctx = { params: Promise<{ name: string }> }
type OverviewRow = { job_name: string; schedule: string | null; criticality: 'legal' | 'technical'; legal_basis_key: string | null }

export async function POST(request: NextRequest, ctx: Ctx): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const reauthFail = requireReauth(request, auth.user.id)
  if (reauthFail) return reauthFail

  const { name } = await ctx.params
  const jobName = decodeURIComponent(name ?? '')
  if (!JOB_NAME_REGEX.test(jobName)) {
    return json({ error: 'Invalid job name', code: 'invalid_name' }, 400)
  }

  let body: {
    frequency?: unknown
    minutes?: unknown
    hour?: unknown
    days_of_week?: unknown
    day_of_month?: unknown
    confirm_name?: unknown
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const frequency = typeof body.frequency === 'string' && (FREQUENCIES as readonly string[]).includes(body.frequency)
    ? (body.frequency as Frequency)
    : null
  if (!frequency) return json({ error: 'Invalid frequency', code: 'invalid_frequency' }, 400)

  const minutes = asBoundedIntArray(body.minutes, 0, 59, 6)
  if (!minutes) return json({ error: 'Invalid minutes', code: 'invalid_minutes' }, 400)

  const hour = asBoundedInt(body.hour, 0, 23)
  if (hour === null) return json({ error: 'Invalid hour', code: 'invalid_hour' }, 400)

  let daysOfWeek: number[] | null = null
  let dayOfMonth: number | null = null
  if (frequency === 'weekly') {
    daysOfWeek = asBoundedIntArray(body.days_of_week, 0, 6, 7)
    if (!daysOfWeek) return json({ error: 'Invalid days of week', code: 'invalid_days_of_week' }, 400)
  }
  if (frequency === 'monthly') {
    // 28 MAXIMUM — jamais 29, 30 ni 31. C'est la borne qui rend « 30 février »
    // irreprésentable ; la base la repose de son côté (défense en profondeur).
    dayOfMonth = asBoundedInt(body.day_of_month, 1, 28)
    if (dayOfMonth === null) return json({ error: 'Invalid day of month', code: 'invalid_day_of_month' }, 400)
  }

  const { data: overview, error: overviewErr } = await auth.supabaseAdmin.rpc('admin_cron_jobs_overview')
  if (overviewErr) {
    if (isMissingFunction(overviewErr)) {
      return json({ error: 'Not deployed', code: 'migration_pending', migration: '20260901000003_cron_supervision_read.sql' }, 503)
    }
    console.error('[admin:cron-schedule] overview failed', overviewErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const job = ((overview ?? []) as OverviewRow[]).find((j) => j.job_name === jobName) ?? null
  if (!job) return json({ error: 'Job not found', code: 'not_found' }, 404)

  const typed = typeof body.confirm_name === 'string' ? body.confirm_name.trim() : ''
  if (typed !== jobName) {
    return json({ error: 'Confirmation name does not match', code: 'confirm_name_mismatch' }, 400)
  }

  const { data: result, error: setErr } = await auth.supabaseAdmin.rpc('admin_cron_set_schedule', {
    p_job_name: jobName,
    p_frequency: frequency,
    p_minutes: minutes,
    p_hour: hour,
    p_days_of_week: daysOfWeek,
    p_day_of_month: dayOfMonth,
  })

  if (setErr) {
    if (isMissingFunction(setErr)) {
      return json({ error: 'Not deployed', code: 'migration_pending', migration: '20260902000002_cron_schedule_edit.sql' }, 503)
    }
    const msg = setErr.message ?? ''
    if (msg.includes('cron_job_not_found')) {
      return json({ error: 'Job not found', code: 'not_found' }, 404)
    }
    if (msg.includes('cron_chain_violation')) {
      // Le refus NOMME la contrainte et PROPOSE. Sans la suggestion, il faudrait
      // deviner l'horaire acceptable — un refus qu'on ne sait pas satisfaire est
      // un refus qu'on finit par contourner en base.
      const parts = msg.split('cron_chain_violation: ')[1]?.trim().split(/\s+/) ?? []
      const [direction, otherJob, gap] = parts
      const { data: suggestion } = await auth.supabaseAdmin.rpc('admin_cron_suggest_schedule', {
        p_job_name: jobName,
        p_schedule: buildLocalPreview(frequency, minutes, hour, daysOfWeek, dayOfMonth),
      })
      return json(
        {
          error: 'Schedule breaks the task chain',
          code: 'chain_violation',
          direction: direction ?? null,
          other_job_name: otherJob ?? null,
          min_gap_minutes: gap ? Number(gap) : null,
          suggested_schedule: typeof suggestion === 'string' ? suggestion : null,
        },
        409,
      )
    }
    if (msg.includes('cron_build_schedule')) {
      return json({ error: 'Invalid schedule components', code: 'invalid_schedule' }, 400)
    }
    console.error('[admin:cron-schedule] set_schedule failed', msg)
    return json({ error: 'Could not reschedule', code: 'schedule_failed' }, 500)
  }

  const row = ((result ?? []) as Array<{ previous_schedule: string; new_schedule: string }>)[0] ?? null
  if (!row) {
    console.error('[admin:cron-schedule] aucune ligne retournée', { jobName })
    return json({ error: 'Could not reschedule', code: 'schedule_failed' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.user.domain_id,
    action: 'cron_job_rescheduled',
    entity_type: 'cron_job',
    entity_id: cronJobAuditId(jobName),
    detail: {
      job_name: jobName,
      criticality: job.criticality,
      from_schedule: row.previous_schedule,
      to_schedule: row.new_schedule,
    },
    request,
  })

  return json({ ok: true, schedule: row.new_schedule }, 200)
}

/**
 * Reconstruit l'expression VISÉE, uniquement pour demander une suggestion à la
 * base après un refus. Elle n'est jamais écrite : `admin_cron_set_schedule`
 * refuse toute expression venue de l'extérieur et rebâtit la sienne.
 */
function buildLocalPreview(
  frequency: Frequency,
  minutes: number[],
  hour: number,
  daysOfWeek: number[] | null,
  dayOfMonth: number | null,
): string {
  const m = [...minutes].sort((a, b) => a - b).join(',')
  if (frequency === 'weekly') {
    return `${m} ${hour} * * ${[...(daysOfWeek ?? [])].sort((a, b) => a - b).join(',')}`
  }
  if (frequency === 'monthly') return `${m} ${hour} ${dayOfMonth} * *`
  return `${m} ${hour} * * *`
}
