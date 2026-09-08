import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { loadCvParsingQuota, QuotaConfigMissing } from '@/lib/ai-quotas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET / PATCH /api/admin/ai-quotas — LE QUOTA D'ANALYSES DE CV.
 *
 * ┌─ POURQUOI CETTE ROUTE EXISTE ───────────────────────────────────────────┐
 * │ Ranger un réglage en base sans donner le moyen de le régler, ce serait   │
 * │ déplacer le défaut au lieu de le corriger : la valeur ne serait plus     │
 * │ dans le code, mais elle resterait hors de portée. Un plafond qu'il faut  │
 * │ un développeur pour relever n'est pas un plafond.                        │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Les BORNES sont celles de la base (contraintes CHECK de la migration), pas
 * d'autres inventées ici : deux jeux de bornes finissent toujours par diverger,
 * et c'est la base qui a le dernier mot.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Mêmes bornes que les contraintes CHECK — voir ..._quota_analyses_cv.sql. */
const MAX_MIN = 1
const MAX_MAX = 1000
const FENETRE_MIN = 1
const FENETRE_MAX = 720

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  try {
    const quota = await loadCvParsingQuota(auth.supabaseAdmin)
    return json(
      {
        cv_parsing: {
          max_per_window: quota.maxPerWindow,
          window_hours: quota.windowHours,
        },
        bounds: {
          max_per_window: { min: MAX_MIN, max: MAX_MAX },
          window_hours: { min: FENETRE_MIN, max: FENETRE_MAX },
        },
      },
      200,
    )
  } catch (err) {
    if (err instanceof QuotaConfigMissing) {
      console.error('[admin:ai-quotas]', err.message)
      return json({ error: 'Quota not configured', code: err.code }, 503)
    }
    throw err
  }
}

export async function PATCH(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  let body: { max_per_window?: unknown; window_hours?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const max = Number(body.max_per_window)
  const fenetre = Number(body.window_hours)
  if (!Number.isInteger(max) || max < MAX_MIN || max > MAX_MAX) {
    return json({ error: 'Invalid max_per_window', code: 'invalid_max' }, 400)
  }
  if (!Number.isInteger(fenetre) || fenetre < FENETRE_MIN || fenetre > FENETRE_MAX) {
    return json({ error: 'Invalid window_hours', code: 'invalid_window' }, 400)
  }

  // L'ANCIENNE valeur est lue AVANT l'écriture : sans elle, la trace d'audit
  // dirait ce que le quota est devenu sans dire d'où il vient — donc sans
  // permettre de rattacher un pic d'appels au réglage qui l'a permis.
  let avant: { maxPerWindow: number; windowHours: number } | null = null
  try {
    avant = await loadCvParsingQuota(auth.supabaseAdmin)
  } catch {
    avant = null
  }

  const { error } = await auth.supabaseAdmin
    .from('ai_quotas')
    .update({
      max_per_window: max,
      window_hours: fenetre,
      updated_at: new Date().toISOString(),
      updated_by: auth.user.id,
    })
    .eq('quota', 'cv_parsing')
  if (error) {
    console.error('[admin:ai-quotas] update failed', error.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'ai_quota_updated',
    entity_type: 'ai_quota',
    entity_id: null,
    detail: {
      quota: 'cv_parsing',
      avant: avant ? { max_per_window: avant.maxPerWindow, window_hours: avant.windowHours } : null,
      apres: { max_per_window: max, window_hours: fenetre },
    },
  })

  return json({ ok: true, cv_parsing: { max_per_window: max, window_hours: fenetre } }, 200)
}
