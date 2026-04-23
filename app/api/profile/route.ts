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

type ExperienceInput = {
  experience_type: 'career' | 'project'
  role: string
  employer?: string | null
  client_name?: string | null
  sector?: string | null
  start_date: string
  end_date?: string | null
  is_current?: boolean
  description?: string | null
}

type EducationInput = {
  school: string
  degree: string
  field?: string | null
  start_year?: number | null
  end_year?: number | null
  location?: string | null
}

type LanguageInput = {
  language: string
  level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'native'
  is_primary?: boolean
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
  phone: string | null
  address_line: string | null
  postal_code: string | null
  city: string | null
  country: string | null
  birth_year: number | null
  photo_url: string | null
  years_total_experience: number | null
  availability_status: string | null
  experiences: ExperienceInput[]
  educations: EducationInput[]
  languages_structured: LanguageInput[]
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
    'title', 'summary', 'seniority', 'years_experience',
    'skills', 'certifications',
    'languages', 'location', 'work_mode', 'tjm_min', 'tjm_max',
    'availability_date', 'linkedin_url', 'visible',
    'phone', 'address_line', 'postal_code', 'city', 'country',
    'birth_year', 'photo_url', 'years_total_experience', 'availability_status',
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

  // Validation pour publication
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

    // experiences >= 1 (body ou BDD)
    let experiencesCount: number
    if ('experiences' in body) {
      experiencesCount = Array.isArray(body.experiences)
        ? body.experiences.filter(e => e.role?.trim()).length
        : 0
    } else {
      const { count } = await supabaseAdmin
        .from('profile_experiences')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', currentProfile.id)
      experiencesCount = count ?? 0
    }
    if (experiencesCount < 1) missing.push('experiences')

    // languages_structured >= 1 (body ou BDD)
    let languagesCount: number
    if ('languages_structured' in body) {
      languagesCount = Array.isArray(body.languages_structured)
        ? body.languages_structured.filter(l => l.language?.trim()).length
        : 0
    } else {
      const { count } = await supabaseAdmin
        .from('profile_languages')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', currentProfile.id)
      languagesCount = count ?? 0
    }
    if (languagesCount < 1) missing.push('languages_structured')

    if (missing.length) {
      return json({ error: 'Profile incomplete', code: 'incomplete', missing }, 400)
    }
  }

  const touchedBlocks: string[] = []
  const shouldUpdateScalars = Object.keys(patch).length > 0

  // Empty body check: must have either scalars or at least one block
  const hasAnyBlock =
    'experiences' in body || 'educations' in body || 'languages_structured' in body
  if (!shouldUpdateScalars && !hasAnyBlock) {
    return json({ error: 'Empty patch', code: 'no_fields' }, 400)
  }

  let updatedProfile: unknown = null
  if (shouldUpdateScalars) {
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
    updatedProfile = updated
  }

  // --- Block: experiences ---
  if ('experiences' in body) {
    const list = Array.isArray(body.experiences) ? body.experiences : []
    const { error: delErr } = await supabaseAdmin
      .from('profile_experiences')
      .delete()
      .eq('profile_id', currentProfile.id)
    if (delErr) {
      console.error('[profile PATCH] experiences delete failed', delErr)
    } else if (list.length > 0) {
      const rows = list
        .filter(e => e.role?.trim())
        .map((e, i) => ({
          profile_id: currentProfile.id,
          domain_id: user.domain_id,
          sort_order: i,
          experience_type: e.experience_type,
          role: e.role.trim(),
          employer: e.employer?.toString().trim() || null,
          client_name: e.client_name?.toString().trim() || null,
          sector: e.sector?.toString().trim() || null,
          start_date: e.start_date,
          end_date: e.is_current ? null : e.end_date ?? null,
          is_current: !!e.is_current,
          description: e.description?.toString().trim() || null,
        }))
      if (rows.length > 0) {
        const { error: insErr } = await supabaseAdmin
          .from('profile_experiences')
          .insert(rows)
        if (insErr) console.error('[profile PATCH] experiences insert failed', insErr)
      }
    }
    touchedBlocks.push('experiences')
  }

  // --- Block: educations ---
  if ('educations' in body) {
    const list = Array.isArray(body.educations) ? body.educations : []
    const { error: delErr } = await supabaseAdmin
      .from('profile_educations')
      .delete()
      .eq('profile_id', currentProfile.id)
    if (delErr) {
      console.error('[profile PATCH] educations delete failed', delErr)
    } else if (list.length > 0) {
      const rows = list
        .filter(e => e.school?.trim() && e.degree?.trim())
        .map(e => ({
          profile_id: currentProfile.id,
          domain_id: user.domain_id,
          school: e.school.trim(),
          degree: e.degree.trim(),
          field: e.field?.toString().trim() || null,
          start_year: e.start_year ?? null,
          end_year: e.end_year ?? null,
          location: e.location?.toString().trim() || null,
        }))
      if (rows.length > 0) {
        const { error: insErr } = await supabaseAdmin
          .from('profile_educations')
          .insert(rows)
        if (insErr) console.error('[profile PATCH] educations insert failed', insErr)
      }
    }
    touchedBlocks.push('educations')
  }

  // --- Block: languages_structured ---
  if ('languages_structured' in body) {
    const list = Array.isArray(body.languages_structured) ? body.languages_structured : []
    const seen = new Set<string>()
    const deduped = list.filter(l => {
      const key = l.language?.trim().toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    // une seule langue principale maximum
    let primaryKept = false
    const normalised = deduped.map(l => {
      const keepPrimary = !!l.is_primary && !primaryKept
      if (keepPrimary) primaryKept = true
      return { ...l, is_primary: keepPrimary }
    })

    const { error: delErr } = await supabaseAdmin
      .from('profile_languages')
      .delete()
      .eq('profile_id', currentProfile.id)
    if (delErr) {
      console.error('[profile PATCH] languages delete failed', delErr)
    } else if (normalised.length > 0) {
      const rows = normalised.map(l => ({
        profile_id: currentProfile.id,
        language: l.language.trim(),
        level: l.level,
        is_primary: l.is_primary,
      }))
      const { error: insErr } = await supabaseAdmin
        .from('profile_languages')
        .insert(rows)
      if (insErr) console.error('[profile PATCH] languages insert failed', insErr)
    }
    touchedBlocks.push('languages_structured')
  }

  // Passage en review si publication
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
    detail: { keys: Object.keys(patch), blocks: touchedBlocks },
  })

  return json({ profile: updatedProfile })
}
