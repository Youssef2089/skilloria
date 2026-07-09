import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { signAvatarUrl } from '@/lib/avatar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/get-expert/[id] — fiche détaillée d'un profil expert
 * pour la review admin (mirror /api/admin/get-org/[id]).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
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

  const { data: profile, error } = await auth.supabaseAdmin
    .from('profiles')
    .select(
      'id, user_id, domain_id, expert_type, title, summary, seniority, ' +
        'years_experience, years_total_experience, languages, skills, certifications, ' +
        'location, mobility, tjm_min, tjm_max, salary_min, salary_max, ' +
        'availability_status, availability_date, work_modes, ' +
        'cv_url, linkedin_url, visible, ai_consent_at, cv_parsing_status, ' +
        'verification_status, verification_method, verification_score, ' +
        'verification_data, verified_at, verified_by, review_reason, ' +
        'photo_url, country, city, ' +
        'created_at, updated_at, ' +
        'branches(id, name, slug), specialities(id, name, slug), ' +
        'users!profiles_user_id_fkey(id, email, first_name, last_name, locale, user_type, civility, phone, linkedin_url, job_title)',
    )
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('[admin:get-expert] query failed', error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!profile) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }

  // Charger tables liées (best-effort)
  const [expRes, eduRes, langRes] = await Promise.all([
    auth.supabaseAdmin.from('profile_experiences').select('role, employer, sector, start_date, end_date, is_current, description').eq('profile_id', id).order('start_date', { ascending: false }).limit(20),
    auth.supabaseAdmin.from('profile_educations').select('school, degree, field, start_year, end_year, location').eq('profile_id', id).order('start_year', { ascending: false }).limit(10),
    auth.supabaseAdmin.from('profile_languages').select('language, level, is_primary').eq('profile_id', id).limit(15),
  ])

  // M3 : photo_url est un chemin storage. Admin voit tout -> URL signée (300s)
  // systématique quand une photo est présente. Seule la VALEUR change.
  const prof = profile as unknown as Record<string, unknown> & { user_id: string; photo_url: string | null }
  const expert = {
    ...prof,
    photo_url: prof.photo_url ? await signAvatarUrl(auth.supabaseAdmin, prof.user_id) : null,
  }

  return json(
    {
      expert,
      experiences: expRes.data ?? [],
      educations: eduRes.data ?? [],
      languages_structured: langRes.data ?? [],
    },
    200,
  )
}
