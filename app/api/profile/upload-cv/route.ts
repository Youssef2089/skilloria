import { capaciteActive } from '@/lib/interrupteurs'
import { NextRequest, after } from 'next/server'
import crypto from 'node:crypto'
import { AuthError, requireAuth } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'
import { parseCV } from '@/lib/cv-parser'
import { loadCvParsingQuota, windowEndsAt, QuotaConfigMissing } from '@/lib/ai-quotas'
import { budgetDisponible, enregistrerDepenseIA } from '@/lib/ai-budget'
import { signAvatarUrl } from '@/lib/avatar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// CV parsing IA (~30s) + matching IA via `after()` (~10-15s) cumulent dans
// le budget d'exécution. 60s = max Hobby ; Pro/Enterprise peuvent monter.
export const maxDuration = 60

const MAX_SIZE = 5 * 1024 * 1024
// Le quota d'analyses N'EST PLUS ÉCRIT ICI : il se lit en base
// (lib/ai-quotas). Il vivait en dur dans cette route ET dans cdi-upload-cv, et
// le relever supposait un déploiement — le relever à moitié ne signalait rien.

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

  // Convention unique, fail-closed (cf. lib/interrupteurs.ts).
  if (!capaciteActive('ENABLE_AI_CV_PARSING')) {
    return json({ error: 'AI parsing disabled', code: 'ai_disabled' }, 503)
  }

  // ── Garde type d'utilisateur (parité sécurité avec cdi-upload-cv) ────────
  //  Cette route est réservée aux freelances : un expert_cdi doit passer par
  //  /api/profile/cdi-upload-cv (parser + champs cdi_* dédiés).
  {
    const { data: userMeta, error: userMetaErr } = await ctx.supabaseAdmin
      .from('users')
      .select('user_type')
      .eq('id', ctx.user.id)
      .maybeSingle()
    // ⚠️ « INTERDIT » EST PIRE QU’« INTROUVABLE » : il désigne un DROIT, et la
    //    personne ne peut rien y faire. Une lecture de `users` en panne rendait
    //    403 à un expert que `requireAuth` vient d’authentifier — au moment où
    //    il dépose son CV. 503 sur la panne ; et l’absence réelle, quasi
    //    impossible ici, cesse de s’appeler « lookup failed » (§E.24) : c’est
    //    `user_missing`, comme dans requireAuth.
    if (userMetaErr) {
      console.error('[upload-cv] type de compte ILLISIBLE — dépôt refusé temporairement', {
        userId: ctx.user.id,
        message: userMetaErr.message,
      })
      return json(
        { error: 'Could not read the account', code: 'compte_verification_indisponible' },
        503,
      )
    }
    if (!userMeta) {
      return json({ error: 'User not found', code: 'user_missing' }, 404)
    }
    if (userMeta.user_type !== 'expert_freelance') {
      return json(
        { error: 'This route is reserved for freelance experts', code: 'wrong_user_type' },
        403,
      )
    }
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
      'id, cv_file_path, cv_hash, cv_parsing_status, cv_parsing_count_24h, cv_parsing_reset_at, ai_consent_at, title, summary, seniorities, years_experience, skills, certifications, branch_id, speciality_ids, languages, location, tjm_min, tjm_max, linkedin_url, phone, address_line, postal_code, city, country, birth_year, photo_url, years_total_experience, work_modes',
    )
    .eq('user_id', user.id)
    .maybeSingle()

  // La trace existait deja ; le MOTIF mentait quand meme : « profil introuvable »
  // sur une panne, au depot du CV (§E.42). 503 sur la panne, 404 sur l'absence.
  if (profileErr) {
    console.error('[upload-cv] profil ILLISIBLE — depot refuse temporairement', {
      userId: user.id,
      message: profileErr.message,
    })
    return json(
      { error: 'Could not read the profile', code: 'profil_verification_indisponible' },
      503,
    )
  }
  if (!profile) {
    console.error('[upload-cv] profile lookup failed', { userId: user.id })
    return json({ error: 'Profile not found', code: 'profile_missing' }, 404)
  }

  // ── Le quota, LU en base ──────────────────────────────────────────────────
  //  Aucun repli : ligne absente ⇒ on refuse et on le dit. Une valeur de
  //  secours en dur serait un second réglage prenant la main en silence.
  let quota
  try {
    quota = await loadCvParsingQuota(supabaseAdmin)
  } catch (err) {
    if (err instanceof QuotaConfigMissing) {
      console.error('[upload-cv]', err.message)
      return json({ error: 'Quota not configured', code: err.code }, 503)
    }
    throw err
  }

  const now = new Date()
  const resetAt = profile.cv_parsing_reset_at
    ? new Date(profile.cv_parsing_reset_at)
    : null
  const windowActive = resetAt !== null && resetAt > now
  const count24h = profile.cv_parsing_count_24h ?? 0

  if (windowActive && count24h >= quota.maxPerWindow) {
    return json(
      {
        // Le message REPREND les valeurs lues : il disait « 3 / 24h » en dur,
        // et serait resté faux le jour où le réglage change.
        error: `Rate limit: ${quota.maxPerWindow} parsings / ${quota.windowHours}h`,
        code: 'rate_limited',
        limit: quota.maxPerWindow,
        window_hours: quota.windowHours,
        reset_at: resetAt!.toISOString(),
      },
      429,
    )
  }

  if (profile.cv_hash === hash && profile.cv_parsing_status === 'done') {
    // ⚠️ UN CACHE QUI SERT DU VIDE AVEC UN TAMPON DE SUCCES.
    //
    //    Aucune des trois lectures ne récupérait son erreur (forme ①-bis : le
    //    motif objet du `Promise.all` ne porte même pas `error`). Une panne
    //    rendait donc les trois listes à `[]` — et la réponse annonçait
    //    `status: 'done', cached: true` avec un profil VIDE.
    //
    //    Ce n'est pas un affichage dégradé : c'est un FAIT FAUX QUI SE CROIT.
    //    L’expert vient de redéposer son CV et lit que l’analyse a réussi et
    //    n’a rien trouvé. Le formulaire qu’il ouvre ensuite est prérempli avec
    //    ce vide, et le prochain enregistrement l'ÉCRIT — §E.27 forme A, la
    //    panne cesse de mentir et devient la vérité.
    //
    //    On ne sert donc pas un cache qu’on n’a pas su lire : 503, et le
    //    prochain dépôt refera le travail. Rien n’est perdu, rien n’est écrit.
    const [expRes, eduRes, langRes] = await Promise.all([
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
    if (expRes.error || eduRes.error || langRes.error) {
      console.error('[upload-cv] cache ILLISIBLE — aucune réponse servie', {
        profileId: profile.id,
        experiences: expRes.error?.message ?? null,
        educations: eduRes.error?.message ?? null,
        langues: langRes.error?.message ?? null,
      })
      return json(
        { error: 'Could not read the cached analysis', code: 'cache_indisponible' },
        503,
      )
    }
    const cachedExp = expRes.data
    const cachedEdu = eduRes.data
    const cachedLang = langRes.data

    return json({
      jobId: profile.id,
      status: 'done',
      cached: true,
      data: {
        title: profile.title,
        summary: profile.summary,
        seniorities: profile.seniorities,
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
        // URL SIGNÉE, jamais la colonne brute : `photo_url` est un CHEMIN de
        // stockage depuis M3 (bucket `avatars` privé). Servie telle quelle, elle
        // donnait au client une valeur inutilisable dans un `<img src>` — une
        // image cassée en puissance, et la même classe de défaut que le logo
        // d'organisation (cf. lib/org-logo.ts). L'expert a le droit de voir sa
        // propre photo : on la lui signe.
        photo_url: await signAvatarUrl(supabaseAdmin, user.id),
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

  const nextResetAt = windowActive ? resetAt!.toISOString() : windowEndsAt(quota, now)
  const nextCount = windowActive ? count24h + 1 : 1
  // CONSENTEMENT IA (point D) — posé UNIQUEMENT parce que la case EXPLICITE a été
  // validée : la garde `consent === 'true'` en tête de route (sinon 400
  // consent_missing) est ce qui rend ce chemin atteignable. Ce n'est donc PAS une
  // pose automatique — sans coche, on n'arrive jamais ici. `?? now` = on horodate
  // au PREMIER consentement et on ne réécrit jamais la date d'origine ensuite.
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

  // ⚠️ SANS CE REFERENTIEL, L ANALYSE EST PAYEE PUIS RENDUE INCLASSABLE.
  //    Les trois lectures tombaient à `[]` sans récupérer leur erreur : le
  //    modèle recevait un catalogue VIDE, ne pouvait rattacher le CV à aucune
  //    branche ni spécialité, et le profil ressortait sans son axe — pendant
  //    qu'on payait l'appel et qu'on consommait le quota d'analyses.
  //    On refuse AVANT de dépenser, comme les trois chemins de vérification
  //    (§E.11) : on ne paie pas une décision qu'on ne saura pas rattacher.
  const [branchRes, specialityRes, configRes] = await Promise.all([
    supabaseAdmin.from('branches').select('slug').eq('domain_id', user.domain_id),
    supabaseAdmin.from('specialities').select('slug').eq('domain_id', user.domain_id),
    supabaseAdmin
      .from('domain_configs')
      .select('tags')
      .eq('domain_id', user.domain_id)
      .maybeSingle(),
  ])
  if (branchRes.error || specialityRes.error || configRes.error) {
    console.error('[upload-cv] référentiel du domaine ILLISIBLE — aucun appel au modèle', {
      domainId: user.domain_id,
      branches: branchRes.error?.message ?? null,
      specialites: specialityRes.error?.message ?? null,
      config: configRes.error?.message ?? null,
    })
    return json(
      { error: 'Reference data unavailable', code: 'referentiel_indisponible' },
      503,
    )
  }

  const domainCtx = {
    tags: (configRes.data?.tags as string[] | null) ?? [],
    branches: (branchRes.data ?? []).map((b: any) => b.slug as string),
    specialities: (specialityRes.data ?? []).map((s: any) => s.slug as string),
  }

  // ── LE PLAFOND EST CONSULTÉ AVANT D'APPELER ──────────────────────────────
  //  Un point qui enregistre mais ne regarde jamais le plafond dépense au-delà.
  //  FAIL-CLOSED assumé (lib/ai-budget.ts) : sur panne de lecture on REFUSE —
  //  ne pas savoir combien on a dépensé n'autorise pas à dépenser plus. C'est
  //  l'exception au fail-open du reste du projet, elle protège de l'argent.
  const budget = await budgetDisponible(supabaseAdmin, 'claude')
  if (!budget.ok) {
    console.error('[upload-cv] analyse refusée — budget', budget.raison)
    return json({ error: 'AI budget exhausted', code: 'ai_budget_exhausted', detail: budget.raison }, 503)
  }

  const result = await parseCV(buffer, domainCtx)
  // ── LA DÉPENSE EST ENREGISTRÉE, QU'ELLE AIT ABOUTI OU NON ────────────────
  //  Un appel qui échoue au parsing a QUAND MÊME consommé des jetons. Ne
  //  compter que les succès ferait dériver le plafond vers le bas, ce qui est
  //  la pire des deux erreurs : on croit avoir de la marge.
  //  N'interrompt jamais le parcours (lib/ai-budget.ts ne lève sur aucun chemin).
  if (result.usage) {
    await enregistrerDepenseIA(supabaseAdmin, {
      provider: 'claude',
      action: 'cv_parsing',
      // L'expert dépose SON CV : c'est lui qui déclenche la dépense.
      acteur: { type: 'profile', id: profile.id },
      consommation: result.usage,
      domain_id: user.domain_id,
      context: { user_id: user.id, aboutie: result.success },
    })
  }

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

    // Code explicite → le client affiche un message i18n générique (jamais le
    // texte technique brut). `error` conservé pour les logs/diagnostic.
    return json({ jobId: profile.id, status: 'failed', error: result.error, code: 'cv_parsing_failed' })
  }

  const parsed = result.data
  let branchId: string | null = null
  let specialityIds: string[] = []
  if (parsed.branch_slug) {
    const { data: br, error: brErr } = await supabaseAdmin
      .from('branches')
      .select('id')
      .eq('domain_id', user.domain_id)
      .eq('slug', parsed.branch_slug)
      .maybeSingle()
    // ⚠️ LE COMMENTAIRE VOISIN JUSTIFIE D’IGNORER UN SLUG **INVENTÉ** PAR LE
    //    MODÈLE. Une panne de LECTURE n’est pas un slug inventé : il est vrai
    //    d’un cas et faux de celui-ci (§E.29). Le profil ressort sans son axe
    //    pour une raison qui n’a rien à voir avec le CV.
    if (brErr) {
      console.error('[upload-cv] branche ILLISIBLE — profil rattaché à aucune branche', {
        slug: parsed.branch_slug,
        message: brErr.message,
      })
    }
    branchId = br?.id ?? null
  }
  // SPÉCIALITÉS multiples. On résout en LOT, et un slug que le modèle aurait
  // inventé est simplement ignoré : ici, contrairement à la route PATCH, il n'y
  // a pas d'utilisateur à qui rendre une erreur — c'est une extraction, pas une
  // saisie. Le profil reste modifiable à l'écran.
  if (parsed.speciality_slugs.length > 0) {
    const { data: sps, error: spsErr } = await supabaseAdmin
      .from('specialities')
      .select('id')
      .eq('domain_id', user.domain_id)
      .eq('active', true)
      .in('slug', parsed.speciality_slugs)
    if (spsErr) {
      console.error('[upload-cv] spécialités ILLISIBLES — profil rattaché à aucune spécialité', {
        slugs: parsed.speciality_slugs,
        message: spsErr.message,
      })
    }
    specialityIds = ((sps ?? []) as Array<{ id: string }>).map((x) => x.id)
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
      seniorities: coalesce(profile.seniorities as string[] | null, parsed.seniorities),
      years_experience: coalesce(profile.years_experience, parsed.years_experience),
      skills: coalesce(profile.skills as any, parsed.skills),
      certifications: coalesce(profile.certifications as any, parsed.certifications),
      branch_id: coalesce(profile.branch_id, branchId),
      speciality_ids: coalesce(profile.speciality_ids as string[] | null, specialityIds),
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

    // ⚠️ LA GARDE ET L’ACTION DOIVENT LIRE LA MÊME LISTE.
    //    La garde ci-dessus teste la liste BRUTE ; le `delete` qui suit
    //    agissait sur `normalised`, la liste FILTRÉE. Un modèle qui rend
    //    `[{ language: "  " }]` — une réponse non vide mais illisible, cause
    //    que ce dépôt nomme déjà `reponse_illisible` — passait la garde,
    //    déclenchait la suppression, et réinsérait ZÉRO ligne : toutes les
    //    langues saisies disparaissaient.
    //    §E.36 À L’INTÉRIEUR D’UNE FONCTION : il suffit de deux lectures.
    //    `PATCH /api/profile` portait déjà cette garde, et il était SEUL des
    //    trois écrivains à la porter — le trou qu’on croit fermé.
    if (normalised.length === 0) {
      console.error(`[upload-cv] langues illisibles — aucune suppression`, { profileId: profile.id })
    } else {
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

  // ── Matching réconcilié — déclencheur EXPERT (cv_parsing_status='done') ──
  // Non-bloquant POUR LE USER : exécution via `after()` (cf. profile PATCH).
  // Un simple `void promise` est tué par Vercel quand la response part — il
  // faut after() pour garantir l'exécution de bout en bout.
  after(async () => {
    try {
      const { data: postUpd, error: postUpdErr } = await supabaseAdmin
        .from('profiles')
        .select('verification_status, visible, ai_consent_at, cv_parsing_status')
        .eq('id', profile.id)
        .maybeSingle()
      // ⚠️ SANS CETTE LECTURE, LA MISE EN RELATION N'EST PAS REJOUÉE — et le
      //    silence était total. Les quatre `postUpd?.` retombent sur `null`,
      //    la condition est vraie, on `return`, et l'expert ne comprend pas
      //    pourquoi son flux reste vide après avoir redéposé son CV : c’est
      //    précisément le « faux défaut qu’on passe des heures à
      //    diagnostiquer » que ce fichier nomme déjà ailleurs.
      //    On ne relance PAS sur un état inconnu — la suite consomme ce qui a
      //    échoué (§E.41 ①) — et on journalise, pour que l’absence de flux ait
      //    une cause lisible.
      if (postUpdErr) {
        console.error('[upload-cv] état post-analyse ILLISIBLE — mise en relation NON rejouée', {
          profileId: profile.id,
          message: postUpdErr.message,
        })
        return
      }
      if (
        postUpd?.verification_status !== 'approved' ||
        postUpd?.visible !== true ||
        postUpd?.ai_consent_at == null ||
        postUpd?.cv_parsing_status !== 'done'
      ) return
      const { runMatchingForExpert } = await import('@/lib/matching')
      const v = await runMatchingForExpert({ supabaseAdmin, profileId: profile.id })
      console.log('[upload-cv] matching done', { profileId: profile.id, status: v.status, proposals: v.proposals.length })
    } catch (err) {
      console.error('[upload-cv] matching threw (after)', err)
    }
  })

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
