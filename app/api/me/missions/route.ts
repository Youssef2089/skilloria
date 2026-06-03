import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { loadTranslations, tBDD } from '@/lib/translations'
import { routing, type Locale } from '@/i18n/routing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/me/missions — feed des opportunités matchées de l'expert courant.
 *
 * Garde : requireAuth → service_role.
 * - Charge le profile expert (profiles.user_id = auth.uid()).
 * - Joint matches → publications status='published' où le profile est matché.
 * - Filtre les matches en status 'dismissed' (l'expert les a déclinés).
 * - Masque l'identité de l'org si publication.confidential = true.
 *
 * → L'expert ne peut PAS parcourir le catalogue : la curation par matching
 *   est imposée côté serveur ET par la RLS publications (publications_published_expert_read
 *   a été retirée — cf. migration 20260603160000).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function normalizeLocale(raw: string | null): Locale {
  return (routing.locales as readonly string[]).includes(raw ?? '')
    ? (raw as Locale)
    : routing.defaultLocale
}

type MatchRow = {
  id: string
  publication_id: string
  score: number
  status: string
  explanation: { reason?: string; model?: string; evaluated_at?: string } | null
  created_at: string
  publications: {
    id: string
    type: string
    title: string
    branch_id: string | null
    speciality_id: string | null
    budget_min: number | null
    budget_max: number | null
    confidential: boolean
    status: string
    published_at: string | null
    organization_id: string
    branches: { id: string; name: string } | { id: string; name: string }[] | null
    specialities: { id: string; name: string } | { id: string; name: string }[] | null
    organizations: { id: string; company_name: string | null; logo_url: string | null } | { id: string; company_name: string | null; logo_url: string | null }[] | null
  } | { /* same */ }[] | null
}

function pickRel<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  // ── Profile expert courant ─────────────────────────────────────────────
  //  Lot vérif expert : defense-in-depth — exige verification_status='approved'.
  //  Si non vérifié → 403 not_verified. La nav freelance gate déjà côté UI.
  const { data: profile, error: pErr } = await auth.supabaseAdmin
    .from('profiles')
    .select('id, user_id, domain_id, verification_status')
    .eq('user_id', auth.user.id)
    .maybeSingle()
  if (pErr) {
    console.error('[me/missions:GET] profile lookup failed', pErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!profile) {
    // L'utilisateur n'a pas de profile (expert pas encore inscrit). Feed vide.
    return json({ missions: [] }, 200)
  }
  if ((profile as { verification_status?: string | null }).verification_status !== 'approved') {
    return json({ error: 'Profile not verified', code: 'not_verified' }, 403)
  }

  const locale = normalizeLocale(new URL(request.url).searchParams.get('locale'))

  // ── Matches de l'expert + jointures, statut hors 'dismissed' ───────────
  const [matchesResult, translations] = await Promise.all([
    auth.supabaseAdmin
      .from('matches')
      .select(
        'id, publication_id, score, status, explanation, created_at, ' +
          'publications!inner(' +
          'id, type, title, branch_id, speciality_id, budget_min, budget_max, ' +
          'confidential, status, published_at, organization_id, ' +
          'branches(id, name), specialities(id, name), ' +
          'organizations!inner(id, company_name, logo_url)' +
          ')',
      )
      .eq('profile_id', profile.id)
      .neq('status', 'dismissed')
      .eq('publications.status', 'published')
      .order('score', { ascending: false })
      .limit(200),
    loadTranslations(locale),
  ])

  if (matchesResult.error) {
    console.error('[me/missions:GET] matches query failed', matchesResult.error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  const rows = (matchesResult.data ?? []) as unknown as MatchRow[]
  const missions = rows.map((row) => {
    const pub = pickRel(row.publications)
    if (!pub) return null
    const branch = pickRel((pub as { branches: unknown }).branches as never)
    const speciality = pickRel((pub as { specialities: unknown }).specialities as never)
    const orgRaw = pickRel((pub as { organizations: unknown }).organizations as never) as
      | { id: string; company_name: string | null; logo_url: string | null }
      | null

    const branchLabel = branch
      ? tBDD(translations, 'branches', (branch as { id: string }).id, 'name', (branch as { name: string }).name)
      : null
    const specialityLabel = speciality
      ? tBDD(translations, 'specialities', (speciality as { id: string }).id, 'name', (speciality as { name: string }).name)
      : null

    return {
      // Match (côté expert)
      match_id: row.id,
      match_status: row.status,           // pending | notified | viewed | dismissed
      ai_score: Number(row.score),
      ai_reason: row.explanation?.reason ?? null,
      matched_at: row.created_at,
      // Publication (DTO masqué)
      publication: {
        id: (pub as { id: string }).id,
        type: (pub as { type: string }).type,
        title: (pub as { title: string }).title,
        budget_min: (pub as { budget_min: number | null }).budget_min,
        budget_max: (pub as { budget_max: number | null }).budget_max,
        branch_label: branchLabel,
        speciality_label: specialityLabel,
        confidential: (pub as { confidential: boolean }).confidential,
        published_at: (pub as { published_at: string | null }).published_at,
      },
      // Org : masqué si confidential
      org: (pub as { confidential: boolean }).confidential
        ? null
        : orgRaw
          ? { name: orgRaw.company_name ?? null, logo_url: orgRaw.logo_url ?? null }
          : null,
    }
  }).filter((x): x is NonNullable<typeof x> => x !== null)

  return json({ missions }, 200)
}
