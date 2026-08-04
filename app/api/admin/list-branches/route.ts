import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/list-branches (D7 — administration de la taxonomie)
 *
 * Toutes les branches, TOUS écosystèmes confondus (actives ET inactives), avec :
 *   - le nom de l'écosystème (domains.name) — l'admin est plateforme (D1),
 *   - le nombre de spécialités rattachées,
 *   - l'usage : nb de profils (profiles.branch_id) + nb de publications
 *     (publications.branch_id) qui référencent la branche.
 * Garde admin per-route via requireAdmin. service_role. AUCUN filtre domaine.
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

  // ── Branches (toutes, tous domaines) ────────────────────────────────────────
  const { data: branches, error: brErr } = await auth.supabaseAdmin
    .from('branches')
    .select('id, domain_id, name, slug, active, sort_order')
    .order('domain_id', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (brErr) {
    console.error('[admin:list-branches] branches query failed', brErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const brRows = (branches ?? []) as {
    id: string
    domain_id: string
    name: string
    slug: string
    active: boolean
    sort_order: number
  }[]
  const branchIds = brRows.map((b) => b.id)

  // ── Écosystèmes : domain_id → name ──────────────────────────────────────────
  const domainName = new Map<string, string>()
  const domainIds = [...new Set(brRows.map((b) => b.domain_id))]
  if (domainIds.length > 0) {
    const { data: doms, error: domErr } = await auth.supabaseAdmin
      .from('domains')
      .select('id, name')
      .in('id', domainIds)
    if (domErr) {
      console.error('[admin:list-branches] domains query failed', domErr.message)
      return json({ error: 'Query failed', code: 'db_error' }, 500)
    }
    for (const d of (doms ?? []) as { id: string; name: string }[]) {
      domainName.set(d.id, d.name)
    }
  }

  // ── Nb de spécialités par branche ───────────────────────────────────────────
  const specCount = new Map<string, number>()
  if (branchIds.length > 0) {
    const { data: specs, error: spErr } = await auth.supabaseAdmin
      .from('specialities')
      .select('branch_id')
      .in('branch_id', branchIds)
    if (spErr) {
      console.error('[admin:list-branches] specialities count failed', spErr.message)
      return json({ error: 'Query failed', code: 'db_error' }, 500)
    }
    for (const s of (specs ?? []) as { branch_id: string }[]) {
      specCount.set(s.branch_id, (specCount.get(s.branch_id) ?? 0) + 1)
    }
  }

  // ── Usage : profils + publications référençant la branche ───────────────────
  const profileCount = new Map<string, number>()
  const publicationCount = new Map<string, number>()
  if (branchIds.length > 0) {
    const { data: profs, error: pfErr } = await auth.supabaseAdmin
      .from('profiles')
      .select('branch_id')
      .in('branch_id', branchIds)
    if (pfErr) {
      console.error('[admin:list-branches] profiles usage failed', pfErr.message)
      return json({ error: 'Query failed', code: 'db_error' }, 500)
    }
    for (const p of (profs ?? []) as { branch_id: string | null }[]) {
      if (!p.branch_id) continue
      profileCount.set(p.branch_id, (profileCount.get(p.branch_id) ?? 0) + 1)
    }

    const { data: pubs, error: pbErr } = await auth.supabaseAdmin
      .from('publications')
      .select('branch_id')
      .in('branch_id', branchIds)
    if (pbErr) {
      console.error('[admin:list-branches] publications usage failed', pbErr.message)
      return json({ error: 'Query failed', code: 'db_error' }, 500)
    }
    for (const p of (pubs ?? []) as { branch_id: string | null }[]) {
      if (!p.branch_id) continue
      publicationCount.set(p.branch_id, (publicationCount.get(p.branch_id) ?? 0) + 1)
    }
  }

  const result = brRows.map((b) => ({
    id: b.id,
    domain_id: b.domain_id,
    ecosystem: domainName.get(b.domain_id) ?? null,
    name: b.name,
    slug: b.slug,
    active: b.active,
    sort_order: b.sort_order,
    speciality_count: specCount.get(b.id) ?? 0,
    profiles: profileCount.get(b.id) ?? 0,
    publications: publicationCount.get(b.id) ?? 0,
  }))

  return json({ branches: result }, 200)
}
