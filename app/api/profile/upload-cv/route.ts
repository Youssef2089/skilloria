import { NextRequest } from 'next/server'
import crypto from 'node:crypto'
import { AuthError, requireAuth } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'
import { parseCV } from '@/lib/cv-parser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_SIZE = 5 * 1024 * 1024
const RATE_LIMIT = 3

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  let ctx
  try {
    ctx = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    console.error('[upload-cv] auth error', err)
    return json({ error: 'Auth failed', code: 'auth_error' }, 500)
  }

  if (process.env.ENABLE_AI_CV_PARSING !== 'true') {
    return json({ error: 'AI parsing disabled', code: 'ai_disabled' }, 503)
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (err) {
    console.error('[upload-cv] formData parse failed', err)
    return json({ error: 'Invalid multipart body', code: 'bad_body' }, 400)
  }

  const file = formData.get('file')
  const consent = formData.get('consent')
  if (consent !== 'true') {
    return json({ error: 'Consent required', code: 'consent_missing' }, 400)
  }
  if (!(file instanceof File)) {
    return json({ error: 'File missing', code: 'file_missing' }, 400)
  }
  if (file.size > MAX_SIZE) {
    return json({ error: 'File too large (max 5 MB)', code: 'file_too_large' }, 400)
  }
  if (file.type !== 'application/pdf') {
    return json({ error: 'PDF required', code: 'bad_mime' }, 400)
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const hash = crypto.createHash('sha256').update(buffer).digest('hex')
  const { supabaseAdmin, user } = ctx
  console.log('[cv-debug] upload-cv ENTRY', { userId: user.id, bytes: buffer.length, hashPrefix: hash.slice(0, 8) })

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select(
      'id, cv_file_path, cv_hash, cv_parsing_status, cv_parsing_count_24h, cv_parsing_reset_at, ai_consent_at, title, summary, seniority, years_experience, skills, certifications, branch_id, speciality_id, languages, location, tjm_min, tjm_max, linkedin_url, phone, address_line, postal_code, city, country, birth_year, photo_url, years_total_experience, work_modes',
    )
    .eq('user_id', user.id)
    .maybeSingle()

  if (profileErr || !profile) {
    console.error('[upload-cv] profile lookup failed', {
      userId: user.id,
      err: profileErr?.message,
    })
    return json({ error: 'Profile not found', code: 'profile_missing' }, 404)
  }

  const now = new Date()
  const resetAt = profile.cv_parsing_reset_at
    ? new Date(profile.cv_parsing_reset_at)
    : null
  const windowActive = resetAt !== null && resetAt > now
  const count24h = profile.cv_parsing_count_24h ?? 0

  if (windowActive && count24h >= RATE_LIMIT) {
    return json(
      {
        error: 'Rate limit: 3 parsings / 24h',
        code: 'rate_limited',
        reset_at: resetAt!.toISOString(),
      },
      429,
    )
  }

  console.log('[cv-debug] profile loaded', {
    profileId: profile.id,
    cv_hash_match: profile.cv_hash === hash,
    cv_parsing_status: profile.cv_parsing_status,
    count24h: profile.cv_parsing_count_24h,
  })
  if (profile.cv_hash === hash && profile.cv_parsing_status === 'done') {
    console.log('[cv-debug] CACHE HIT — renvoi status=done immédiat sans re-parse')
    const [{ data: cachedExp }, { data: cachedEdu }, { data: cachedLang }] =
      await Promise.all([
        supabaseAdmin
          .from('profile_experiences')
          .select('*')
          .eq('profile_id', profile.id)
          .order('sort_order', { ascending: true }),
        supabaseAdmin
          .from('profile_educations')
          .select('*')
          .eq('profile_id', profile.id)
          .order('end_year', { ascending: false, nullsFirst: true }),
        supabaseAdmin.from('profile_languages').select('*').eq('profile_id', profile.id),
      ])

    return json({
      jobId: profile.id,
      status: 'done',
      cached: true,
      data: {
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
        phone: profile.phone,
        address_line: profile.address_line,
        postal_code: profile.postal_code,
        city: profile.city,
        country: profile.country,
        birth_year: profile.birth_year,
        photo_url: profile.photo_url,
        years_total_experience: profile.years_total_experience,
        work_modes: profile.work_modes ?? [],
        experiences: cachedExp ?? [],
        educations: cachedEdu ?? [],
        languages_structured: cachedLang ?? [],
      },
    })
  }

  const storagePath = `${user.id}/${hash}.pdf`
  const { error: storageErr } = await supabaseAdmin.storage
    .from('cv')
    .upload(storagePath, buffer, {
      contentType: 'application/pdf',
      upsert: true,
    })
  if (storageErr) {
    console.error('[upload-cv] storage upload failed', {
      userId: user.id,
      msg: storageErr.message,
    })
    return json({ error: 'Upload failed', code: 'storage_error' }, 500)
  }

  const nextResetAt = windowActive
    ? resetAt!.toISOString()
    : new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  const nextCount = windowActive ? count24h + 1 : 1
  const consentAt = profile.ai_consent_at ?? now.toISOString()

  const { error: updateErr } = await supabaseAdmin
    .from('profiles')
    .update({
      cv_file_path: storagePath,
      cv_hash: hash,
      cv_uploaded_at: now.toISOString(),
      cv_parsing_status: 'processing',
      cv_parsed_at: null,
      cv_parsing_error: null,
      ai_consent_at: consentAt,
      cv_parsing_count_24h: nextCount,
      cv_parsing_reset_at: nextResetAt,
    })
    .eq('id', profile.id)

  if (updateErr) {
    console.error('[upload-cv] status=processing update failed', updateErr)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  const [{ data: branchRows }, { data: specialityRows }, { data: configRow }] =
    await Promise.all([
      supabaseAdmin.from('branches').select('slug').eq('domain_id', user.domain_id),
      supabaseAdmin.from('specialities').select('slug').eq('domain_id', user.domain_id),
      supabaseAdmin
        .from('domain_configs')
        .select('tags')
        .eq('domain_id', user.domain_id)
        .maybeSingle(),
    ])

  const domainCtx = {
    tags: (configRow?.tags as string[] | null) ?? [],
    branches: (branchRows ?? []).map((b: any) => b.slug as string),
    specialities: (specialityRows ?? []).map((s: any) => s.slug as string),
  }

  console.log('[cv-debug] avant parseCV(Claude)', { domain_id: user.domain_id, branchesCount: domainCtx.branches.length, specialitiesCount: domainCtx.specialities.length })
  const t0Parse = Date.now()
  const result = await parseCV(buffer, domainCtx)
  console.log('[cv-debug] après parseCV', { success: result.success, error: !result.success ? (result as { error: string }).error : null, durationMs: Date.now() - t0Parse })

  if (!result.success) {
    await supabaseAdmin
      .from('profiles')
      .update({
        cv_parsing_status: 'failed',
        cv_parsing_error: result.error.slice(0, 500),
      })
      .eq('id', profile.id)

    await logAudit({
      supabaseAdmin,
      user_id: user.id,
      domain_id: user.domain_id,
      action: 'cv_upload',
      entity_type: 'profile',
      entity_id: profile.id,
      detail: { status: 'failed', error: result.error, hash },
    })

    console.log('[cv-debug] RETURN status=failed', { jobId: profile.id, error: result.error })
    return json({ jobId: profile.id, status: 'failed', error: result.error })
  }

  const parsed = result.data
  let branchId: string | null = null
  let specialityId: string | null = null
  if (parsed.branch_slug) {
    const { data: br } = await supabaseAdmin
      .from('branches')
      .select('id')
      .eq('domain_id', user.domain_id)
      .eq('slug', parsed.branch_slug)
      .maybeSingle()
    branchId = br?.id ?? null
  }
  if (parsed.speciality_slug) {
    const { data: sp } = await supabaseAdmin
      .from('specialities')
      .select('id')
      .eq('domain_id', user.domain_id)
      .eq('slug', parsed.speciality_slug)
      .maybeSingle()
    specialityId = sp?.id ?? null
  }

  // COALESCE: ne pas écraser ce que le user a déjà rempli manuellement
  const coalesce = <T>(existing: T | null | undefined, next: T | null): T | null => {
    const isEmpty =
      existing === null ||
      existing === undefined ||
      (Array.isArray(existing) && existing.length === 0) ||
      (typeof existing === 'string' && existing.trim() === '')
    return isEmpty ? next : (existing as T)
  }

  const { error: finalErr } = await supabaseAdmin
    .from('profiles')
    .update({
      cv_parsing_status: 'done',
      cv_parsed_at: now.toISOString(),
      cv_parsing_error: null,
      title: coalesce(profile.title, parsed.title),
      summary: coalesce(profile.summary, parsed.summary),
      seniority: coalesce(profile.seniority, parsed.seniority),
      years_experience: coalesce(profile.years_experience, parsed.years_experience),
      skills: coalesce(profile.skills as any, parsed.skills),
      certifications: coalesce(profile.certifications as any, parsed.certifications),
      branch_id: coalesce(profile.branch_id, branchId),
      speciality_id: coalesce(profile.speciality_id, specialityId),
      languages: coalesce(profile.languages as any, parsed.languages),
      location: coalesce(profile.location, parsed.location),
      tjm_min: coalesce(profile.tjm_min, parsed.tjm_min),
      tjm_max: coalesce(profile.tjm_max, parsed.tjm_max),
      linkedin_url: coalesce(profile.linkedin_url, parsed.linkedin_url),
      phone: coalesce(profile.phone, parsed.phone),
      address_line: coalesce(profile.address_line, parsed.address_line),
      postal_code: coalesce(profile.postal_code, parsed.postal_code),
      city: coalesce(profile.city, parsed.city),
      country: coalesce(profile.country, parsed.country),
      birth_year: coalesce(profile.birth_year, parsed.birth_year),
      photo_url: coalesce(profile.photo_url, parsed.photo_url),
      years_total_experience: coalesce(
        profile.years_total_experience,
        parsed.years_total_experience,
      ),
      work_modes: coalesce(profile.work_modes as any, parsed.work_modes),
    })
    .eq('id', profile.id)

  if (finalErr) {
    console.error('[upload-cv] final update failed', finalErr)
  }

  // ---- Blocs enrichis : DELETE + INSERT uniquement si des données sont fournies ----

  if (Array.isArray(parsed.experiences) && parsed.experiences.length > 0) {
    const { error: delErr } = await supabaseAdmin
      .from('profile_experiences')
      .delete()
      .eq('profile_id', profile.id)
    if (delErr) {
      console.error('[upload-cv] experiences delete failed', delErr)
    } else {
      const rows = parsed.experiences.map((e, i) => ({
        profile_id: profile.id,
        domain_id: user.domain_id,
        sort_order: i,
        experience_type: e.experience_type,
        role: e.role,
        employer: e.employer,
        client_name: e.client_name,
        sector: e.sector,
        start_date: e.start_date,
        end_date: e.is_current ? null : e.end_date,
        is_current: e.is_current,
        description: e.description,
      }))
      const { error: insErr } = await supabaseAdmin
        .from('profile_experiences')
        .insert(rows)
      if (insErr) console.error('[upload-cv] experiences insert failed', insErr)
    }
  }

  if (Array.isArray(parsed.educations) && parsed.educations.length > 0) {
    const { error: delErr } = await supabaseAdmin
      .from('profile_educations')
      .delete()
      .eq('profile_id', profile.id)
    if (delErr) {
      console.error('[upload-cv] educations delete failed', delErr)
    } else {
      const rows = parsed.educations.map(e => ({
        profile_id: profile.id,
        domain_id: user.domain_id,
        school: e.school,
        degree: e.degree,
        field: e.field,
        start_year: e.start_year,
        end_year: e.end_year,
        location: e.location,
      }))
      const { error: insErr } = await supabaseAdmin
        .from('profile_educations')
        .insert(rows)
      if (insErr) console.error('[upload-cv] educations insert failed', insErr)
    }
  }

  if (
    Array.isArray(parsed.languages_structured) &&
    parsed.languages_structured.length > 0
  ) {
    const seen = new Set<string>()
    const deduped = parsed.languages_structured.filter(l => {
      const key = l.language?.trim().toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })

    // Une seule langue principale max
    let primaryKept = false
    const normalised = deduped.map(l => {
      if (l.is_primary && !primaryKept) {
        primaryKept = true
        return { ...l, is_primary: true }
      }
      return { ...l, is_primary: false }
    })

    const { error: delErr } = await supabaseAdmin
      .from('profile_languages')
      .delete()
      .eq('profile_id', profile.id)
    if (delErr) {
      console.error('[upload-cv] languages delete failed', delErr)
    } else {
      const rows = normalised.map(l => ({
        profile_id: profile.id,
        language: l.language.trim(),
        level: l.level,
        is_primary: l.is_primary,
      }))
      const { error: insErr } = await supabaseAdmin
        .from('profile_languages')
        .insert(rows)
      if (insErr) console.error('[upload-cv] languages insert failed', insErr)
    }
  }

  await logAudit({
    supabaseAdmin,
    user_id: user.id,
    domain_id: user.domain_id,
    action: 'cv_upload',
    entity_type: 'profile',
    entity_id: profile.id,
    detail: {
      status: 'done',
      hash,
      bytes: buffer.length,
      blocks: {
        experiences: parsed.experiences?.length ?? 0,
        educations: parsed.educations?.length ?? 0,
        languages_structured: parsed.languages_structured?.length ?? 0,
      },
    },
  })

  console.log('[cv-debug] RETURN status=done', { jobId: profile.id, title: parsed.title, skillsCount: parsed.skills?.length ?? 0 })
  return json({
    jobId: profile.id,
    status: 'done',
    data: {
      ...parsed,
      experiences: parsed.experiences ?? [],
      educations: parsed.educations ?? [],
      languages_structured: parsed.languages_structured ?? [],
    },
  })
}
