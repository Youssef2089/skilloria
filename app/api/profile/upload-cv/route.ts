import { NextRequest } from 'next/server'
import crypto from 'node:crypto'
import { AuthError, requireAuth } from '@/lib/auth-guard'
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

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select(
      'id, cv_file_path, cv_hash, cv_parsing_status, cv_parsing_count_24h, cv_parsing_reset_at, ai_consent_at, title, summary, seniority, years_experience, skills, certifications, branch_id, speciality_id, languages, location, tjm_min, tjm_max, linkedin_url',
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

  if (profile.cv_hash === hash && profile.cv_parsing_status === 'done') {
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

  const result = await parseCV(buffer, domainCtx)

  if (!result.success) {
    await supabaseAdmin
      .from('profiles')
      .update({
        cv_parsing_status: 'failed',
        cv_parsing_error: result.error.slice(0, 500),
      })
      .eq('id', profile.id)

    await supabaseAdmin.from('audit_logs').insert({
      user_id: user.id,
      domain_id: user.domain_id,
      action: 'cv_upload',
      entity_type: 'profile',
      entity_id: profile.id,
      detail: { status: 'failed', error: result.error, hash },
    })

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
    })
    .eq('id', profile.id)

  if (finalErr) {
    console.error('[upload-cv] final update failed', finalErr)
  }

  await supabaseAdmin.from('audit_logs').insert({
    user_id: user.id,
    domain_id: user.domain_id,
    action: 'cv_upload',
    entity_type: 'profile',
    entity_id: profile.id,
    detail: { status: 'done', hash, bytes: buffer.length },
  })

  return json({ jobId: profile.id, status: 'done', data: parsed })
}
