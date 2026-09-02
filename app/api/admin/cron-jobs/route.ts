import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/cron-jobs — vue de supervision des tâches planifiées.
 *
 * LECTURE SEULE (lot 0). Activer/désactiver, reprogrammer et déclencher
 * viendront dans des lots ultérieurs, avec leurs propres gardes.
 *
 * ═══ LA LISTE VIENT DE LA BASE, JAMAIS DU CODE ═════════════════════════════
 *   Cette route ne connaît AUCUN nom de tâche. Elle appelle
 *   `admin_cron_jobs_overview()`, dont le FROM est `cron.job`. C'est ce qui
 *   permet à l'écran d'afficher une tâche que personne n'a déclarée — le cas
 *   `rate_limit_hits_purge`, invisible pendant des mois précisément parce que
 *   les deux endroits qui la cherchaient (une liste SQL en dur, un script de
 *   diagnostic) ne la connaissaient pas.
 *
 *   Corollaire : le chantier matching ajoutera ses propres tâches et elles
 *   apparaîtront ici SANS MODIFICATION de cette route.
 *
 * ═══ POURQUOI UNE RPC ET PAS UN SELECT ═════════════════════════════════════
 *   Le schéma `cron` n'est pas exposé par PostgREST et n'a aucun grant pour
 *   `service_role`. La fonction `SECURITY DEFINER` est le SEUL point
 *   d'exposition, et il est en lecture. Ne jamais granter le schéma `cron` à
 *   la clé applicative.
 *
 * ═══ MIGRATION NON ENCORE POUSSÉE ══════════════════════════════════════════
 *   Les migrations sont poussées à la main. Tant qu'elles ne le sont pas, la
 *   RPC n'existe pas. On renvoie alors un code DÉDIÉ (`migration_pending`)
 *   plutôt qu'un 500 générique : l'écran affiche quoi faire, au lieu d'un
 *   « une erreur est survenue » qui laisserait croire à une panne.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * `true` si l'erreur signifie « la fonction n'existe pas encore ».
 *   - PGRST202 : PostgREST ne trouve pas la fonction dans son cache de schéma.
 *   - 42883    : `undefined_function` côté Postgres.
 * On teste AUSSI le message : selon la version, l'un ou l'autre remonte.
 */
function isMissingFunction(error: { code?: string | null; message?: string | null }): boolean {
  const code = error.code ?? ''
  if (code === 'PGRST202' || code === '42883') return true
  const msg = (error.message ?? '').toLowerCase()
  return msg.includes('could not find the function') || msg.includes('does not exist')
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { data, error } = await auth.supabaseAdmin.rpc('admin_cron_jobs_overview')

  if (error) {
    if (isMissingFunction(error)) {
      console.warn('[admin:cron-jobs] fonction absente — migration non poussée ?', error.message)
      return json(
        {
          error: 'Supervision functions not deployed',
          code: 'migration_pending',
          migration: '20260901000003_cron_supervision_read.sql',
        },
        503,
      )
    }
    console.error('[admin:cron-jobs] overview failed', error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  const jobs = (data ?? []) as unknown[]

  /**
   * TOTAL EXACT, AUCUNE TRONCATURE. La fonction renvoie la totalité de
   * `cron.job` — il y a cinq tâches, et le chantier matching en ajoutera
   * quelques-unes. Aucun `LIMIT` n'est posé : sur un écran de supervision,
   * une liste tronquée en silence est précisément le défaut qu'on corrige
   * (leçon MAX_ORGS). Le jour où le volume l'exigera, la pagination
   * s'ajoutera AVEC son compteur exact, pas un écrêtage muet.
   */
  return json({ jobs, total: jobs.length }, 200)
}
