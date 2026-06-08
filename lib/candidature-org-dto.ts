import type { AuthContext } from '@/lib/auth-guard'
import { tBDD, type TranslationsMap } from '@/lib/translations'
import { maskExpertNameForOrg, type ExpertAccountState } from '@/lib/expert-name-masking'
import { disclosurePolicyForCandidatureStatus } from '@/lib/expert-disclosure'

/**
 * lib/candidature-org-dto.ts — helper partagé qui construit les DTOs
 * "candidatures vues côté ORG" pour un set de publications données.
 *
 * Extrait de app/api/publications/[id]/candidatures/route.ts (SC6 Lot UX
 * Finitions 2) pour permettre la réutilisation strict-identique côté
 * /api/me/candidatures-org (vue globale org) — la masquage et l'unlock
 * doivent rester rigoureusement identiques entre les deux vues, sinon
 * un chemin pourrait fuir là où l'autre ne fuit pas.
 *
 * Invariants critiques préservés :
 *  1) AUCUNE jointure systématique sur `profiles` : on ne projette le profil
 *     complet QUE pour candidatures.status === 'unlocked'.
 *  2) `preview` provient de candidatures.preview (snapshot whitelist posé par
 *     Lot 2b à l'INSERT). On ne lit JAMAIS profiles directement pour les
 *     candidatures non-unlocked.
 *  3) Defense-in-depth : on ré-applique l'invariant `status === 'unlocked'`
 *     dans le code, en plus de la RLS et du service_role.
 *  4) Le caller (route HTTP) DOIT avoir vérifié l'ownership des publications
 *     (publication.organization_id == auth.organization.id) AVANT d'appeler
 *     cette fonction. Cette fonction ne re-vérifie pas l'ownership — elle
 *     suppose que `publicationIds` est déjà un sous-ensemble appartenant à l'org.
 */

export type OrgCandidatureDTO = {
  id: string
  publication_id: string
  profile_id: string
  match_id: string | null
  status: string
  status_reason: string | null
  unlocked_at: string | null
  cover_message: string | null
  ai_match_score: number | null
  created_at: string
  conversation_id: string | null
  ai_pitch: string | null
  unlocked_profile: Record<string, unknown> | null
  preview: {
    title: unknown
    summary: unknown
    skills: unknown[]
    seniority: unknown
    expert_type: unknown
    years_experience: unknown
    years_total_experience: unknown
    tjm_min: unknown
    tjm_max: unknown
    salary_min: unknown
    salary_max: unknown
    work_modes: unknown[]
    languages: unknown[]
    country: unknown
    city: unknown
    availability_status: unknown
    availability_date: unknown
    profile_score: unknown
    branch_label: string | null
    speciality_label: string | null
    /** Lot synthèse candidat CDI — 6 signaux non-PII. */
    cdi_status: string | null
    cdi_notice_period: string | null
    cdi_geo_mobility: string | null
    cdi_contract_types: string[]
    cdi_company_size: string[]
    cdi_sectors: string[]
  }
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
  // Lot grille photo-forward : photo_url RE-INTRODUIT au SELECT, mais
  // n'est projeté dans le DTO QUE si DisclosurePolicy.reveal_photo === true
  // (cf. disclosurePolicyForCandidatureStatus → unlocked/selected uniquement).
  // address_line/postal_code/birth_year/cv_url/linkedin_url/email/phone
  // restent strippés à jamais — reveal_contact: false en V1.
  photo_url: string | null
  availability_status: string | null
  availability_date: string | null
  profile_score: number | null
  branch_id: string | null
  speciality_id: string | null
  users:
    | { id: string; first_name: string | null; last_name: string | null }
    | { id: string; first_name: string | null; last_name: string | null }[]
}

export async function buildOrgCandidatureDTOs(
  auth: AuthContext,
  publicationIds: string[],
  translations: TranslationsMap,
): Promise<OrgCandidatureDTO[]> {
  if (publicationIds.length === 0) return []

  const { data: rowsRaw, error } = await auth.supabaseAdmin
    .from('candidatures')
    .select(
      'id, publication_id, profile_id, match_id, cover_message, ai_match_score, ' +
        'status, status_reason, unlocked_at, preview, created_at, updated_at',
    )
    .in('publication_id', publicationIds)
    .order('ai_match_score', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(2000)

  if (error) {
    console.error('[buildOrgCandidatureDTOs] query failed', error.message)
    throw new Error('db_error')
  }

  const rows = (rowsRaw ?? []) as unknown as CandidatureRow[]
  if (rows.length === 0) return []

  // Pitch IA orienté org via matches.explanation.pitch_org.
  const matchIds = Array.from(new Set(rows.map((r) => r.match_id).filter((id): id is string => !!id)))
  const pitchByMatch = new Map<string, string>()
  if (matchIds.length > 0) {
    const { data: matchRows } = await auth.supabaseAdmin
      .from('matches')
      .select('id, explanation')
      .in('id', matchIds)
    for (const m of (matchRows ?? []) as { id: string; explanation: { pitch_org?: string | null; reason?: string | null } | null }[]) {
      const pitch = m.explanation?.pitch_org?.trim() || m.explanation?.reason?.trim() || ''
      if (pitch) pitchByMatch.set(m.id, pitch)
    }
  }

  // Conversation_id pour les candidatures unlocked OU selected.
  //  Lot 'selected' : une fois le candidat retenu, la conversation reste
  //  active pour caler les détails (date, contrat...). L'org doit toujours
  //  pouvoir y accéder.
  const accessibleStatuses = new Set(['unlocked', 'selected'])
  const accessibleCandIds = rows.filter((r) => accessibleStatuses.has(r.status)).map((r) => r.id)
  const convIdByCand = new Map<string, string>()
  if (accessibleCandIds.length > 0) {
    const { data: convs } = await auth.supabaseAdmin
      .from('conversations')
      .select('id, candidature_id')
      .in('candidature_id', accessibleCandIds)
    for (const c of (convs ?? []) as { id: string; candidature_id: string }[]) {
      convIdByCand.set(c.candidature_id, c.id)
    }
  }

  // Lot bascule badges par item : viewed_by_me par candidature pour l'user
  // ORG courant. Sémantique "fresh" = candidature_views.viewed_at >=
  // candidatures.updated_at (un nouveau message ou changement de statut
  // bump updated_at → la candidature redevient "non consultée").
  const allCandIds = rows.map((r) => r.id)
  const viewedAtByCand = new Map<string, string>()
  if (allCandIds.length > 0) {
    const { data: viewsRaw } = await auth.supabaseAdmin
      .from('candidature_views')
      .select('candidature_id, viewed_at')
      .eq('user_id', auth.user.id)
      .in('candidature_id', allCandIds)
    for (const v of (viewsRaw ?? []) as { candidature_id: string; viewed_at: string }[]) {
      viewedAtByCand.set(v.candidature_id, v.viewed_at)
    }
  }

  // Profil complet pour candidatures unlocked OU selected (idem : l'accès
  // au profil débloqué est conservé une fois le candidat retenu).
  const unlockedProfileIds = new Set(
    rows.filter((r) => accessibleStatuses.has(r.status)).map((r) => r.profile_id),
  )
  const fullProfileById = new Map<string, FullProfile>()
  if (unlockedProfileIds.size > 0) {
    // Lot grille photo-forward :
    //   - photo_url RÉINTRODUIT au SELECT (projeté dans le DTO seulement si
    //     la policy l'autorise, cf. disclosurePolicyForCandidatureStatus).
    //   - first_name + last_name chargés pour le nom complet post-unlock
    //     ET pour le fallback pseudonyme si on en a besoin ailleurs.
    //   - address_line, postal_code, birth_year, cv_url, linkedin_url, email,
    //     phone : strippés à jamais (reveal_contact: false en V1, jamais
    //     branché tant que le packaging commerce n'aura pas été conçu).
    const { data: profRows } = await auth.supabaseAdmin
      .from('profiles')
      .select(
        'id, user_id, title, summary, skills, seniority, expert_type, ' +
          'years_experience, years_total_experience, tjm_min, tjm_max, salary_min, salary_max, ' +
          'work_modes, languages, country, city, photo_url, ' +
          'availability_status, availability_date, profile_score, ' +
          'branch_id, speciality_id, ' +
          'users!profiles_user_id_fkey!inner(id, first_name, last_name, deletion_scheduled_at, anonymized_at)',
      )
      .in('id', Array.from(unlockedProfileIds))
    for (const p of (profRows ?? []) as unknown as FullProfile[]) {
      fullProfileById.set(p.id, p)
    }
  }

  // Branches/specialities batch (pour labels traduits).
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

  return rows.map((row) => {
    const preview = row.preview ?? {}
    const branchId = typeof preview.branch_id === 'string' ? preview.branch_id : null
    const specialityId = typeof preview.speciality_id === 'string' ? preview.speciality_id : null

    let unlockedProfile: Record<string, unknown> | null = null
    if (accessibleStatuses.has(row.status)) {
      const fp = fullProfileById.get(row.profile_id)
      if (fp) {
        const u = Array.isArray(fp.users) ? fp.users[0] : fp.users
        // Lot grille photo-forward : politique de divulgation appliquée
        // CÔTÉ SERVEUR (sécurité non contournable). Status 'unlocked' ou
        // 'selected' → reveal_photo + reveal_full_name à true ; contact
        // (email/phone) hors périmètre V1 (reveal_contact: false toujours).
        const policy = disclosurePolicyForCandidatureStatus(row.status)
        const firstName = u?.first_name ?? null
        const lastName = u?.last_name ?? null
        // Mission S3 : si l'expert est en grâce/purge, le placeholder prime sur
        // la policy de divulgation (jamais le vrai nom d'un compte en suppression).
        const accountState = (u ?? undefined) as ExpertAccountState | undefined
        const inDeletion = !!(accountState?.deletion_scheduled_at || accountState?.anonymized_at)
        const displayName = inDeletion
          ? maskExpertNameForOrg(firstName, lastName, accountState)
          : policy.reveal_full_name
            ? [firstName, lastName].filter(Boolean).join(' ').trim() ||
              maskExpertNameForOrg(firstName, lastName)
            : maskExpertNameForOrg(firstName, lastName)

        unlockedProfile = {
          display_name: displayName,
          photo_url: policy.reveal_photo ? (fp.photo_url ?? null) : null,
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
          availability_status: fp.availability_status,
          availability_date: fp.availability_date,
          profile_score: fp.profile_score,
        }
      }
    }

    const v = viewedAtByCand.get(row.id)
    const viewedByMe = !!v && new Date(v).getTime() >= new Date(row.updated_at).getTime()
    return {
      id: row.id,
      publication_id: row.publication_id,
      profile_id: row.profile_id,
      match_id: row.match_id,
      status: row.status,
      status_reason: row.status_reason,
      unlocked_at: row.unlocked_at,
      cover_message: row.cover_message,
      ai_match_score: row.ai_match_score,
      created_at: row.created_at,
      conversation_id: accessibleStatuses.has(row.status) ? convIdByCand.get(row.id) ?? null : null,
      ai_pitch: row.match_id ? pitchByMatch.get(row.match_id) ?? null : null,
      unlocked_profile: unlockedProfile,
      viewed_by_me: viewedByMe,
      preview: {
        title: preview.title ?? null,
        summary: preview.summary ?? null,
        skills: Array.isArray(preview.skills) ? preview.skills : [],
        seniority: preview.seniority ?? null,
        expert_type: preview.expert_type ?? null,
        years_experience: preview.years_experience ?? null,
        years_total_experience: preview.years_total_experience ?? null,
        tjm_min: preview.tjm_min ?? null,
        tjm_max: preview.tjm_max ?? null,
        salary_min: preview.salary_min ?? null,
        salary_max: preview.salary_max ?? null,
        work_modes: Array.isArray(preview.work_modes) ? preview.work_modes : [],
        languages: Array.isArray(preview.languages) ? preview.languages : [],
        country: preview.country ?? null,
        city: preview.city ?? null,
        availability_status: preview.availability_status ?? null,
        availability_date: preview.availability_date ?? null,
        profile_score: preview.profile_score ?? null,
        branch_label: branchId
          ? tBDD(translations, 'branches', branchId, 'name', branchNameById.get(branchId) ?? '')
          : null,
        speciality_label: specialityId
          ? tBDD(translations, 'specialities', specialityId, 'name', specNameById.get(specialityId) ?? '')
          : null,
        // Lot synthèse candidat CDI — 6 signaux non-PII (null/[] pour
        // candidatures legacy avant le lot tant que pas backfillées).
        cdi_status: typeof preview.cdi_status === 'string' ? preview.cdi_status : null,
        cdi_notice_period: typeof preview.cdi_notice_period === 'string' ? preview.cdi_notice_period : null,
        cdi_geo_mobility: typeof preview.cdi_geo_mobility === 'string' ? preview.cdi_geo_mobility : null,
        cdi_contract_types: Array.isArray(preview.cdi_contract_types) ? (preview.cdi_contract_types as string[]) : [],
        cdi_company_size: Array.isArray(preview.cdi_company_size) ? (preview.cdi_company_size as string[]) : [],
        cdi_sectors: Array.isArray(preview.cdi_sectors) ? (preview.cdi_sectors as string[]) : [],
      },
    }
  })
}
