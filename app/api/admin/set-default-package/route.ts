import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { applyDefaultTransfer } from '@/lib/package-default'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/set-default-package
 * Body : { package_id: uuid }
 *
 * TRANSFERT du statut « offre par défaut » (jamais une décoche).
 *
 * INVARIANT DE COUVERTURE (implémenté dans lib/package-default.ts, partagé avec
 * create-package) : chaque cible (client, cabinet) doit être couverte à tout
 * moment par exactement UNE offre par défaut ACTIVE — via sa ligne spécifique
 * OU via une ligne 'all'.
 *  - Désigner une offre 'all'      → retire le défaut de TOUTES les lignes.
 *  - Désigner une offre spécifique → retire la couverture de SA cible ; REFUS
 *    'target_uncovered' si cela laissait l'autre cible sans défaut (cas typique :
 *    l'unique défaut courant est une 'all').
 *
 * Refus (400, code explicite) :
 *  - X inactif            → 'package_inactive' (un défaut doit être actif)
 *  - X est déjà le défaut → 'already_default'  (no-op poli)
 *  - couverture rompue    → 'target_uncovered' (+ cibles orphelines)
 *
 * NB : c'est ce champ is_default que lit lib/entitlements.ts pour rattacher les
 * NOUVELLES inscriptions. Les organisations déjà rattachées ne bougent pas.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

type PackageRow = {
  id: string
  name: string
  slug: string
  target_role: string
  is_default: boolean
  active: boolean
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  let body: { package_id?: unknown }
  try {
    body = (await request.json()) as { package_id?: unknown }
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const packageId = typeof body.package_id === 'string' ? body.package_id.trim() : ''
  if (!packageId || !UUID_REGEX.test(packageId)) {
    return json({ error: 'Invalid package_id', code: 'invalid_id' }, 400)
  }

  const { data: target, error: tgtErr } = await auth.supabaseAdmin
    .from('packages')
    .select('*')
    .eq('id', packageId)
    .maybeSingle()
  if (tgtErr) {
    console.error('[admin:set-default-package] package lookup failed', tgtErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!target) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }
  const pkg = target as PackageRow

  if (pkg.is_default) {
    return json({ error: 'Already the default package', code: 'already_default' }, 400)
  }
  if (!pkg.active) {
    // Un défaut DOIT être actif : sinon les nouvelles inscriptions seraient
    // rattachées à une offre retirée de la vente.
    return json({ error: 'Package is inactive', code: 'package_inactive' }, 400)
  }

  const result = await applyDefaultTransfer(auth.supabaseAdmin, {
    packageId,
    targetRole: pkg.target_role,
    userId: auth.user.id,
    changeReason: `default transfer (${pkg.target_role}) → ${pkg.slug}`,
  })

  if (!result.ok) {
    return json(
      {
        error: 'Default transfer refused',
        code: result.code,
        ...(result.uncovered ? { uncovered: result.uncovered } : {}),
      },
      result.status,
    )
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'package_default_changed',
    entity_type: 'package',
    entity_id: packageId,
    detail: {
      target_role: pkg.target_role,
      new_default: { id: pkg.id, slug: pkg.slug, name: pkg.name },
      unset_ids: result.unsetIds,
    },
  })

  return json({ ok: true, package_id: packageId, target_role: pkg.target_role, unset: result.unsetIds }, 200)
}
