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
  // mission ET sous_traitance → pool d'experts FREELANCE (le besoin de
  // sous-traitance est du travail de type freelance, matché entre pairs).
  // offre → experts CDI.
  return type === 'offre' ? 'expert_cdi' : 'expert_freelance'
}

// Types d'annonce NATIFS par type d'expert. sous_traitance est un type
// freelance-natif (travail freelance entre pairs) — pas un croisé.
const FREELANCE_TYPES: readonly AnnonceType[] = ['mission', 'sous_traitance']
const CDI_TYPES: readonly AnnonceType[] = ['offre']

export function nativeTypesForUser(userType: 'expert_freelance' | 'expert_cdi'): AnnonceType[] {
  return userType === 'expert_cdi' ? [...CDI_TYPES] : [...FREELANCE_TYPES]
}

/** Types du pool d'un expert : natifs, + l'autre set si ouverture croisée. */
export function poolTypesForUser(
  userType: 'expert_freelance' | 'expert_cdi',
  crossOpen: boolean,
): AnnonceType[] {
  return crossOpen ? [...FREELANCE_TYPES, ...CDI_TYPES] : nativeTypesForUser(userType)
}

/** Une annonce est-elle « croisée » (hors du set natif de l'expert) ? */
export function isCrossType(pubType: AnnonceType, userType: 'expert_freelance' | 'expert_cdi'): boolean {
  return !nativeTypesForUser(userType).includes(pubType)
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
  // Sous-traitance : l'expert PUBLIANT ne doit pas se retrouver dans son propre
  // pool de candidats (auto-match). NULL pour une publication d'entreprise.
  excludeUserId?: string | null,
): Promise<ProfileCandidate[]> {
  const SELECT =
    'id, user_id, expert_type, title, summary, seniority, years_experience, ' +
    'years_total_experience, skills, languages, certifications, ' +
    'tjm_min, tjm_max, work_modes, mobility, ' +
    'availability_status, availability_date, ' +
    'cdi_status, cdi_notice_period, cdi_salary_min, cdi_salary_max, ' +
    'cdi_sectors, cdi_geo_mobility, cdi_contract_types, ' +
    'city, country, ' +
    'branches(name), specialities(name), ' +
    'users!profiles_user_id_fkey!inner(user_type, locale)'

  // Filtres d'éligibilité communs aux deux groupes (approved, visible, consent, cv, domain).
  const baseQuery = () => {
    let q = supabaseAdmin
      .from('profiles')
      .select(SELECT)
      .eq('domain_id', domainId)
      .eq('cv_parsing_status', 'done')
      .eq('visible', true)
      .not('ai_consent_at', 'is', null)
      .eq('verification_status', 'approved')
    // Exclusion de l'expert publiant (sous-traitance) : pas d'auto-match.
    if (excludeUserId) q = q.neq('user_id', excludeUserId)
    return q
  }

  // Garde de DISPONIBILITÉ propre au type de l'EXPERT (jamais celui de la publication).
  const withAvailabilityGuard = (
    q: ReturnType<typeof baseQuery>,
    userType: 'expert_freelance' | 'expert_cdi',
  ) =>
    userType === 'expert_freelance'
      ? q.or('availability_status.is.null,availability_status.neq.do_not_disturb')
      : q.or('cdi_status.is.null,cdi_status.neq.employed')

  // Groupe NATIF : experts du type attendu par la publication.
  const nativeQuery = withAvailabilityGuard(
    baseQuery().eq('users.user_type', expectedUserType),
    expectedUserType,
  ).limit(maxCandidates + 1)

  // Groupe CROISÉ (ouverture croisée opt-in) : experts de l'AUTRE type ayant coché
  // l'option, avec LEUR PROPRE garde de dispo. mission (attend freelance) → CDI ayant
  // open_to_freelance ; offre (attend cdi) → freelance ayant open_to_cdi.
  const otherUserType: 'expert_freelance' | 'expert_cdi' =
    expectedUserType === 'expert_freelance' ? 'expert_cdi' : 'expert_freelance'
  const optInFlag = expectedUserType === 'expert_freelance' ? 'open_to_freelance' : 'open_to_cdi'
  const crossQuery = withAvailabilityGuard(
    baseQuery().eq('users.user_type', otherUserType).eq(optInFlag, true),
    otherUserType,
  ).limit(maxCandidates + 1)

  const [nativeRes, crossRes] = await Promise.all([nativeQuery, crossQuery])
  if (nativeRes.error) console.error('[matching] profiles load failed (native)', nativeRes.error.message)
  if (crossRes.error) console.error('[matching] profiles load failed (cross)', crossRes.error.message)

  // Merge natif d'abord + croisé, dédoublonnage défensif par id (groupes disjoints
  // par user_type), plafonné à max_candidates.
  const seen = new Set<string>()
  const rows: ProfileRow[] = []
  for (const r of [
    ...((nativeRes.data ?? []) as unknown as ProfileRow[]),
    ...((crossRes.data ?? []) as unknown as ProfileRow[]),
  ]) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    rows.push(r)
  }
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
    // OUVERTURE CROISÉE : le candidat vient du groupe `crossQuery` (user_type
    // différent de celui attendu par l'annonce) — donc il a coché l'opt-in,
    // c'est la condition même de sa présence dans ce groupe.
    const u = pickRel(r.users) as { user_type: string } | null
    const crossTypeOptIn = !!u && u.user_type !== expectedUserType
    return {
      profile_id: r.id,
      expert_type: r.expert_type,
      cross_type_opt_in: crossTypeOptIn,
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
  /** Type de l'EXPERT matché — segment du deep-link dashboard (ouverture croisée). */
  user_type: 'expert_freelance' | 'expert_cdi'
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
    // Ouverture croisée : le segment suit le type de l'EXPERT (son dashboard),
    // pas le type de la publication (un CDI matché sur une mission reste sur /cdi).
    const dashboardSegment = s.user_type === 'expert_cdi' ? 'cdi' : 'freelance'
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
