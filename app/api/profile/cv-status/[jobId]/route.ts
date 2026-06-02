import { NextRequest } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  let auth
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    console.error('[cv-status] auth error', err)
    return json({ error: 'Auth failed', code: 'auth_error' }, 500)
  }

  const { jobId } = await context.params
  const { supabaseAdmin, user } = auth

  const { data: profile, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select(
      'id, user_id, cv_parsing_status, cv_parsing_error, title, summary, seniority, years_experience, skills, certifications, languages, location, tjm_min, tjm_max, linkedin_url, branch_id, speciality_id, work_modes',
    )
    .eq('id', jobId)
    .maybeSingle()

  if (profErr || !profile) {
    return json({ error: 'Job not found', code: 'not_found' }, 404)
  }

  if (profile.user_id !== user.id) {
    return json({ error: 'Forbidden', code: 'not_owner' }, 403)
  }

  return json({
    status: profile.cv_parsing_status ?? 'idle',
    error: profile.cv_parsing_error ?? undefined,
    data:
      profile.cv_parsing_status === 'done'
        ? {
            title: profile.title,
            summary: profile.summary,
            seniority: profile.seniority,
            years_experience: profile.years_experience,
            skills: profile.skills,
            certifications: profile.certifications,
            languages: profile.languages,
            location: profile.location,
            tjm_min: profile.tjm_min,
            tjm_max: profile.tjm_max,
            linkedin_url: profile.linkedin_url,
            branch_id: profile.branch_id,
            speciality_id: profile.speciality_id,
            work_modes: profile.work_modes ?? [],
          }
        : undefined,
  })
}
