import type { SupabaseClient } from '@supabase/supabase-js'
import type { MatchingConfig, MatchingLocale, ProfileCandidate } from './types'
import type { AnnonceType } from '@/types/annonce'

/**
 * Helpers partagés entre les deux orchestrateurs `runMatchingForPublication`
 * (lib/matching/index.ts) et `runMatchingForExpert` (lib/matching/run-for-expert.ts).
 *
 * Extraction faite pour éviter un cycle d'import circulaire entre les deux
 * fichiers — un seul cœur de matching, deux directions.
 */

const PROVIDER_TYPE = 'profile_matching'
export const NOTIFICATION_TYPE = 'new_match_opportunity'
const NOTIFICATION_CHANNEL = 'inapp'
const NOTIFICATION_STATUS = 'pending'

const VALID_LOCALES: readonly MatchingLocale[] = ['fr', 'en', 'es', 'de']

export function normalizeMatchingLocale(raw: string | null | undefined): MatchingLocale {
  if (raw && (VALID_LOCALES as readonly string[]).includes(raw)) return raw as MatchingLocale
  return 'fr'
}

export function userTypeForPublication(type: AnnonceType): 'expert_freelance' | 'expert_cdi' {
  return type === 'mission' ? 'expert_freelance' : 'expert_cdi'
}

export function publicationTypeForUserType(userType: 'expert_freelance' | 'expert_cdi'): AnnonceType {
  return userType === 'expert_freelance' ? 'mission' : 'offre'
}

export function pickRel<T>(value: T | T[] | null): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

// ─── config ───────────────────────────────────────────────────────────────

type RawProviderConfig = {
  model?: unknown
  max_candidates?: unknown
  max_tokens?: unknown
}

export async function loadMatchingConfig(supabaseAdmin: SupabaseClient): Promise<MatchingConfig | null> {
  const { data, error } = await supabaseAdmin
    .from('verification_providers')
    .select('confidence_threshold, is_active, config')
    .eq('provider_type', PROVIDER_TYPE)
    .eq('is_active', true)
    .order('priority', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[matching] config load failed', error.message)
    return null
  }
  if (!data) return null
  const row = data as unknown as { confidence_threshold: number; is_active: boolean; config: RawProviderConfig | null }
  const cfg = (row.config ?? {}) as RawProviderConfig
  const model = typeof cfg.model === 'string' && cfg.model.length > 0 ? cfg.model : null
  const max_candidates = typeof cfg.max_candidates === 'number' && cfg.max_candidates > 0 ? Math.min(cfg.max_candidates, 500) : null
  const max_tokens = typeof cfg.max_tokens === 'number' && cfg.max_tokens > 0 ? Math.min(cfg.max_tokens, 8000) : null
  const notify_threshold = typeof row.confidence_threshold === 'number' ? Math.max(0, Math.min(10, row.confidence_threshold)) : null
  if (!model || !max_candidates || !max_tokens || notify_threshold == null) {
    console.error('[matching] config incomplete', { hasModel: !!model, max_candidates, max_tokens, notify_threshold })
    return null
  }
  return { model, max_candidates, max_tokens, notify_threshold }
}

// ─── loadEligibleProfiles (pool experts pour 1 publi) ────────────────────────

type ProfileRow = {
  id: string
  user_id: string
  expert_type: string | null
  title: string | null
  summary: string | null
  seniority: string | null
  years_experience: number | null
  years_total_experience: number | null
  skills: string[] | null
  languages: string[] | null
  certifications: unknown
  tjm_min: number | null
  tjm_max: number | null
  work_modes: string[] | null
  mobility: string | null
  availability_status: string | null
  availability_date: string | null
  cdi_status: string | null
  cdi_notice_period: string | null
  cdi_salary_min: number | null
  cdi_salary_max: number | null
  cdi_sectors: string[] | null
  cdi_geo_mobility: string | null
  cdi_contract_types: string[] | null
  city: string | null
  country: string | null
  branches: { name: string } | { name: string }[] | null
  specialities: { name: string } | { name: string }[] | null
  users: { user_type: string; locale: string } | { user_type: string; locale: string }[] | null
}

export async function loadEligibleProfiles(
  supabaseAdmin: SupabaseClient,
  domainId: string,
  expectedUserType: 'expert_freelance' | 'expert_cdi',
  maxCandidates: number,
): Promise<ProfileCandidate[]> {
  let query = supabaseAdmin
    .from('profiles')
    .select(
      'id, user_id, expert_type, title, summary, seniority, years_experience, ' +
        'years_total_experience, skills, languages, certifications, ' +
        'tjm_min, tjm_max, work_modes, mobility, ' +
        'availability_status, availability_date, ' +
        'cdi_status, cdi_notice_period, cdi_salary_min, cdi_salary_max, ' +
        'cdi_sectors, cdi_geo_mobility, cdi_contract_types, ' +
        'city, country, ' +
        'branches(name), specialities(name), ' +
        'users!profiles_user_id_fkey!inner(user_type, locale)',
    )
    .eq('domain_id', domainId)
    .eq('cv_parsing_status', 'done')
    .eq('visible', true)
    .not('ai_consent_at', 'is', null)
    .eq('verification_status', 'approved')
    .eq('users.user_type', expectedUserType)

  if (expectedUserType === 'expert_freelance') {
    query = query.or('availability_status.is.null,availability_status.neq.do_not_disturb')
  } else {
    query = query.or('cdi_status.is.null,cdi_status.neq.employed')
  }

  const { data, error } = await query.limit(maxCandidates + 1)
  if (error) {
    console.error('[matching] profiles load failed', error.message)
    return []
  }
  const rows = (data ?? []) as unknown as ProfileRow[]
  if (rows.length > maxCandidates) {
    console.warn('[matching] pool exceeds max_candidates — truncated', {
      domainId,
      max: maxCandidates,
      total: rows.length,
    })
  }
  return rows.slice(0, maxCandidates).map<ProfileCandidate>((r) => {
    const branch = pickRel(r.branches)
    const speciality = pickRel(r.specialities)
    const certs = Array.isArray(r.certifications) ? r.certifications.length : 0
    return {
      profile_id: r.id,
      expert_type: r.expert_type,
      title: r.title,
      summary: r.summary,
      seniority: r.seniority,
      years_experience: r.years_experience,
      years_total_experience: r.years_total_experience,
      branch_name: branch?.name ?? null,
      speciality_name: speciality?.name ?? null,
      skills: r.skills ?? [],
      languages: r.languages ?? [],
      certifications_count: certs,
      tjm_min: r.tjm_min,
      tjm_max: r.tjm_max,
      work_modes: r.work_modes ?? [],
      mobility: r.mobility,
      availability_status: r.availability_status,
      availability_date: r.availability_date,
      cdi_status: r.cdi_status,
      cdi_notice_period: r.cdi_notice_period,
      cdi_salary_min: r.cdi_salary_min,
      cdi_salary_max: r.cdi_salary_max,
      cdi_sectors: r.cdi_sectors,
      cdi_geo_mobility: r.cdi_geo_mobility,
      cdi_contract_types: r.cdi_contract_types,
      city: r.city,
      country: r.country,
    }
  })
}

// ─── notifications + flip status pending→notified ───────────────────────────

const NOTIF_TITLE_KEYS: Record<MatchingLocale, string> = {
  fr: 'Une opportunité correspond à votre profil',
  en: 'A new opportunity matches your profile',
  es: 'Una nueva oportunidad coincide con tu perfil',
  de: 'Eine neue Gelegenheit passt zu Ihrem Profil',
}

const NOTIF_BODY_KEYS: Record<MatchingLocale, (params: { title: string }) => string> = {
  fr: ({ title }) => `Skilloria a identifié une annonce qui pourrait vous correspondre : « ${title} ».`,
  en: ({ title }) => `Skilloria identified a listing that may match you: "${title}".`,
  es: ({ title }) => `Skilloria identificó un anuncio que podría coincidir contigo: «${title}».`,
  de: ({ title }) => `Skilloria hat eine Anzeige identifiziert, die zu Ihnen passen könnte: „${title}".`,
}

export type NotifySpec = {
  user_id: string
  profile_id: string
  publication_id: string
  publication_title: string
  publication_type: AnnonceType
  domain_id: string
  locale: string
}

export async function notifyAndFlip(args: {
  supabaseAdmin: SupabaseClient
  specs: NotifySpec[]
}): Promise<void> {
  const { supabaseAdmin, specs } = args
  if (specs.length === 0) return

  const userIds = Array.from(new Set(specs.map((s) => s.user_id)))
  const pubIds = Array.from(new Set(specs.map((s) => s.publication_id)))
  const { data: existing, error: existErr } = await supabaseAdmin
    .from('notifications')
    .select('user_id, entity_id')
    .eq('type', NOTIFICATION_TYPE)
    .in('user_id', userIds)
    .in('entity_id', pubIds)
  if (existErr) {
    console.error('[matching] notif existing lookup failed', existErr.message)
  }
  const alreadyKey = new Set(
    (existing ?? []).map((r) => `${r.user_id as string}:::${r.entity_id as string}`),
  )

  const rows: Array<{
    user_id: string
    domain_id: string
    type: string
    channel: string
    title: string
    body: string
    link_url: string | null
    status: string
    entity_id: string
  }> = []
  const flips: { profile_id: string; publication_id: string }[] = []

  for (const s of specs) {
    const key = `${s.user_id}:::${s.publication_id}`
    flips.push({ profile_id: s.profile_id, publication_id: s.publication_id })
    if (alreadyKey.has(key)) continue
    const loc = normalizeMatchingLocale(s.locale)
    const dashboardSegment = s.publication_type === 'mission' ? 'freelance' : 'cdi'
    rows.push({
      user_id: s.user_id,
      domain_id: s.domain_id,
      type: NOTIFICATION_TYPE,
      channel: NOTIFICATION_CHANNEL,
      title: NOTIF_TITLE_KEYS[loc],
      body: NOTIF_BODY_KEYS[loc]({ title: s.publication_title }),
      link_url: `/dashboard/${dashboardSegment}/missions/${s.publication_id}`,
      status: NOTIFICATION_STATUS,
      entity_id: s.publication_id,
    })
  }

  if (rows.length > 0) {
    const { error: insErr } = await supabaseAdmin.from('notifications').insert(rows)
    if (insErr) console.error('[matching] notif insert failed', insErr.message)
  }

  for (const f of flips) {
    const { error: flipErr } = await supabaseAdmin
      .from('matches')
      .update({ status: 'notified' })
      .eq('profile_id', f.profile_id)
      .eq('publication_id', f.publication_id)
      .eq('status', 'pending')
    if (flipErr) {
      console.error('[matching] flip notified failed', flipErr.message)
    }
  }
}
