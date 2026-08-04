import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/list-domains (D7 — support)
 *
 * Liste des écosystèmes (domains) pour alimenter le sélecteur d'écosystème lors
 * de la CRÉATION d'une branche. L'admin est plateforme (D1) : tous les domaines
 * sont retournés, actifs d'abord. service_role. AUCUN filtre domaine.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { data: domains, error } = await auth.supabaseAdmin
    .from('domains')
    .select('id, name, slug, active')
    .order('active', { ascending: false })
    .order('name', { ascending: true })
  if (error) {
    console.error('[admin:list-domains] query failed', error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  return json({ domains: domains ?? [] }, 200)
}
