import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { usageDeLaBranche, brancheReferencee } from '@/lib/admin/usage-branche'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/delete-branch (D7)
 * Body : { id: uuid }
 *
 * Suppression DÉFENSIVE (défense en profondeur, miroir du garde-fou UI) :
 *   - si des profils OU des publications référencent la branche, OU si elle
 *     porte encore des spécialités → 409 { code:'in_use', profiles, publications,
 *     specialities }. On ne supprime jamais une branche référencée.
 *   - sinon : suppression de la branche + de ses lignes public.translations.
 * logAudit('branch_deleted'). service_role. AUCUN filtre domaine.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id || !UUID_REGEX.test(id)) {
    return json({ error: 'Invalid id', code: 'invalid_id' }, 400)
  }

  const { data: branch, error: brErr } = await auth.supabaseAdmin
    .from('branches')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (brErr) {
    console.error('[admin:delete-branch] branch lookup failed', brErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!branch) return json({ error: 'Not found', code: 'not_found' }, 404)

  // ── CE QUE LA BRANCHE PORTE — LA MÊME LECTURE QUE L’ÉCRAN ──────────────
  //  Les trois comptes vivaient ici ET dans `get-branch`, et aucune des six
  //  lectures ne récupérait son erreur : une seule panne rendait l’écran ET
  //  cette barrière aveugles du même zéro. Lecture unique, type unique.
  const usage = await usageDeLaBranche(auth.supabaseAdmin, id)
  const referencee = brancheReferencee(usage)

  // ⚠️ NE PAS SAVOIR NE VAUT JAMAIS LAISSER PASSER. La suppression emporte
  //    les spécialités EN CASCADE et détache les annonces EN SILENCE : on ne
  //    la prend pas sur un comptage indisponible. 503, motif nommé, refus
  //    TEMPORAIRE — ce n’est pas un verdict sur la branche.
  if (referencee === null) {
    return json(
      {
        error: 'Could not determine what this branch still carries',
        code: 'usage_indisponible',
      },
      503,
    )
  }

  if (referencee) {
    return json(
      {
        error: 'Branch is in use',
        code: 'in_use',
        profiles: usage.etat === 'disponible' ? usage.profils : 0,
        publications: usage.etat === 'disponible' ? usage.publications : 0,
        specialities: usage.etat === 'disponible' ? usage.specialites : 0,
      },
      409,
    )
  }

  // Traductions d'abord (pas de FK, nettoyage explicite), puis la branche.
  await auth.supabaseAdmin
    .from('translations')
    .delete()
    .eq('table_name', 'branches')
    .eq('row_id', id)

  const { error: delErr } = await auth.supabaseAdmin.from('branches').delete().eq('id', id)
  if (delErr) {
    console.error('[admin:delete-branch] delete failed', delErr.message)
    return json({ error: 'Delete failed', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'branch_deleted',
    entity_type: 'branch',
    entity_id: id,
    detail: {},
  })

  return json({ ok: true }, 200)
}
