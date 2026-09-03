import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/assign-org-package
 * Body : { organization_id: uuid, package_id: uuid, package_valid_until?: string|null }
 *
 * Attribution manuelle d'un package (pilote grands comptes) sur la ligne
 * organization_domains ACTIVE de l'org.
 *
 * RÈGLES FERMES (Lot 3) — aucune décision silencieuse, aucune création implicite :
 *  - la cible est organization_domains WHERE organization_id = X AND active = true ;
 *  - 0 ligne active   → 404 'no_active_domain' ;
 *  - >1 ligne active  → 409 'multiple_active_domains' ;
 *  - package inexistant ou inactif → 400 'invalid_package'.
 *
 * Écrit package_id, package_started_at=now(), package_valid_until (ou null).
 * Audit logAudit action 'org_package_assigned'. Garde admin per-route. service_role.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

type Body = {
  organization_id?: unknown
  package_id?: unknown
  package_valid_until?: unknown
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const organizationId = typeof body.organization_id === 'string' ? body.organization_id.trim() : ''
  const packageId = typeof body.package_id === 'string' ? body.package_id.trim() : ''
  if (!organizationId || !UUID_REGEX.test(organizationId)) {
    return json({ error: 'Invalid organization_id', code: 'invalid_id' }, 400)
  }
  if (!packageId || !UUID_REGEX.test(packageId)) {
    return json({ error: 'Invalid package_id', code: 'invalid_id' }, 400)
  }

  // package_valid_until : optionnel. null/absent → sans échéance. Sinon datetime valide.
  let validUntilIso: string | null = null
  if (body.package_valid_until != null) {
    if (typeof body.package_valid_until !== 'string') {
      return json({ error: 'Invalid package_valid_until', code: 'invalid_valid_until' }, 400)
    }
    const t = body.package_valid_until.trim()
    if (t !== '') {
      const d = new Date(t)
      if (Number.isNaN(d.getTime())) {
        return json({ error: 'Invalid package_valid_until', code: 'invalid_valid_until' }, 400)
      }
      validUntilIso = d.toISOString()
    }
  }

  // ── Package cible : doit exister ET être actif ──────────────────────────────
  const { data: pkg, error: pkgErr } = await auth.supabaseAdmin
    .from('packages')
    .select('id, slug, name, active')
    .eq('id', packageId)
    .maybeSingle()
  if (pkgErr) {
    console.error('[admin:assign-org-package] package lookup failed', pkgErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!pkg || !(pkg.active as boolean)) {
    return json({ error: 'Package not found or inactive', code: 'invalid_package' }, 400)
  }

  // ── Attribution ─────────────────────────────────────────────────────────────
  //  L'ABONNEMENT VIT SUR L'ORGANISATION, plus sur le couple (org, écosystème).
  //  Une organisation accède à TOUS les écosystèmes actifs : le porter sur la
  //  ligne de rattachement produisait un défaut d'argent SILENCIEUX — partout
  //  ailleurs que sur l'écosystème d'inscription, aucune ligne, donc repli sur
  //  l'offre gratuite alors que l'organisation paie.
  //  Cf. supabase/migrations/20260903000000_abonnement_sur_organisation.sql.
  //
  //  DEUX REFUS DISPARAISSENT AVEC LUI : `no_active_domain` (404) et
  //  `multiple_active_domains` (409). Ils gardaient une ligne de rattachement
  //  dont l'abonnement ne dépend plus ; les conserver aurait refusé
  //  l'attribution à une organisation parfaitement en règle.
  //  `updated_at` est posé par le trigger `trg_organizations_updated_at`.
  const nowIso = new Date().toISOString()
  const { error: updErr } = await auth.supabaseAdmin
    .from('organizations')
    .update({
      package_id: packageId,
      package_started_at: nowIso,
      package_valid_until: validUntilIso,
    })
    .eq('id', organizationId)
  if (updErr) {
    console.error('[admin:assign-org-package] update failed', updErr.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'org_package_assigned',
    entity_type: 'organization',
    entity_id: organizationId,
    detail: {
      package_id: packageId,
      package_slug: pkg.slug as string,
      package_started_at: nowIso,
      package_valid_until: validUntilIso,
    },
  })

  return json(
    {
      ok: true,
      organization_id: organizationId,
      package_id: packageId,
      package_started_at: nowIso,
      package_valid_until: validUntilIso,
    },
    200,
  )
}
