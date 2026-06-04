import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { loadTranslations, tBDD } from '@/lib/translations'
import { routing, type Locale } from '@/i18n/routing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/publications/[id]/candidatures — liste des candidatures sur une
 * publication, côté ORG.
 *
 * Garde (service_role) :
 *  - requireAuth + auth.organization?.id présent (membre actif d'une org)
 *  - publication.organization_id == auth.organization.id  (ownership stricte)
 *
 * Masquage stricte (cf. décision Lot 2c, point 3) :
 *  - PROFILE COMPLET NON LISIBLE : on ne fait AUCUNE jointure sur `profiles`.
 *    Tant que candidature.status != 'unlocked', l'UI ne voit que la
 *    `preview` (whitelist safe-fields posée à l'INSERT par Lot 2b) +
 *    cover_message + ai_match_score + status.
 *  - `profile_id` est exposé en référence opaque (uuid), pour permettre à
 *    l'UI post-unlock d'appeler la route /api/profiles/[id] (à venir) qui
 *    projettera le profil complet (RLS profiles_org_unlocked_read s'active
 *    alors automatiquement côté authenticated).
 *
 * Tri : ai_match_score DESC NULLS LAST, created_at DESC.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

function normalizeLocale(raw: string | null): Locale {
  return (routing.locales as readonly string[]).includes(raw ?? '')
    ? (raw as Locale)
    : routing.defaultLocale
}

type CandidatureRow = {
  id: string
  publication_id: string
  profile_id: string
  match_id: string | null
  cover_message: string | null
  ai_match_score: number | null
  status: string
  status_reason: string | null
  unlocked_at: string | null
  preview: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: RouteContext): Promise<Response> {
  // ── Auth + org ──────────────────────────────────────────────────────────
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const orgId = auth.organization?.id
  if (!orgId) {
    return json({ error: 'No organization', code: 'org_required' }, 403)
  }

  const { id: publicationId } = await ctx.params
  if (!publicationId || !UUID_REGEX.test(publicationId)) {
    return json({ error: 'Invalid id', code: 'invalid_id' }, 400)
  }

  // ── Ownership : la publication appartient à cette org ──────────────────
  const { data: pub, error: pubErr } = await auth.supabaseAdmin
    .from('publications')
    .select('id, organization_id, type, title, confidential, status')
    .eq('id', publicationId)
    .maybeSingle()
  if (pubErr) {
    console.error('[publications/[id]/candidatures:GET] pub lookup failed', pubErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!pub) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }
  const pubRow = pub as { id: string; organization_id: string; type: string; title: string; confidential: boolean; status: string }
  if (pubRow.organization_id !== orgId) {
    // 404 plutôt que 403 — ne pas leak l'existence d'une publi d'une autre org.
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }

  // ── Charger candidatures + translations en parallèle ───────────────────
  const locale = normalizeLocale(new URL(request.url).searchParams.get('locale'))
  const [candResult, translations] = await Promise.all([
    auth.supabaseAdmin
      .from('candidatures')
      .select(
        'id, publication_id, profile_id, match_id, cover_message, ai_match_score, ' +
          'status, status_reason, unlocked_at, preview, created_at, updated_at',
      )
      .eq('publication_id', publicationId)
      .order('ai_match_score', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(500),
    loadTranslations(locale),
  ])

  if (candResult.error) {
    console.error('[publications/[id]/candidatures:GET] query failed', candResult.error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  const rows = (candResult.data ?? []) as unknown as CandidatureRow[]

  // ── Pitch IA orienté org (Lot finitions UX Point 2) ──────────────────────
  //    Charge matches.explanation pour chaque match_id présent. On en extrait
  //    pitch_org (orienté chasse) ; fallback sur reason si pitch_org absent
  //    (matchs legacy d'avant ce lot). Aucune PII ne transite : matches.explanation
  //    contient uniquement les textes générés par l'IA depuis ProfileCandidate
  //    (whitelist, voir lib/matching/ai-profile-matching.ts).
  const matchIds = Array.from(new Set(rows.map((r) => r.match_id).filter((id): id is string => !!id)))
  const pitchByMatch = new Map<string, string>()
  if (matchIds.length > 0) {
    const { data: matchRows } = await auth.supabaseAdmin
      .from('matches')
      .select('id, explanation')
      .in('id', matchIds)
    for (const m of ((matchRows ?? []) as { id: string; explanation: { pitch_org?: string | null; reason?: string | null } | null }[])) {
      const pitch = m.explanation?.pitch_org?.trim() || m.explanation?.reason?.trim() || ''
      if (pitch) pitchByMatch.set(m.id, pitch)
    }
  }

  // ── Conversation_id pour les candidatures unlocked (Lot 3) ─────────────
  //    Batch query : on récupère l'id de conv pour chaque candidature unlocked.
  const unlockedCandIds = rows.filter((r) => r.status === 'unlocked').map((r) => r.id)
  const convIdByCand = new Map<string, string>()
  if (unlockedCandIds.length > 0) {
    const { data: convs } = await auth.supabaseAdmin
      .from('conversations')
      .select('id, candidature_id')
      .in('candidature_id', unlockedCandIds)
    for (const c of ((convs ?? []) as { id: string; candidature_id: string }[])) {
      convIdByCand.set(c.candidature_id, c.id)
    }
  }

  // ── Profil COMPLET pour les candidatures unlocked (payoff Lot 2c) ──────
  //    On lit profiles + users uniquement pour les profile_ids des candidatures
  //    déjà unlocked. RLS profiles_org_unlocked_read est en place côté
  //    authenticated, et le service_role bypasse — on ré-applique l'invariant
  //    « status='unlocked' » côté code ici (defense in depth).
  const unlockedProfileIds = new Set(
    rows.filter((r) => r.status === 'unlocked').map((r) => r.profile_id),
  )
  type FullProfile = {
    id: string
    user_id: string
    title: string | null
    summary: string | null
    skills: string[] | null
    seniority: string | null
    expert_type: string | null
    years_experience: number | null
    years_total_experience: number | null
    tjm_min: number | null
    tjm_max: number | null
    salary_min: number | null
    salary_max: number | null
    work_modes: string[] | null
    languages: string[] | null
    country: string | null
    city: string | null
    address_line: string | null
    postal_code: string | null
    availability_status: string | null
    availability_date: string | null
    profile_score: number | null
    cv_url: string | null
    linkedin_url: string | null
    photo_url: string | null
    birth_year: number | null
    branch_id: string | null
    speciality_id: string | null
    users: { id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; civility: string | null; job_title: string | null; linkedin_url: string | null } | { id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; civility: string | null; job_title: string | null; linkedin_url: string | null }[]
  }
  const fullProfileById = new Map<string, FullProfile>()
  if (unlockedProfileIds.size > 0) {
    const { data: profRows } = await auth.supabaseAdmin
      .from('profiles')
      .select(
        'id, user_id, title, summary, skills, seniority, expert_type, ' +
          'years_experience, years_total_experience, tjm_min, tjm_max, salary_min, salary_max, ' +
          'work_modes, languages, country, city, address_line, postal_code, ' +
          'availability_status, availability_date, profile_score, cv_url, ' +
          'linkedin_url, photo_url, birth_year, branch_id, speciality_id, ' +
          'users!profiles_user_id_fkey!inner(id, first_name, last_name, email, phone, civility, job_title, linkedin_url)',
      )
      .in('id', Array.from(unlockedProfileIds))
    for (const p of ((profRows ?? []) as unknown as FullProfile[])) {
      fullProfileById.set(p.id, p)
    }
  }

  // ── Collecte branches/specialities référencées par les previews ────────
  //    Une seule query batch pour récupérer les `name` de fallback FR.
  const branchIds = new Set<string>()
  const specIds = new Set<string>()
  for (const r of rows) {
    const p = r.preview ?? {}
    if (typeof p.branch_id === 'string') branchIds.add(p.branch_id)
    if (typeof p.speciality_id === 'string') specIds.add(p.speciality_id)
  }
  const branchNameById = new Map<string, string>()
  const specNameById = new Map<string, string>()
  if (branchIds.size > 0) {
    const { data: bRows } = await auth.supabaseAdmin
      .from('branches')
      .select('id, name')
      .in('id', Array.from(branchIds))
    for (const b of (bRows ?? []) as { id: string; name: string }[]) {
      branchNameById.set(b.id, b.name)
    }
  }
  if (specIds.size > 0) {
    const { data: sRows } = await auth.supabaseAdmin
      .from('specialities')
      .select('id, name')
      .in('id', Array.from(specIds))
    for (const s of (sRows ?? []) as { id: string; name: string }[]) {
      specNameById.set(s.id, s.name)
    }
  }

  // ── DTO : preview masquée + profil complet SI unlocked ─────────────────
  const candidatures = rows.map((row) => {
    const preview = row.preview ?? {}
    const branchId = typeof preview.branch_id === 'string' ? preview.branch_id : null
    const specialityId = typeof preview.speciality_id === 'string' ? preview.speciality_id : null

    // Profil complet (payoff post-unlock). Null tant que status != 'unlocked'.
    let unlockedProfile: Record<string, unknown> | null = null
    if (row.status === 'unlocked') {
      const fp = fullProfileById.get(row.profile_id)
      if (fp) {
        const u = Array.isArray(fp.users) ? fp.users[0] : fp.users
        unlockedProfile = {
          first_name: u?.first_name ?? null,
          last_name: u?.last_name ?? null,
          civility: u?.civility ?? null,
          email: u?.email ?? null,
          phone: u?.phone ?? null,
          job_title: u?.job_title ?? null,
          user_linkedin_url: u?.linkedin_url ?? null,
          title: fp.title,
          summary: fp.summary,
          skills: fp.skills ?? [],
          seniority: fp.seniority,
          expert_type: fp.expert_type,
          years_experience: fp.years_experience,
          years_total_experience: fp.years_total_experience,
          tjm_min: fp.tjm_min,
          tjm_max: fp.tjm_max,
          salary_min: fp.salary_min,
          salary_max: fp.salary_max,
          work_modes: fp.work_modes ?? [],
          languages: fp.languages ?? [],
          country: fp.country,
          city: fp.city,
          address_line: fp.address_line,
          postal_code: fp.postal_code,
          availability_status: fp.availability_status,
          availability_date: fp.availability_date,
          profile_score: fp.profile_score,
          cv_url: fp.cv_url,
          linkedin_url: fp.linkedin_url,
          photo_url: fp.photo_url,
          birth_year: fp.birth_year,
        }
      }
    }

    return {
      id: row.id,
      profile_id: row.profile_id,           // ref opaque, pas de PII
      match_id: row.match_id,
      status: row.status,
      status_reason: row.status_reason,
      unlocked_at: row.unlocked_at,
      cover_message: row.cover_message,
      ai_match_score: row.ai_match_score,
      created_at: row.created_at,
      conversation_id: row.status === 'unlocked' ? convIdByCand.get(row.id) ?? null : null,
      ai_pitch: row.match_id ? (pitchByMatch.get(row.match_id) ?? null) : null,
      unlocked_profile: unlockedProfile,
      preview: {
        title:                preview.title ?? null,
        summary:              preview.summary ?? null,
        skills:               Array.isArray(preview.skills) ? preview.skills : [],
        seniority:            preview.seniority ?? null,
        expert_type:          preview.expert_type ?? null,
        years_experience:     preview.years_experience ?? null,
        years_total_experience: preview.years_total_experience ?? null,
        tjm_min:              preview.tjm_min ?? null,
        tjm_max:              preview.tjm_max ?? null,
        salary_min:           preview.salary_min ?? null,
        salary_max:           preview.salary_max ?? null,
        work_modes:           Array.isArray(preview.work_modes) ? preview.work_modes : [],
        languages:            Array.isArray(preview.languages) ? preview.languages : [],
        country:              preview.country ?? null,
        city:                 preview.city ?? null,
        availability_status:  preview.availability_status ?? null,
        availability_date:    preview.availability_date ?? null,
        profile_score:        preview.profile_score ?? null,
        branch_label:         branchId
          ? tBDD(translations, 'branches', branchId, 'name', branchNameById.get(branchId) ?? '')
          : null,
        speciality_label:     specialityId
          ? tBDD(translations, 'specialities', specialityId, 'name', specNameById.get(specialityId) ?? '')
          : null,
      },
    }
  })

  return json(
    {
      publication: {
        id: pubRow.id,
        type: pubRow.type,
        title: pubRow.title,
        status: pubRow.status,
      },
      candidatures,
    },
    200,
  )
}
