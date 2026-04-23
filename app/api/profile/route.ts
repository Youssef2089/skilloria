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

type PatchBody = Partial<{
  title: string | null
  summary: string | null
  seniority: 'junior' | 'confirmed' | 'senior' | 'expert' | null
  years_experience: number | null
  skills: string[] | null
  certifications: Array<{ name: string; issuer?: string | null; year?: number | null }> | null
  branch_slug: string | null
  speciality_slug: string | null
  languages: string[] | null
  location: string | null
  work_mode: 'remote' | 'onsite' | 'hybrid' | null
  tjm_min: number | null
  tjm_max: number | null
  availability_date: string | null
  linkedin_url: string | null
  visible: boolean
}>

export async function PATCH(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    console.error('[profile PATCH] auth error', err)
    return json({ error: 'Auth failed', code: 'auth_error' }, 500)
  }

  let body: PatchBody
  try {
    body = (await request.json()) as PatchBody
  } catch {
    return json({ error: 'Invalid JSON', code: 'bad_body' }, 400)
  }

  const { supabaseAdmin, user } = auth

  const { data: currentProfile, error: fetchErr } = await supabaseAdmin
    .from('profiles')
    .select('id, title, summary, skills, branch_id, speciality_id, work_mode')
    .eq('user_id', user.id)
    .maybeSingle()
  if (fetchErr || !currentProfile) {
    return json({ error: 'Profile not found', code: 'profile_missing' }, 404)
  }

  const patch: Record<string, unknown> = {}
  const directFields: Array<keyof PatchBody> = [
    'title', 'summary', 'seniority', 'years_experience', 'skills', 'certifications',
    'languages', 'location', 'work_mode', 'tjm_min', 'tjm_max',
    'availability_date', 'linkedin_url', 'visible',
  ]
  for (const k of directFields) {
    if (k in body) patch[k] = body[k] as unknown
  }

  if ('branch_slug' in body) {
    if (body.branch_slug === null) {
      patch.branch_id = null
    } else if (body.branch_slug) {
      const { data: br } = await supabaseAdmin
        .from('branches')
        .select('id')
        .eq('domain_id', user.domain_id)
        .eq('slug', body.branch_slug)
        .maybeSingle()
      if (!br) return json({ error: 'Unknown branch', code: 'bad_branch' }, 400)
      patch.branch_id = br.id
    }
  }
  if ('speciality_slug' in body) {
    if (body.speciality_slug === null) {
      patch.speciality_id = null
    } else if (body.speciality_slug) {
      const { data: sp } = await supabaseAdmin
        .from('specialities')
        .select('id')
        .eq('domain_id', user.domain_id)
        .eq('slug', body.speciality_slug)
        .maybeSingle()
      if (!sp) return json({ error: 'Unknown speciality', code: 'bad_speciality' }, 400)
      patch.speciality_id = sp.id
    }
  }

  if (body.visible === true) {
    const merged = {
      title: (patch.title ?? currentProfile.title) as string | null,
      summary: (patch.summary ?? currentProfile.summary) as string | null,
      skills: (patch.skills ?? currentProfile.skills) as string[] | null,
      branch_id: (patch.branch_id ?? currentProfile.branch_id) as string | null,
      speciality_id: (patch.speciality_id ?? currentProfile.speciality_id) as string | null,
      work_mode: (patch.work_mode ?? currentProfile.work_mode) as string | null,
    }
    const missing: string[] = []
    if (!merged.title) missing.push('title')
    if (!merged.summary) missing.push('summary')
    if (!merged.skills || merged.skills.length < 3) missing.push('skills')
    if (!merged.branch_id) missing.push('branch_id')
    if (!merged.speciality_id) missing.push('speciality_id')
    if (!merged.work_mode) missing.push('work_mode')
    if (missing.length) {
      return json({ error: 'Profile incomplete', code: 'incomplete', missing }, 400)
    }
  }

  if (Object.keys(patch).length === 0) {
    return json({ error: 'Empty patch', code: 'no_fields' }, 400)
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('profiles')
    .update(patch)
    .eq('id', currentProfile.id)
    .select('*')
    .single()

  if (updateErr) {
    console.error('[profile PATCH] update failed', updateErr)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  if (body.visible === true) {
    const { error: userUpdErr } = await supabaseAdmin
      .from('users')
      .update({ status: 'in_review' })
      .eq('id', user.id)
    if (userUpdErr) {
      console.error('[profile PATCH] user status update failed', userUpdErr)
    }
  }

  await supabaseAdmin.from('audit_logs').insert({
    user_id: user.id,
    domain_id: user.domain_id,
    action: 'profile_update',
    entity_type: 'profile',
    entity_id: currentProfile.id,
    detail: { keys: Object.keys(patch) },
  })

  return json({ profile: updated })
}
