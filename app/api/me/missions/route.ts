import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { loadTranslations } from '@/lib/translations'
import { routing, type Locale } from '@/i18n/routing'
import { buildPublicationSynthesis } from '@/lib/publication-synthesis'

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
  //  Lot disponibilité : on lit aussi availability_status / cdi_status pour
  //  le short-circuit "Ne pas déranger" (barrière feed serveur).
  const { data: profile, error: pErr } = await auth.supabaseAdmin
    .from('profiles')
    .select('id, user_id, domain_id, verification_status, availability_status, cdi_status')
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

  // Lot disponibilité — BARRIÈRE FEED non contournable côté serveur.
  // Un expert en "Ne pas déranger" ne reçoit AUCUNE mission dans son feed,
  // peu importe les matches déjà calculés. Symétrique côté entreprise via
  // loadEligibleProfiles (lib/matching/index.ts).
  //
  //   Freelance : availability_status = 'do_not_disturb' → feed vide.
  //   CDI       : cdi_status          = 'employed'       → feed vide.
  //   NULL est considéré disponible (défaut produit).
  const availStatus = (profile as { availability_status?: string | null }).availability_status ?? null
  const cdiStatus = (profile as { cdi_status?: string | null }).cdi_status ?? null
  if (availStatus === 'do_not_disturb' || cdiStatus === 'employed') {
    return json({ missions: [] }, 200)
  }

  const locale = normalizeLocale(new URL(request.url).searchParams.get('locale'))

  // ── Matches de l'expert + jointures, statut hors 'dismissed' ───────────
  //  Lot synthèse : on étend le select publications avec les champs requis
  //  par buildPublicationSynthesis (location, work_mode, duration, start_date,
  //  seniority). Branches/specialities passent par la même jointure pour
  //  obtenir les labels traduits via tBDD.
  const [matchesResult, translations] = await Promise.all([
    auth.supabaseAdmin
      .from('matches')
      .select(
        'id, publication_id, score, status, explanation, created_at, ' +
          'publications!inner(' +
          'id, type, title, branch_id, speciality_id, budget_min, budget_max, ' +
          'location, work_mode, duration, start_date, seniority, ' +
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
    const orgRaw = pickRel((pub as { organizations: unknown }).organizations as never) as
      | { id: string; company_name: string | null; logo_url: string | null }
      | null

    // Synthèse publication via le helper partagé (source unique).
    const synthesis = buildPublicationSynthesis(pub as Parameters<typeof buildPublicationSynthesis>[0], translations)

    return {
      // Match (côté expert)
      match_id: row.id,
      match_status: row.status,           // pending | notified | viewed | dismissed
      ai_score: Number(row.score),
      ai_reason: row.explanation?.reason ?? null,
      matched_at: row.created_at,
      // Publication (DTO masqué + synthèse parlante via helper partagé)
      publication: {
        ...synthesis,
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
