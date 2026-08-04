import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/get-branch/[id] (D7)
 *
 * Détail d'une branche pour l'édition admin :
 *   - champs de la branche + écosystème (domains.name),
 *   - usage de la branche (profils + publications),
 *   - ses spécialités, chacune avec son usage (profils + publications),
 *   - les traductions EN/ES/DE existantes (table public.translations, field
 *     'name') pour la branche et pour chaque spécialité. Le FR est la colonne
 *     `name` (base) : il n'est pas relu depuis translations.
 * Garde admin per-route via requireAdmin. service_role. AUCUN filtre domaine.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

const NON_FR_LOCALES = ['en', 'es', 'de'] as const
type NonFrLocale = (typeof NON_FR_LOCALES)[number]
type Translations = Partial<Record<NonFrLocale, string>>

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: RouteContext): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { id } = await ctx.params
  if (!id || !UUID_REGEX.test(id)) {
    return json({ error: 'Invalid id', code: 'invalid_id' }, 400)
  }

  // ── Branche ─────────────────────────────────────────────────────────────────
  const { data: branch, error: brErr } = await auth.supabaseAdmin
    .from('branches')
    .select('id, domain_id, name, slug, description, active, sort_order')
    .eq('id', id)
    .maybeSingle()
  if (brErr) {
    console.error('[admin:get-branch] branch query failed', brErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!branch) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }
  const br = branch as {
    id: string
    domain_id: string
    name: string
    slug: string
    description: string | null
    active: boolean
    sort_order: number
  }

  // ── Écosystème (domains.name) ───────────────────────────────────────────────
  const { data: dom } = await auth.supabaseAdmin
    .from('domains')
    .select('id, name')
    .eq('id', br.domain_id)
    .maybeSingle()
  const ecosystem = (dom as { name?: string } | null)?.name ?? null

  // ── Spécialités de la branche ───────────────────────────────────────────────
  const { data: specs, error: spErr } = await auth.supabaseAdmin
    .from('specialities')
    .select('id, name, slug, active, sort_order')
    .eq('branch_id', id)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (spErr) {
    console.error('[admin:get-branch] specialities query failed', spErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const specRows = (specs ?? []) as {
    id: string
    name: string
    slug: string
    active: boolean
    sort_order: number
  }[]
  const specIds = specRows.map((s) => s.id)

  // ── Usage branche (profils + publications) ──────────────────────────────────
  const { count: branchProfiles } = await auth.supabaseAdmin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('branch_id', id)
  const { count: branchPublications } = await auth.supabaseAdmin
    .from('publications')
    .select('id', { count: 'exact', head: true })
    .eq('branch_id', id)

  // ── Usage spécialités (profils + publications, agrégé en mémoire) ────────────
  const specProfiles = new Map<string, number>()
  const specPublications = new Map<string, number>()
  if (specIds.length > 0) {
    const { data: profs } = await auth.supabaseAdmin
      .from('profiles')
      .select('speciality_id')
      .in('speciality_id', specIds)
    for (const p of (profs ?? []) as { speciality_id: string | null }[]) {
      if (!p.speciality_id) continue
      specProfiles.set(p.speciality_id, (specProfiles.get(p.speciality_id) ?? 0) + 1)
    }
    const { data: pubs } = await auth.supabaseAdmin
      .from('publications')
      .select('speciality_id')
      .in('speciality_id', specIds)
    for (const p of (pubs ?? []) as { speciality_id: string | null }[]) {
      if (!p.speciality_id) continue
      specPublications.set(p.speciality_id, (specPublications.get(p.speciality_id) ?? 0) + 1)
    }
  }

  // ── Traductions EN/ES/DE (field 'name') pour branche + spécialités ──────────
  const branchTranslations: Translations = {}
  const specTranslations = new Map<string, Translations>()

  const { data: brTr } = await auth.supabaseAdmin
    .from('translations')
    .select('locale, value')
    .eq('table_name', 'branches')
    .eq('row_id', id)
    .eq('field', 'name')
    .in('locale', NON_FR_LOCALES as unknown as string[])
  for (const t of (brTr ?? []) as { locale: string; value: string }[]) {
    if ((NON_FR_LOCALES as readonly string[]).includes(t.locale)) {
      branchTranslations[t.locale as NonFrLocale] = t.value
    }
  }

  if (specIds.length > 0) {
    const { data: spTr } = await auth.supabaseAdmin
      .from('translations')
      .select('row_id, locale, value')
      .eq('table_name', 'specialities')
      .eq('field', 'name')
      .in('row_id', specIds)
      .in('locale', NON_FR_LOCALES as unknown as string[])
    for (const t of (spTr ?? []) as { row_id: string; locale: string; value: string }[]) {
      if (!(NON_FR_LOCALES as readonly string[]).includes(t.locale)) continue
      const cur = specTranslations.get(t.row_id) ?? {}
      cur[t.locale as NonFrLocale] = t.value
      specTranslations.set(t.row_id, cur)
    }
  }

  const specialities = specRows.map((s) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    active: s.active,
    sort_order: s.sort_order,
    profiles: specProfiles.get(s.id) ?? 0,
    publications: specPublications.get(s.id) ?? 0,
    translations: specTranslations.get(s.id) ?? {},
  }))

  return json(
    {
      branch: {
        id: br.id,
        domain_id: br.domain_id,
        ecosystem,
        name: br.name,
        slug: br.slug,
        description: br.description,
        active: br.active,
        sort_order: br.sort_order,
        profiles: branchProfiles ?? 0,
        publications: branchPublications ?? 0,
        translations: branchTranslations,
      },
      specialities,
    },
    200,
  )
}
