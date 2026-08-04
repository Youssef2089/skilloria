import { NextRequest, after } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Vercel function timeout : la vérification expert (Lot vérif expert) appelle
// Claude inline avec web_search natif, qui peut prendre 20-30s. On lève
// maxDuration au max compatible Hobby (60s) ; Pro/Enterprise peuvent monter
// plus haut sans risque (cf. https://vercel.com/docs/functions/runtimes#max-duration).
export const maxDuration = 60

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
  speciality_other: string | null
  languages: string[] | null
  location: string | null
  work_modes: Array<'remote' | 'onsite' | 'hybrid'>
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
  // ── CDI-specific (acceptés UNIQUEMENT si users.user_type === 'expert_cdi') ──
  cdi_status: 'employed' | 'open_to_work' | null
  cdi_notice_period: 'immediate' | '1_month' | '2_months' | '3_months' | 'negotiable' | null
  cdi_availability_date: string | null
  cdi_confidential_mode: boolean | null
  cdi_salary_min: number | null
  cdi_salary_max: number | null
  cdi_variable_pct: number | null
  cdi_benefits: string[] | null
  cdi_company_size: string[] | null
  cdi_sectors: string[] | null
  cdi_geo_mobility: 'local' | 'regional' | 'national' | 'international' | null
  cdi_contract_types: Array<'cdi' | 'cdd' | 'alternance'> | null
  cdi_motivations: string | null
  cdi_career_goals: string | null
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

  // ── Branchement user_type pour valider/whitelister selon le rôle ──
  // (Lecture isolée : ne touche pas requireAuth() pour rester chirurgical.)
  const { data: userMetaRow } = await supabaseAdmin
    .from('users')
    .select('user_type')
    .eq('id', user.id)
    .maybeSingle()
  const userType = (userMetaRow?.user_type as string | null) ?? null
  const isCdi = userType === 'expert_cdi'

  // currentProfile : on étend le select avec les colonnes nécessaires à la
  // validation CDI uniquement si isCdi (pas de surcoût pour le freelance).
  const baseSelect = 'id, title, summary, skills, branch_id, speciality_id, work_modes, verification_status, cv_parsing_status, ai_consent_at'
  const cdiSelectExtra =
    ', cdi_status, cdi_salary_min, cdi_salary_max, cdi_notice_period'
  const profileSelect = isCdi ? baseSelect + cdiSelectExtra : baseSelect

  const { data: currentProfile, error: fetchErr } = await supabaseAdmin
    .from('profiles')
    .select(profileSelect)
    .eq('user_id', user.id)
    .maybeSingle()
  if (fetchErr || !currentProfile) {
    return json({ error: 'Profile not found', code: 'profile_missing' }, 404)
  }
  // Cast nécessaire car `profileSelect` est une chaîne dynamique
  // (supabase-js ne peut typer le retour qu'avec un littéral statique).
  const cp = currentProfile as unknown as Record<string, any> & { id: string }

  const patch: Record<string, unknown> = {}
  const directFields: Array<keyof PatchBody> = [
    'title', 'summary', 'seniority', 'years_experience',
    'skills', 'certifications',
    'languages', 'location', 'work_modes', 'tjm_min', 'tjm_max',
    'availability_date', 'linkedin_url', 'visible',
    'phone', 'address_line', 'postal_code', 'city', 'country',
    'birth_year', 'photo_url', 'years_total_experience', 'availability_status',
  ]
  for (const k of directFields) {
    if (k in body) patch[k] = body[k] as unknown
  }

  // ── Whitelist additionnelle pour les expert_cdi : 14 colonnes cdi_* ──
  // Si l'utilisateur n'est PAS expert_cdi, ces champs sont ignorés
  // silencieusement (backward-compatible : aucune régression freelance).
  if (isCdi) {
    const cdiFields: Array<keyof PatchBody> = [
      'cdi_status',
      'cdi_notice_period',
      'cdi_availability_date',
      'cdi_confidential_mode',
      'cdi_salary_min',
      'cdi_salary_max',
      'cdi_variable_pct',
      'cdi_benefits',
      'cdi_company_size',
      'cdi_sectors',
      'cdi_geo_mobility',
      'cdi_contract_types',
      'cdi_motivations',
      'cdi_career_goals',
    ]
    for (const k of cdiFields) {
      if (k in body) patch[k] = body[k] as unknown
    }
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
  // D6 : précision libre « Autre » (bornée). Renseignée quand speciality_id est
  // nul, effacée sinon — le formulaire envoie null quand une spécialité listée
  // est choisie. On ne l'accepte que comme string bornée à 100 caractères.
  if ('speciality_other' in body) {
    const raw = typeof body.speciality_other === 'string' ? body.speciality_other.trim() : ''
    if (raw.length > 100) {
      return json({ error: 'speciality_other too long', code: 'bad_speciality_other' }, 400)
    }
    patch.speciality_other = raw.length > 0 ? raw : null
  }

  // Validation pour publication
  // ─────────────────────────────────────────────────────────────────────
  // Branchement strict : freelance vs CDI.
  // - Freelance (default) : règles INCHANGÉES (backward-compat)
  // - CDI : règles spécifiques (cdi_status, cdi_salary_*, cdi_notice_period,
  //   summary>=20, ET pas de validation work_modes — informatif seulement)
  // ─────────────────────────────────────────────────────────────────────
  if (body.visible === true) {
    const cur = cp

    // ── Barrière CV obligatoire (Lot CV) — SÉCURITÉ SERVEUR ────────────────
    //  Règle métier non contournable : impossible de publier sans un CV
    //  déposé ET parsé, et sans avoir accepté la vérification IA. Mêmes
    //  critères que ceux exigés en interne par runExpertVerification et par
    //  le déclencheur de matching (cf. after() plus bas).
    //  S'applique aux DEUX flows (freelance + CDI) — la condition est commune.
    const cvReady =
      (cur as { cv_parsing_status?: string | null }).cv_parsing_status === 'done' &&
      (cur as { ai_consent_at?: string | null }).ai_consent_at != null
    if (!cvReady) {
      return json({ error: 'CV not ready for publication', code: 'cv_not_ready' }, 400)
    }

    const missing: string[] = []

    // experiences >= 1 (body ou BDD) — commun
    let experiencesCount: number
    if ('experiences' in body) {
      experiencesCount = Array.isArray(body.experiences)
        ? body.experiences.filter(e => e.role?.trim()).length
        : 0
    } else {
      const { count } = await supabaseAdmin
        .from('profile_experiences')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', cur.id)
      experiencesCount = count ?? 0
    }

    // languages_structured >= 1 (body ou BDD) — commun
    let languagesCount: number
    if ('languages_structured' in body) {
      languagesCount = Array.isArray(body.languages_structured)
        ? body.languages_structured.filter(l => l.language?.trim()).length
        : 0
    } else {
      const { count } = await supabaseAdmin
        .from('profile_languages')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', cur.id)
      languagesCount = count ?? 0
    }

    if (isCdi) {
      // ── Règles CDI : 8 critères (parité freelance — Fix C Lot CDI publish) ──
      //  Décision cahier : cdi_salary_min/max + cdi_notice_period ne sont
      //  PAS lus par runExpertVerification (qui vérifie l'expertise, pas la
      //  compensation). Freelance ne bloque pas non plus sur tjm_min/max.
      //  → On retire ces 3 champs des bloquants Publish ; ils restent
      //  optionnels (recommandés pour la qualité du matching), via l'encart
      //  conseil côté UI. cdi_status reste requis (signal écoute marché).
      const merged = {
        title: (patch.title ?? cur.title) as string | null,
        summary: (patch.summary ?? cur.summary) as string | null,
        skills: (patch.skills ?? cur.skills) as string[] | null,
        branch_id: (patch.branch_id ?? cur.branch_id) as string | null,
        speciality_id: (patch.speciality_id ?? cur.speciality_id) as string | null,
        cdi_status: (patch.cdi_status ?? cur.cdi_status) as string | null,
      }
      if (!merged.title) missing.push('title')
      if (!merged.summary || merged.summary.trim().length < 20) missing.push('summary')
      if (!merged.skills || merged.skills.length < 3) missing.push('skills')
      if (!merged.branch_id) missing.push('branch_id')
      if (!merged.speciality_id) missing.push('speciality_id')
      if (!merged.cdi_status) missing.push('cdi_status')
      if (experiencesCount < 1) missing.push('experiences')
      if (languagesCount < 1) missing.push('languages_structured')
    } else {
      // ── Règles freelance : INCHANGÉES (backward-compat) ──────────────
      const merged = {
        title: (patch.title ?? cur.title) as string | null,
        summary: (patch.summary ?? cur.summary) as string | null,
        skills: (patch.skills ?? cur.skills) as string[] | null,
        branch_id: (patch.branch_id ?? cur.branch_id) as string | null,
        speciality_id: (patch.speciality_id ?? cur.speciality_id) as string | null,
        work_modes: (patch.work_modes ?? cur.work_modes) as string[] | null,
      }
      if (!merged.title) missing.push('title')
      if (!merged.summary) missing.push('summary')
      if (!merged.skills || merged.skills.length < 3) missing.push('skills')
      if (!merged.branch_id) missing.push('branch_id')
      if (!merged.speciality_id) missing.push('speciality_id')
      if (!Array.isArray(merged.work_modes) || merged.work_modes.length === 0)
        missing.push('work_modes')
      if (experiencesCount < 1) missing.push('experiences')
      if (languagesCount < 1) missing.push('languages_structured')
    }

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
      .eq('id', cp.id)
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
      .eq('profile_id', cp.id)
    if (delErr) {
      console.error('[profile PATCH] experiences delete failed', delErr)
    } else if (list.length > 0) {
      const rows = list
        .filter(e => e.role?.trim())
        .map((e, i) => ({
          profile_id: cp.id,
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
      .eq('profile_id', cp.id)
    if (delErr) {
      console.error('[profile PATCH] educations delete failed', delErr)
    } else if (list.length > 0) {
      const rows = list
        .filter(e => e.school?.trim() && e.degree?.trim())
        .map(e => ({
          profile_id: cp.id,
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
      .eq('profile_id', cp.id)
    if (delErr) {
      console.error('[profile PATCH] languages delete failed', delErr)
    } else if (normalised.length > 0) {
      const rows = normalised.map(l => ({
        profile_id: cp.id,
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

    // ── Vérification expert (Lot vérif expert / Lot CV) ───────────────────
    //  Déclencheur : TOUTE (re)publication (visible=true) relance la vérif IA,
    //  quel que soit verification_status actuel. Le moteur est idempotent : il
    //  réécrit la décision. Conséquence voulue : un profil déjà 'approved',
    //  republié après modif, repasse par la vérif et peut redevenir
    //  'pending_admin_review' si une incohérence apparaît.
    //  Inline : web_search rend l'appel lent (30-60s) ; l'UI affiche un loading
    //  pendant ce temps. Cf. lib/verification/expert-verification.ts.
    try {
      const { runExpertVerification } = await import('@/lib/verification/expert-verification')
      await runExpertVerification({ supabaseAdmin, profile_id: cp.id })
    } catch (err) {
      console.error('[profile PATCH] expert verification threw', err)
      // Fail-safe : marquer pending_admin_review explicitement si rien n'a été écrit
      await supabaseAdmin
        .from('profiles')
        .update({
          verification_status: 'pending_admin_review',
          verification_method: 'manual_only',
          verification_data: { notes: 'Erreur technique pendant la vérif IA — décision déférée à l\'admin.' },
        })
        .eq('id', cp.id)
    }
  }

  await logAudit({
    supabaseAdmin,
    user_id: user.id,
    domain_id: user.domain_id,
    action: 'profile_update',
    entity_type: 'profile',
    entity_id: cp.id,
    detail: { keys: Object.keys(patch), blocks: touchedBlocks },
  })

  // ── Matching réconcilié — déclencheur EXPERT (post-PATCH profile) ────────
  // Non-bloquant POUR LE USER : on retourne la response immédiatement, et le
  // matching IA (~10-15s) tourne via `after()` après l'envoi de la response
  // mais AVANT que le runtime serverless ne soit suspendu. Sans `after()`, un
  // simple `void promise` serait tué par Vercel quand la response part
  // (bug constaté sur Achwek : trigger jamais exécuté en prod).
  //
  // On relit verification_status post-update (l'auto-approve inline ci-dessus
  // a pu basculer le statut). Coût IA : 1 appel batché par enregistrement.
  after(async () => {
    try {
      const { data: postUpd } = await supabaseAdmin
        .from('profiles')
        .select('verification_status, visible, ai_consent_at, cv_parsing_status')
        .eq('id', cp.id)
        .maybeSingle()
      const status = postUpd?.verification_status ?? null

      if (status !== 'approved') {
        // ── DÉMOTION ───────────────────────────────────────────────────────
        // Re-publication non approuvée (pending_admin_review / rejected /
        // pending) : les missions recommandées suivent STRICTEMENT le statut.
        //  → on retire les recommandations (préserve dismissed + candidaturés)
        //    ET on remet users.is_verified=false (badge "vérifié" + gating home).
        // L'expert n'est plus matchable tant qu'il n'est pas ré-approuvé.
        const { clearExpertRecommendations } = await import('@/lib/matching')
        const cleared = await clearExpertRecommendations({ supabaseAdmin, profileId: cp.id })
        const { error: vErr } = await supabaseAdmin
          .from('users')
          .update({ is_verified: false })
          .eq('id', user.id)
        if (vErr) console.error('[profile:PATCH] is_verified=false failed', vErr.message)
        console.log('[profile:PATCH] demotion cleanup', {
          profileId: cp.id,
          status,
          matches_removed: cleared.deleted,
        })
        return
      }

      // ── APPROUVÉ : (re)matching réconcilié ────────────────────────────────
      // reconcile efface d'abord les matches obsolètes puis insère les frais
      // (sans doublon — contrainte UNIQUE — ni re-spam de notif). Garde les
      // mêmes pré-conditions de "vraiment live" (visible + consent + CV parsé).
      const ready =
        postUpd?.visible === true &&
        postUpd?.ai_consent_at != null &&
        postUpd?.cv_parsing_status === 'done'
      if (!ready) return
      const { runMatchingForExpert } = await import('@/lib/matching')
      const v = await runMatchingForExpert({ supabaseAdmin, profileId: cp.id })
      console.log('[profile:PATCH] matching done', {
        profileId: cp.id,
        status: v.status,
        proposals: v.proposals.length,
      })
    } catch (err) {
      console.error('[profile:PATCH] matching threw (after)', err)
    }
  })

  return json({ profile: updatedProfile })
}
