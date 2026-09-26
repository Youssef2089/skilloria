import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { identifiantDerive } from '@/lib/admin/identifiant-derive'
import { loadCvParsingQuota, QuotaConfigMissing } from '@/lib/ai-quotas'
import { contexteDepuisAuth } from '@/lib/journal/contexte'
import type { SousDetail } from '@/lib/journal/detail'

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
 *
 * ET L'ÉCRITURE PASSE PAR LE GRAND LIVRE (§D.26) : le quota et la ligne du
 * grand livre sont écrits par UNE fonction, `regler_quota_ia()`, dans la même
 * transaction. La pièce naît à l'entrée du geste, avant toute écriture.
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
  // LE CONTEXTE DE JOURNAL, À L'ENTRÉE DU GESTE — avant toute écriture (§D.26).
  const journal = contexteDepuisAuth(auth)

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

  // L'ANCIENNE valeur est lue AVANT l'écriture : sans elle, la trace dirait ce
  // que le quota est devenu sans dire d'où il vient — donc sans permettre de
  // rattacher un pic d'appels au réglage qui l'a permis. Illisible, on REFUSE
  // (comme le GET) : une ligne de grand livre sans « avant » serait une trace
  // qui a l'air complète (§E.24).
  let lu: { maxPerWindow: number; windowHours: number }
  try {
    lu = await loadCvParsingQuota(auth.supabaseAdmin)
  } catch (err) {
    if (err instanceof QuotaConfigMissing) {
      console.error('[admin:ai-quotas]', err.message)
      return json({ error: 'Quota not configured', code: err.code }, 503)
    }
    throw err
  }
  const avant = { max_per_window: lu.maxPerWindow, window_hours: lu.windowHours } satisfies SousDetail<'reglage_modifie', 'avant'>
  const apres = { max_per_window: max, window_hours: fenetre } satisfies SousDetail<'reglage_modifie', 'apres'>
  const sujetId = identifiantDerive('reglage', 'ai_quotas:cv_parsing')

  // ── L'ÉCRITURE ET SA LIGNE DE JOURNAL, EN UN SEUL APPEL (§D.26) ──────────
  //  `regler_quota_ia` met à jour le quota ET écrit la ligne du grand livre
  //  dans la même transaction, par l'écrivain unique `journaliser_reglage()`.
  const { error } = await auth.supabaseAdmin.rpc('regler_quota_ia', {
    p_piece: journal.piece,
    p_acteur_id: auth.user.id,
    p_ecosysteme_id: auth.domain.id,
    p_sujet_id: sujetId,
    p_quota: 'cv_parsing',
    p_max: max,
    p_fenetre: fenetre,
    p_avant: avant,
  })
  if (error) {
    console.error('[admin:ai-quotas] écriture en échec', error.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'ai_quota_updated',
    entity_type: 'ai_quota',
    entity_id: sujetId,
    detail: { quota: 'cv_parsing', avant, apres },
  })

  return json({ ok: true, cv_parsing: { max_per_window: max, window_hours: fenetre } }, 200)
}
