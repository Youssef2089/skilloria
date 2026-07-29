import { NextRequest, after } from 'next/server'
import crypto from 'node:crypto'
import { AuthError, requireAuth } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'
import { parseCdiCV } from '@/lib/cv-parser-cdi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// CV parsing IA + matching IA via `after()` cumulent dans le budget d'exécution.
export const maxDuration = 60

// =============================================================================
// API : POST /api/profile/cdi-upload-cv
// =============================================================================
// Upload d'un CV PDF par un candidat CDI. Pipeline équivalent au freelance
// (/api/profile/upload-cv) mais avec :
//   - Vérification stricte que users.user_type === 'expert_cdi' → 403 sinon
//   - Parser CDI dédié (lib/cv-parser-cdi.ts) qui extrait les champs cdi_*
//     au lieu de tjm_min / tjm_max
//   - COALESCE étendu aux 14 colonnes cdi_* pour ne pas écraser la saisie
//     manuelle préalable
//
// TODO post-merge V1+V3 : factoriser ce qui peut l'être avec /upload-cv
// (auth check, hashing, rate-limit, storage upload, audit logs).
// =============================================================================

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
    console.error('[cdi-upload-cv] auth error', err)
    return json({ error: 'Auth failed', code: 'auth_error' }, 500)
  }

  if (process.env.ENABLE_AI_CV_PARSING !== 'true') {
    return json({ error: 'AI parsing disabled', code: 'ai_disabled' }, 503)
  }

  const { supabaseAdmin, user } = ctx

  // ───────────────────────────────────────────────────────────────────────
  // 1. Garde "expert_cdi" stricte
  // ───────────────────────────────────────────────────────────────────────
  const { data: userMeta, error: userMetaErr } = await supabaseAdmin
    .from('users')
    .select('user_type')
    .eq('id', user.id)
    .maybeSingle()

  if (userMetaErr || !userMeta) {
    return json({ error: 'User not found', code: 'user_lookup_failed' }, 403)
  }
  if (userMeta.user_type !== 'expert_cdi') {
    return json(
      { error: 'This route is reserved for CDI candidates', code: 'wrong_user_type' },
      403,
    )
  }

  // ───────────────────────────────────────────────────────────────────────
  // 2. Validation file
  // ───────────────────────────────────────────────────────────────────────
  let formData: FormData
  try {
    formData = await request.formData()
  } catch (err) {
    console.error('[cdi-upload-cv] formData parse failed', err)
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

  // ───────────────────────────────────────────────────────────────────────
  // 3. Lookup profile + rate-limit (3/24h)
  // ───────────────────────────────────────────────────────────────────────
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select(
      [
        'id',
        'cv_file_path',
        'cv_hash',
        'cv_parsing_status',
        'cv_parsing_count_24h',
        'cv_parsing_reset_at',
        'ai_consent_at',
        'title',
        'summary',
        'seniority',
        'years_experience',
        'skills',
        'certifications',
        'branch_id',
        'speciality_id',
        'languages',
        'location',
        'linkedin_url',
        'phone',
        'address_line',
        'postal_code',
        'city',
        'country',
        'birth_year',
        'photo_url',
        'years_total_experience',
        'work_modes',
        'cdi_status',
        'cdi_notice_period',
        'cdi_salary_min',
        'cdi_salary_max',
        'cdi_variable_pct',
        'cdi_career_goals',
        'cdi_motivations',
      ].join(', '),
    )
    .eq('user_id', user.id)
    .maybeSingle()

  if (profileErr || !profile) {
    console.error('[cdi-upload-cv] profile lookup failed', {
      userId: user.id,
      err: profileErr?.message,
    })
    return json({ error: 'Profile not found', code: 'profile_missing' }, 404)
  }

  const prof = profile as any

  const now = new Date()
  const resetAt = prof.cv_parsing_reset_at ? new Date(prof.cv_parsing_reset_at) : null
  const windowActive = resetAt !== null && resetAt > now
  const count24h = prof.cv_parsing_count_24h ?? 0

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

  // ───────────────────────────────────────────────────────────────────────
  // 4. Cache hit (même hash + status='done')
  // ───────────────────────────────────────────────────────────────────────
  if (prof.cv_hash === hash && prof.cv_parsing_status === 'done') {
    const [{ data: cachedExp }, { data: cachedEdu }, { data: cachedLang }] =
      await Promise.all([
        supabaseAdmin
          .from('profile_experiences')
          .select('*')
          .eq('profile_id', prof.id)
          .order('sort_order', { ascending: true }),
        supabaseAdmin
          .from('profile_educations')
          .select('*')
          .eq('profile_id', prof.id)
          .order('end_year', { ascending: false, nullsFirst: true }),
        supabaseAdmin.from('profile_languages').select('*').eq('profile_id', prof.id),
      ])

    return json({
      jobId: prof.id,
      status: 'done',
      cached: true,
      data: {
        title: prof.title,
        summary: prof.summary,
        seniority: prof.seniority,
        years_experience: prof.years_experience,
        skills: prof.skills,
        certifications: prof.certifications,
        languages: prof.languages,
        location: prof.location,
        cdi_status: prof.cdi_status,
        cdi_notice_period: prof.cdi_notice_period,
        cdi_salary_min: prof.cdi_salary_min,
        cdi_salary_max: prof.cdi_salary_max,
        cdi_variable_pct: prof.cdi_variable_pct,
        cdi_career_goals: prof.cdi_career_goals,
        cdi_motivations: prof.cdi_motivations,
        linkedin_url: prof.linkedin_url,
        phone: prof.phone,
        address_line: prof.address_line,
        postal_code: prof.postal_code,
        city: prof.city,
        country: prof.country,
        birth_year: prof.birth_year,
        photo_url: prof.photo_url,
        years_total_experience: prof.years_total_experience,
        work_modes: prof.work_modes ?? [],
        experiences: cachedExp ?? [],
        educations: cachedEdu ?? [],
        languages_structured: cachedLang ?? [],
      },
    })
  }

  // ───────────────────────────────────────────────────────────────────────
  // 5. Storage upload
  // ───────────────────────────────────────────────────────────────────────
  const storagePath = `${user.id}/${hash}.pdf`
  const { error: storageErr } = await supabaseAdmin.storage
    .from('cv')
    .upload(storagePath, buffer, {
      contentType: 'application/pdf',
      upsert: true,
    })
  if (storageErr) {
    console.error('[cdi-upload-cv] storage upload failed', {
      userId: user.id,
      msg: storageErr.message,
    })
    return json({ error: 'Upload failed', code: 'storage_error' }, 500)
  }

  const nextResetAt = windowActive
    ? resetAt!.toISOString()
    : new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  const nextCount = windowActive ? count24h + 1 : 1
  // CONSENTEMENT IA (point D) — posé UNIQUEMENT parce que la case EXPLICITE a été
  // validée : la garde `consent === 'true'` en tête de route (sinon 400
  // consent_missing) rend ce chemin atteignable. Pas de pose automatique — sans
  // coche, on n'arrive jamais ici. `?? now` = horodatage au PREMIER consentement.
  const consentAt = prof.ai_consent_at ?? now.toISOString()

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
    .eq('id', prof.id)

  if (updateErr) {
    console.error('[cdi-upload-cv] status=processing update failed', updateErr)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  // ───────────────────────────────────────────────────────────────────────
  // 6. Domain context + parser CDI
  // ───────────────────────────────────────────────────────────────────────
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

  const result = await parseCdiCV(buffer, domainCtx)

  if (!result.success) {
    await supabaseAdmin
      .from('profiles')
      .update({
        cv_parsing_status: 'failed',
        cv_parsing_error: result.error.slice(0, 500),
      })
      .eq('id', prof.id)

    await logAudit({
      supabaseAdmin,
      user_id: user.id,
      domain_id: user.domain_id,
      action: 'cv_upload',
      entity_type: 'profile',
      entity_id: prof.id,
      detail: { status: 'failed', error: result.error, hash, variant: 'cdi' },
    })

    return json({ jobId: prof.id, status: 'failed', error: result.error })
  }

  const parsed = result.data

  // ───────────────────────────────────────────────────────────────────────
  // 7. Resolve branch_id / speciality_id depuis slugs
  // ───────────────────────────────────────────────────────────────────────
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

  // ───────────────────────────────────────────────────────────────────────
  // 8. COALESCE update — ne JAMAIS écraser la saisie manuelle existante
  // ───────────────────────────────────────────────────────────────────────
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
      title: coalesce(prof.title, parsed.title),
      summary: coalesce(prof.summary, parsed.summary),
      seniority: coalesce(prof.seniority, parsed.seniority),
      years_experience: coalesce(prof.years_experience, parsed.years_experience),
      skills: coalesce(prof.skills as any, parsed.skills),
      certifications: coalesce(prof.certifications as any, parsed.certifications),
      branch_id: coalesce(prof.branch_id, branchId),
      speciality_id: coalesce(prof.speciality_id, specialityId),
      languages: coalesce(prof.languages as any, parsed.languages),
      location: coalesce(prof.location, parsed.location),
      linkedin_url: coalesce(prof.linkedin_url, parsed.linkedin_url),
      phone: coalesce(prof.phone, parsed.phone),
      address_line: coalesce(prof.address_line, parsed.address_line),
      postal_code: coalesce(prof.postal_code, parsed.postal_code),
      city: coalesce(prof.city, parsed.city),
      country: coalesce(prof.country, parsed.country),
      birth_year: coalesce(prof.birth_year, parsed.birth_year),
      photo_url: coalesce(prof.photo_url, parsed.photo_url),
      years_total_experience: coalesce(
        prof.years_total_experience,
        parsed.years_total_experience,
      ),
      work_modes: coalesce(prof.work_modes as any, parsed.work_modes),
      // CDI-specific
      cdi_status: coalesce(prof.cdi_status, parsed.cdi_status),
      cdi_notice_period: coalesce(prof.cdi_notice_period, parsed.cdi_notice_period),
      cdi_salary_min: coalesce(prof.cdi_salary_min, parsed.cdi_salary_min),
      cdi_salary_max: coalesce(prof.cdi_salary_max, parsed.cdi_salary_max),
      cdi_variable_pct: coalesce(prof.cdi_variable_pct, parsed.cdi_variable_pct),
      cdi_career_goals: coalesce(prof.cdi_career_goals, parsed.cdi_career_goals),
      cdi_motivations: coalesce(prof.cdi_motivations, parsed.cdi_motivations),
    })
    .eq('id', prof.id)

  if (finalErr) {
    console.error('[cdi-upload-cv] final update failed', finalErr)
  }

  // ───────────────────────────────────────────────────────────────────────
  // 9. Sub-tables : DELETE+INSERT si parsé non-vide
  // ───────────────────────────────────────────────────────────────────────
  if (Array.isArray(parsed.experiences) && parsed.experiences.length > 0) {
    const { error: delErr } = await supabaseAdmin
      .from('profile_experiences')
      .delete()
      .eq('profile_id', prof.id)
    if (delErr) {
      console.error('[cdi-upload-cv] experiences delete failed', delErr)
    } else {
      const rows = parsed.experiences.map((e, i) => ({
        profile_id: prof.id,
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
      if (insErr) console.error('[cdi-upload-cv] experiences insert failed', insErr)
    }
  }

  if (Array.isArray(parsed.educations) && parsed.educations.length > 0) {
    const { error: delErr } = await supabaseAdmin
      .from('profile_educations')
      .delete()
      .eq('profile_id', prof.id)
    if (delErr) {
      console.error('[cdi-upload-cv] educations delete failed', delErr)
    } else {
      const rows = parsed.educations.map(e => ({
        profile_id: prof.id,
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
      if (insErr) console.error('[cdi-upload-cv] educations insert failed', insErr)
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
      .eq('profile_id', prof.id)
    if (delErr) {
      console.error('[cdi-upload-cv] languages delete failed', delErr)
    } else {
      const rows = normalised.map(l => ({
        profile_id: prof.id,
        language: l.language.trim(),
        level: l.level,
        is_primary: l.is_primary,
      }))
      const { error: insErr } = await supabaseAdmin
        .from('profile_languages')
        .insert(rows)
      if (insErr) console.error('[cdi-upload-cv] languages insert failed', insErr)
    }
  }

  await logAudit({
    supabaseAdmin,
    user_id: user.id,
    domain_id: user.domain_id,
    action: 'cv_upload',
    entity_type: 'profile',
    entity_id: prof.id,
    detail: {
      status: 'done',
      hash,
      bytes: buffer.length,
      variant: 'cdi',
      blocks: {
        experiences: parsed.experiences?.length ?? 0,
        educations: parsed.educations?.length ?? 0,
        languages_structured: parsed.languages_structured?.length ?? 0,
      },
    },
  })

  // ── Matching réconcilié — déclencheur EXPERT CDI (cv_parsing_status='done') ──
  // Non-bloquant POUR LE USER : exécution via `after()`. Cf. variante freelance
  // upload-cv pour la justification du switch fire-and-forget → after().
  after(async () => {
    try {
      const { data: postUpd } = await supabaseAdmin
        .from('profiles')
        .select('verification_status, visible, ai_consent_at, cv_parsing_status')
        .eq('id', prof.id)
        .maybeSingle()
      if (
        postUpd?.verification_status !== 'approved' ||
        postUpd?.visible !== true ||
        postUpd?.ai_consent_at == null ||
        postUpd?.cv_parsing_status !== 'done'
      ) return
      const { runMatchingForExpert } = await import('@/lib/matching')
      const v = await runMatchingForExpert({ supabaseAdmin, profileId: prof.id })
      console.log('[cdi-upload-cv] matching done', { profileId: prof.id, status: v.status, proposals: v.proposals.length })
    } catch (err) {
      console.error('[cdi-upload-cv] matching threw (after)', err)
    }
  })

  return json({
    jobId: prof.id,
    status: 'done',
    data: {
      ...parsed,
      experiences: parsed.experiences ?? [],
      educations: parsed.educations ?? [],
      languages_structured: parsed.languages_structured ?? [],
    },
  })
}
