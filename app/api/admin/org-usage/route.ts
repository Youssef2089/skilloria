import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { getOrgEntitlements, monthlyPeriodStart } from '@/lib/entitlements'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/org-usage?organization_id=uuid
 *
 * Lecture seule : package effectif d'une org + conso du mois courant
 * (usage_peek publications / manual_unlocks) pour la section « Package » de la
 * fiche org admin.
 *
 * Domaine ciblé = organization_domains ACTIVE unique (même règle que
 * assign-org-package) : 0 → available:false 'no_active_domain' ; >1 →
 * available:false 'multiple_active_domains'. Garde admin per-route. service_role.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

async function peek(
  admin: Awaited<ReturnType<typeof requireAdmin>>['supabaseAdmin'],
  orgId: string,
  key: string,
  period: string,
): Promise<number> {
  const { data, error } = await admin.rpc('usage_peek', {
    p_org: orgId,
    p_key: key,
    p_period: period,
  })
  if (error) {
    console.warn('[admin:org-usage] usage_peek error', key, error.message)
    return 0
  }
  return typeof data === 'number' ? data : 0
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const url = new URL(request.url)
  const organizationId = (url.searchParams.get('organization_id') ?? '').trim()
  if (!organizationId || !UUID_REGEX.test(organizationId)) {
    return json({ error: 'Invalid organization_id', code: 'invalid_id' }, 400)
  }

  // ── Domaine actif unique ────────────────────────────────────────────────────
  const { data: domains, error: domErr } = await auth.supabaseAdmin
    .from('organization_domains')
    .select('id, domain_id, package_id, package_started_at, package_valid_until')
    .eq('organization_id', organizationId)
    .eq('active', true)
  if (domErr) {
    console.error('[admin:org-usage] org_domains lookup failed', domErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const activeRows = (domains ?? []) as {
    id: string
    domain_id: string
    package_id: string | null
    package_started_at: string | null
    package_valid_until: string | null
  }[]
  if (activeRows.length === 0) {
    return json({ available: false, reason: 'no_active_domain' }, 200)
  }
  if (activeRows.length > 1) {
    return json({ available: false, reason: 'multiple_active_domains' }, 200)
  }
  const target = activeRows[0]

  // ── Package effectif (fail-open) + compteurs du mois ────────────────────────
  const ents = await getOrgEntitlements(auth.supabaseAdmin, organizationId, target.domain_id)
  const period = monthlyPeriodStart().toISOString().slice(0, 10)

  const [publicationsUsed, manualUnlocksUsed] = await Promise.all([
    peek(auth.supabaseAdmin, organizationId, 'publications', period),
    peek(auth.supabaseAdmin, organizationId, 'manual_unlocks', period),
  ])

  return json(
    {
      available: true,
      domain_id: target.domain_id,
      assignment: {
        package_id: target.package_id,
        package_started_at: target.package_started_at,
        package_valid_until: target.package_valid_until,
      },
      package_slug: ents.packageSlug,
      limits: {
        publicationsPerMonth: ents.limits.publicationsPerMonth,
        activePublicationsMax: ents.limits.activePublicationsMax,
        revealedCandidatesPerPublication: ents.limits.revealedCandidatesPerPublication,
        manualUnlocksPerMonth: ents.limits.manualUnlocksPerMonth,
      },
      usage: {
        publications: publicationsUsed,
        manual_unlocks: manualUnlocksUsed,
      },
      period_start: period,
    },
    200,
  )
}
