import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { requireReauth } from '@/lib/reauth-token'
import { logAudit } from '@/lib/audit'
import { cronJobAuditId } from '@/lib/admin/cron-audit-id'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/cron-jobs/[name]/toggle — ACTIVER ou DÉSACTIVER une tâche.
 *
 * Body   : { active: boolean, confirm_name: string }
 * Header : `x-reauth-token` obligatoire.
 *
 * ═══ DEUX BARRIÈRES, DE DEUX NATURES ═══════════════════════════════════════
 *   1. IDENTITÉ — `requireReauth` : le mécanisme EXISTANT (grant HMAC 5 min),
 *      le même que la suspension de compte et la suppression définitive.
 *   2. ATTENTION — `confirm_name` : l'administrateur retape le NOM de la tâche,
 *      et le SERVEUR le compare. C'est la seule des deux qui adresse l'erreur
 *      de CIBLE — se tromper de ligne dans une liste de cinq. Un appel forgé
 *      qui omet le champ est refusé ici, pas à l'écran.
 *
 *   ═══ POURQUOI DANS LES DEUX SENS, PAS SEULEMENT À LA DÉSACTIVATION ═══
 *   On pourrait croire que réactiver est anodin. Ce serait faux : une purge
 *   légale peut avoir été suspendue DÉLIBÉRÉMENT — le temps d'un audit, d'une
 *   investigation, d'un litige. La réactiver par erreur anonymiserait des
 *   comptes que quelqu'un avait justement mis à l'abri. Les deux sens ont donc
 *   la même barrière.
 *
 * ═══ AUCUN REFUS SUR LES TÂCHES LÉGALES ════════════════════════════════════
 *   Décision produit : une obligation qu'on ne peut pas suspendre est une
 *   obligation qu'on contournera en base, hors de toute trace. On rend donc
 *   l'action possible, impossible à faire par mégarde, et impossible à oublier
 *   (bandeau rouge permanent sur tout le back-office).
 *
 * ═══ TRAÇABILITÉ ═══════════════════════════════════════════════════════════
 *   `cron_job_disabled` / `cron_job_enabled`, avec IP et user-agent.
 *   `entity_id` est un UUID DÉRIVÉ du nom (cf. lib/admin/cron-audit-id.ts) :
 *   la colonne est `uuid NOT NULL` et une tâche pg_cron n'a pas d'UUID. Sans
 *   cette dérivation, `logAudit` — best-effort — aurait échoué EN SILENCE.
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
  legal_basis_key: string | null
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

  // Barrière 1 — AVANT toute lecture : on ne renseigne pas un appelant qui n'a
  // pas re-prouvé son identité.
  const reauthFail = requireReauth(request, auth.user.id)
  if (reauthFail) return reauthFail

  const { name } = await ctx.params
  const jobName = decodeURIComponent(name ?? '')
  if (!JOB_NAME_REGEX.test(jobName)) {
    return json({ error: 'Invalid job name', code: 'invalid_name' }, 400)
  }

  let body: { active?: unknown; confirm_name?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }
  if (typeof body.active !== 'boolean') {
    return json({ error: 'active is required', code: 'invalid_body' }, 400)
  }
  const nextActive = body.active

  // La tâche doit exister DANS cron.job — c'est la source, pas le catalogue.
  const { data: overview, error: overviewErr } = await auth.supabaseAdmin.rpc('admin_cron_jobs_overview')
  if (overviewErr) {
    if (isMissingFunction(overviewErr)) {
      return json({ error: 'Not deployed', code: 'migration_pending', migration: '20260901000003_cron_supervision_read.sql' }, 503)
    }
    console.error('[admin:cron-toggle] overview failed', overviewErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const job = ((overview ?? []) as OverviewRow[]).find((j) => j.job_name === jobName) ?? null
  if (!job) {
    return json({ error: 'Job not found', code: 'not_found' }, 404)
  }

  // Barrière 2 — le nom retapé. Comparaison EXACTE : un nom de tâche est un
  // identifiant, pas une saisie libre à normaliser.
  const typed = typeof body.confirm_name === 'string' ? body.confirm_name.trim() : ''
  if (typed !== jobName) {
    return json(
      { error: 'Confirmation name does not match', code: 'confirm_name_mismatch' },
      400,
    )
  }

  // Idempotence : on le DIT plutôt que d'écrire une seconde ligne d'audit pour
  // un changement qui n'a pas eu lieu.
  if (job.active === nextActive) {
    return json({ error: 'Already in that state', code: 'nothing_to_update' }, 400)
  }

  const { data: result, error: setErr } = await auth.supabaseAdmin.rpc('admin_cron_set_active', {
    p_job_name: jobName,
    p_active: nextActive,
  })
  if (setErr) {
    if (isMissingFunction(setErr)) {
      return json({ error: 'Not deployed', code: 'migration_pending', migration: '20260902000001_cron_supervision_actions.sql' }, 503)
    }
    if ((setErr.message ?? '').includes('cron_job_not_found')) {
      return json({ error: 'Job not found', code: 'not_found' }, 404)
    }
    console.error('[admin:cron-toggle] set_active failed', setErr.message)
    return json({ error: 'Could not change state', code: 'toggle_failed' }, 500)
  }

  // La fonction RELIT l'état après écriture. S'il ne correspond pas à ce qu'on
  // a demandé, l'action n'a pas pris — on refuse de répondre « ok ».
  const row = ((result ?? []) as Array<{ previous_active: boolean; new_active: boolean }>)[0] ?? null
  if (!row || row.new_active !== nextActive) {
    console.error('[admin:cron-toggle] état non appliqué', { jobName, nextActive, row })
    return json({ error: 'State did not change', code: 'toggle_failed' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.user.domain_id,
    action: nextActive ? 'cron_job_enabled' : 'cron_job_disabled',
    entity_type: 'cron_job',
    // UUID dérivé : la colonne est uuid NOT NULL (cf. cron-audit-id.ts).
    entity_id: cronJobAuditId(jobName),
    detail: {
      // Le nom LISIBLE vit ici — c'est lui qu'on relit, jamais l'empreinte.
      job_name: jobName,
      criticality: job.criticality,
      legal_basis_key: job.legal_basis_key,
      catalogued: job.catalogued,
      previous_active: row.previous_active,
      new_active: row.new_active,
    },
    request,
  })

  return json({ ok: true, active: row.new_active }, 200)
}
