import type { SupabaseClient } from '@supabase/supabase-js'
import { callProfileMatchingAi } from './ai-profile-matching'
import type {
  MatchingConfig,
  MatchingLocale,
  MatchingVerdict,
  ProfileCandidate,
  PublicationForMatching,
} from './types'
import type { AnnonceType } from '@/types/annonce'

/**
 * Orchestrateur de matching IA (Lot 2a).
 *
 * AUTONOME et IDEMPOTENT : un futur endpoint admin pourra appeler
 * `runMatching({supabaseAdmin, publicationId})` sans rework. Pas d'état caché,
 * pas de side effect en mémoire (Vercel stateless).
 *
 * SCOPE (frontière + actif + consentement) :
 *   - profiles.domain_id = publications.domain_id
 *   - users.user_type = 'expert_freelance' (mission) | 'expert_cdi' (offre)
 *   - profiles.cv_parsing_status = 'done'
 *   - profiles.visible = true
 *   - profiles.ai_consent_at IS NOT NULL
 *
 * PIPELINE :
 *   1. load config (verification_providers, provider_type='profile_matching')
 *   2. load publication (+ branch/speciality names)
 *   3. load eligible profiles (frontière) — joint users pour user_type
 *   4. appel IA → propositions {profile_id, score, reason}
 *   5. UPSERT matches (id du couple = UNIQUE publication_id+profile_id)
 *   6. créer notifications pour score >= notify_threshold (locale expert)
 *   7. UPDATE matches.status='notified' pour ceux notifiés
 *   8. retourne MatchingVerdict
 *
 * IDEMPOTENCE :
 *   - upsert sur (publication_id, profile_id) → pas de doublon
 *   - notifications : on cherche s'il existe déjà une notif pour le couple
 *     (user_id, type='new_match_opportunity', entity_id=publication_id)
 *     avant de re-créer
 *
 * FAIL-SAFE : tout retour `status='error'` est non-bloquant côté caller —
 * le caller (route publish) log mais continue (publi reste 'published').
 */

const PROVIDER_TYPE = 'profile_matching'
const NOTIFICATION_TYPE = 'new_match_opportunity'
const NOTIFICATION_CHANNEL = 'inapp'    // CHECK BDD : email | inapp | both
const NOTIFICATION_STATUS = 'pending'   // CHECK BDD : pending | sent | failed | read
                                        // V1 in-app : 'pending' (= en attente d'être vue par le user)

const VALID_LOCALES: readonly MatchingLocale[] = ['fr', 'en', 'es', 'de']

function normalizeLocale(raw: string | null | undefined): MatchingLocale {
  if (raw && (VALID_LOCALES as readonly string[]).includes(raw)) return raw as MatchingLocale
  return 'fr'
}

function userTypeForPublication(type: AnnonceType): 'expert_freelance' | 'expert_cdi' {
  return type === 'mission' ? 'expert_freelance' : 'expert_cdi'
}

// ─── 1. config ───────────────────────────────────────────────────────────────

type RawProviderConfig = {
  model?: unknown
  max_candidates?: unknown
  max_tokens?: unknown
}

async function loadConfig(supabaseAdmin: SupabaseClient): Promise<MatchingConfig | null> {
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

// ─── 2. load publication + branch/speciality names ──────────────────────────

type PublicationRow = {
  id: string
  domain_id: string
  type: string
  title: string
  description: string
  branch_id: string | null
  speciality_id: string | null
  skills_required: string[] | null
  seniority: string | null
  work_mode: string | null
  location: string | null
  duration: string | null
  budget_min: number | null
  budget_max: number | null
  status: string
  branches: { name: string } | { name: string }[] | null
  specialities: { name: string } | { name: string }[] | null
}

function pickRel<T>(value: T | T[] | null): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

async function loadPublication(
  supabaseAdmin: SupabaseClient,
  publicationId: string,
  locale: MatchingLocale,
): Promise<{ pub: PublicationForMatching; domain_id: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('publications')
    .select(
      'id, domain_id, type, title, description, branch_id, speciality_id, ' +
        'skills_required, seniority, work_mode, location, duration, ' +
        'budget_min, budget_max, status, ' +
        'branches(name), specialities(name)',
    )
    .eq('id', publicationId)
    .maybeSingle()
  if (error || !data) {
    console.error('[matching] publication load failed', error?.message ?? 'not found')
    return null
  }
  const row = data as unknown as PublicationRow
  const branch = pickRel(row.branches)
  const speciality = pickRel(row.specialities)
  const safeType: AnnonceType = row.type === 'mission' || row.type === 'offre' ? row.type : 'mission'
  return {
    pub: {
      id: row.id,
      type: safeType,
      title: row.title,
      description: row.description,
      branch_name: branch?.name ?? null,
      speciality_name: speciality?.name ?? null,
      skills_required: row.skills_required ?? [],
      seniority: row.seniority,
      work_mode: row.work_mode,
      location: row.location,
      duration: row.duration,
      budget_min: row.budget_min,
      budget_max: row.budget_max,
      locale,
    },
    domain_id: row.domain_id,
  }
}

// ─── 3. load eligible profiles ──────────────────────────────────────────────

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

async function loadEligibleProfiles(
  supabaseAdmin: SupabaseClient,
  domainId: string,
  expectedUserType: 'expert_freelance' | 'expert_cdi',
  maxCandidates: number,
): Promise<ProfileCandidate[]> {
  // Frontière D + E : domaine + actif + consentement.
  // user_type filtré via la jointure users (point C).
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
    .eq('verification_status', 'approved')   // Lot vérif expert : gate is_verified rebranché
    .eq('users.user_type', expectedUserType)

  // Lot disponibilité — BARRIÈRE SERVEUR non contournable.
  //   Freelance : exclure les 'do_not_disturb' (ne pas déranger). Les
  //               valeurs NULL sont CONSIDÉRÉES disponibles (défaut produit).
  //   CDI       : exclure les 'employed' (ne pas déranger). Les NULL sont
  //               considérés open_to_work (défaut produit).
  //
  // .or('CHAMP.is.null,CHAMP.neq.VALEUR') : équivalent SQL
  //   "WHERE availability_status IS NULL OR availability_status <> 'do_not_disturb'".
  //   Sans ce .or, un .neq('availability_status','do_not_disturb') seul
  //   exclurait également les NULL — non désiré.
  if (expectedUserType === 'expert_freelance') {
    query = query.or('availability_status.is.null,availability_status.neq.do_not_disturb')
  } else {
    query = query.or('cdi_status.is.null,cdi_status.neq.employed')
  }

  const { data, error } = await query.limit(maxCandidates + 1)  // +1 pour détecter dépassement
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

// ─── 4. UPSERT matches ──────────────────────────────────────────────────────

async function upsertMatches(args: {
  supabaseAdmin: SupabaseClient
  publicationId: string
  domainId: string
  proposals: { profile_id: string; score: number; reason: string; pitch_org?: string }[]
  model: string
}): Promise<{ ok: boolean }> {
  const { supabaseAdmin, publicationId, domainId, proposals, model } = args
  if (proposals.length === 0) return { ok: true }
  const nowIso = new Date().toISOString()
  const rows = proposals.map((p) => ({
    publication_id: publicationId,
    profile_id: p.profile_id,
    domain_id: domainId,
    score: p.score,
    // Lot finitions UX (Point 2) : on stocke aussi le pitch_org (orienté
    // chasse) à côté de reason (orienté candidat). pitch_org optionnel :
    // les matchs legacy (avant ce lot) n'ont que reason ; le DTO org tombe en
    // fallback sur reason si pitch_org est absent.
    explanation: { reason: p.reason, pitch_org: p.pitch_org ?? null, model, evaluated_at: nowIso },
    status: 'pending',
  }))
  const { error } = await supabaseAdmin
    .from('matches')
    .upsert(rows, { onConflict: 'publication_id,profile_id' })
  if (error) {
    console.error('[matching] upsert matches failed', error.message)
    return { ok: false }
  }
  return { ok: true }
}

// ─── 5. notifications ───────────────────────────────────────────────────────

type ProfileNotificationTarget = {
  profile_id: string
  user_id: string
  locale: string
}

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

async function createNotifications(args: {
  supabaseAdmin: SupabaseClient
  publication: PublicationForMatching
  domainId: string
  proposals: { profile_id: string; score: number; reason: string }[]
  notifyThreshold: number
  /** Map profile_id → { user_id, locale } pour résoudre la cible. */
  targets: Map<string, { user_id: string; locale: string }>
  /** Type d'annonce, pour résoudre l'URL de destination des notifs. */
  publicationType: AnnonceType
}): Promise<{ notifiedProfileIds: string[] }> {
  const { supabaseAdmin, publication, domainId, proposals, notifyThreshold, targets, publicationType } = args
  const dashboardSegment = publicationType === 'mission' ? 'freelance' : 'cdi'
  const linkUrl = `/dashboard/${dashboardSegment}/missions/${publication.id}`
  const eligible = proposals.filter((p) => p.score >= notifyThreshold)
  if (eligible.length === 0) return { notifiedProfileIds: [] }

  // Idempotence : on cherche les notifs existantes pour ce couple
  // (user_id, type, entity_id=publication.id) et on n'en re-crée pas.
  const userIds = eligible
    .map((p) => targets.get(p.profile_id)?.user_id)
    .filter((u): u is string => !!u)
  if (userIds.length === 0) return { notifiedProfileIds: [] }

  const { data: existing, error: existErr } = await supabaseAdmin
    .from('notifications')
    .select('user_id')
    .eq('type', NOTIFICATION_TYPE)
    .eq('entity_id', publication.id)
    .in('user_id', userIds)
  if (existErr) {
    console.error('[matching] notifications existing lookup failed', existErr.message)
    // On continue malgré tout — au pire on crée des doublons (acceptable
    // en best-effort, idempotence côté matches préservée).
  }
  const alreadyNotified = new Set((existing ?? []).map((r) => r.user_id as string))

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
  const notifiedProfileIds: string[] = []
  for (const prop of eligible) {
    const target = targets.get(prop.profile_id)
    if (!target) continue
    if (alreadyNotified.has(target.user_id)) {
      // Déjà notifié sur cette publi → on note quand même pour passer le
      // status matches → 'notified' (cohérence).
      notifiedProfileIds.push(prop.profile_id)
      continue
    }
    const loc = normalizeLocale(target.locale)
    rows.push({
      user_id: target.user_id,
      domain_id: domainId,
      type: NOTIFICATION_TYPE,
      channel: NOTIFICATION_CHANNEL,
      title: NOTIF_TITLE_KEYS[loc],
      body: NOTIF_BODY_KEYS[loc]({ title: publication.title }),
      link_url: linkUrl,
      status: NOTIFICATION_STATUS,
      entity_id: publication.id,
    })
    notifiedProfileIds.push(prop.profile_id)
  }

  if (rows.length > 0) {
    const { error: insertErr } = await supabaseAdmin.from('notifications').insert(rows)
    if (insertErr) {
      console.error('[matching] notifications insert failed', insertErr.message)
      // Best-effort : on log et continue.
    }
  }

  return { notifiedProfileIds }
}

async function flipMatchesToNotified(args: {
  supabaseAdmin: SupabaseClient
  publicationId: string
  notifiedProfileIds: string[]
}): Promise<void> {
  const { supabaseAdmin, publicationId, notifiedProfileIds } = args
  if (notifiedProfileIds.length === 0) return
  const { error } = await supabaseAdmin
    .from('matches')
    .update({ status: 'notified' })
    .eq('publication_id', publicationId)
    .in('profile_id', notifiedProfileIds)
    .eq('status', 'pending')   // n'écrase pas viewed/dismissed manuels
  if (error) {
    console.error('[matching] matches status flip failed', error.message)
  }
}

// ─── runMatching — orchestrateur principal ──────────────────────────────────

export async function runMatching(args: {
  supabaseAdmin: SupabaseClient
  publicationId: string
  /** Locale de la publication (pour générer explanation.reason). FR par défaut. */
  locale?: string
}): Promise<MatchingVerdict> {
  const { supabaseAdmin, publicationId } = args
  const locale = normalizeLocale(args.locale ?? 'fr')

  // 1. Config
  const config = await loadConfig(supabaseAdmin)
  if (!config) {
    return { status: 'no_config', proposals: [], notes: `Provider ${PROVIDER_TYPE} non configuré.`, model: null }
  }

  // 2. Publication
  const pubLoad = await loadPublication(supabaseAdmin, publicationId, locale)
  if (!pubLoad) {
    return { status: 'error', proposals: [], notes: 'Publication introuvable.', model: config.model }
  }
  const { pub, domain_id } = pubLoad

  // 3. Profiles éligibles (frontière D + E + user_type C)
  const expectedUserType = userTypeForPublication(pub.type)
  const candidates = await loadEligibleProfiles(supabaseAdmin, domain_id, expectedUserType, config.max_candidates)
  if (candidates.length === 0) {
    console.warn('[matching] empty pool', {
      publicationId,
      domain_id,
      expectedUserType,
    })
    return {
      status: 'empty_pool',
      proposals: [],
      notes: `Pool vide (domain=${domain_id}, user_type=${expectedUserType}).`,
      model: config.model,
    }
  }

  // 4. AI call
  const aiResult = await callProfileMatchingAi({ config, publication: pub, candidates })
  if (!aiResult.ok) {
    return { status: 'error', proposals: [], notes: aiResult.error, model: config.model }
  }
  const proposals = aiResult.proposals
  if (proposals.length === 0) {
    return { status: 'ok', proposals: [], notes: 'IA n\'a retenu aucun candidat pertinent.', model: aiResult.model }
  }

  // 5. UPSERT matches
  const upsertRes = await upsertMatches({
    supabaseAdmin,
    publicationId,
    domainId: domain_id,
    proposals,
    model: aiResult.model,
  })
  if (!upsertRes.ok) {
    return { status: 'error', proposals, notes: 'Upsert matches failed.', model: aiResult.model }
  }

  // 6. Build target map (profile_id → user_id, locale)
  const targets = new Map<string, { user_id: string; locale: string }>()
  // On a déjà les user_id dans la query loadEligibleProfiles via users(user_type, locale),
  // mais on les a perdus dans le mapping ProfileCandidate (qui exclut user_id, PII).
  // On les re-fetch en bornée — query small, indexed.
  const { data: pUsers, error: pUsersErr } = await supabaseAdmin
    .from('profiles')
    .select('id, user_id, users!profiles_user_id_fkey!inner(locale)')
    .in('id', proposals.map((p) => p.profile_id))
  if (pUsersErr) {
    console.error('[matching] target users lookup failed', pUsersErr.message)
  } else {
    for (const row of (pUsers ?? []) as Array<{ id: string; user_id: string; users: { locale: string } | { locale: string }[] }>) {
      const u = pickRel(row.users)
      if (u) targets.set(row.id, { user_id: row.user_id, locale: u.locale })
    }
  }

  // 7. Notifications + flip status
  const { notifiedProfileIds } = await createNotifications({
    supabaseAdmin,
    publication: pub,
    domainId: domain_id,
    proposals,
    notifyThreshold: config.notify_threshold,
    targets,
    publicationType: pub.type,
  })
  await flipMatchesToNotified({ supabaseAdmin, publicationId, notifiedProfileIds })

  return {
    status: 'ok',
    proposals,
    notes: `Matched ${proposals.length} candidat(s), notifié ${notifiedProfileIds.length}.`,
    model: aiResult.model,
  }
}

export type { MatchingVerdict, MatchingLocale } from './types'
