import type { SupabaseClient } from '@supabase/supabase-js'
import { callExpertMatchingAi } from './ai-expert-matching'
import { reconcileMatches, type ReconcileDesired } from './reconcile'
import type {
  MatchingLocale,
  MatchingVerdict,
  ProfileCandidate,
  PublicationForMatching,
} from './types'
import type { AnnonceType } from '@/types/annonce'
import {
  loadMatchingConfig,
  normalizeMatchingLocale,
  notifyAndFlip,
  pickRel as pickRelShared,
  publicationTypeForUserType,
  type NotifySpec,
} from './shared'

/**
 * Orchestrateur côté EXPERT — direction EXPERT → publications.
 *
 * Symétrique de `runMatchingForPublication` (cf. lib/matching/index.ts) mais
 * scopé à UN profil. À déclencher sur les événements de l'expert qui changent
 * son éligibilité ou ses critères de matching :
 *
 *   - Approbation (verification_status='approved') : inline ou par admin.
 *   - Modification de profil (PATCH /api/profile) si déjà approuvé+actif.
 *   - cv_parsing_status passe à 'done'.
 *   - Sortie du DND : availability 'do_not_disturb'→'available' /
 *     cdi_status 'employed'→'open_to_work'.
 *
 * Pipeline IDENTIQUE à publi → experts, MAIS dans l'autre sens :
 *   1. Charge config (mêmes verification_providers / 'profile_matching').
 *   2. Charge le profil expert + check éligibilité (no-op si frontière non
 *      remplie — l'expert sortira juste du pool, ses matches obsolètes seront
 *      nettoyés par les futures réconciliations côté annonces).
 *   3. Charge le pool de publications éligibles (publi.status='published',
 *      même domaine, type compatible avec users.user_type).
 *   4. Appel IA inverse (callExpertMatchingAi) — résumés sans PII.
 *   5. reconcileMatches({ scope: { byProfileId } }) — préserve status,
 *      ne supprime jamais une candidature engagée ni un dismissed.
 *   6. Notifie inserts frais (score >= seuil), idempotent.
 *
 * FAIL-SAFE : tous les retours d'erreur sont non-bloquants côté caller.
 */

type ProfileFullRow = {
  id: string
  user_id: string
  domain_id: string
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
  verification_status: string | null
  visible: boolean | null
  ai_consent_at: string | null
  cv_parsing_status: string | null
  branches: { name: string } | { name: string }[] | null
  specialities: { name: string } | { name: string }[] | null
  users: { user_type: string | null; locale: string | null } | { user_type: string | null; locale: string | null }[] | null
}

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

const pickRel = pickRelShared

function isExpertEligible(p: ProfileFullRow): boolean {
  if (p.verification_status !== 'approved') return false
  if (p.visible !== true) return false
  if (!p.ai_consent_at) return false
  if (p.cv_parsing_status !== 'done') return false
  if (!p.domain_id) return false
  const u = pickRel(p.users)
  if (!u || !u.user_type) return false
  // DND check : freelance bloque sur 'do_not_disturb' ; CDI sur 'employed'.
  if (u.user_type === 'expert_freelance' && p.availability_status === 'do_not_disturb') return false
  if (u.user_type === 'expert_cdi' && p.cdi_status === 'employed') return false
  return true
}

function profileToCandidate(p: ProfileFullRow): ProfileCandidate {
  const branch = pickRel(p.branches)
  const speciality = pickRel(p.specialities)
  const certs = Array.isArray(p.certifications) ? p.certifications.length : 0
  return {
    profile_id: p.id,
    expert_type: p.expert_type,
    title: p.title,
    summary: p.summary,
    seniority: p.seniority,
    years_experience: p.years_experience,
    years_total_experience: p.years_total_experience,
    branch_name: branch?.name ?? null,
    speciality_name: speciality?.name ?? null,
    skills: p.skills ?? [],
    languages: p.languages ?? [],
    certifications_count: certs,
    tjm_min: p.tjm_min,
    tjm_max: p.tjm_max,
    work_modes: p.work_modes ?? [],
    mobility: p.mobility,
    availability_status: p.availability_status,
    availability_date: p.availability_date,
    cdi_status: p.cdi_status,
    cdi_notice_period: p.cdi_notice_period,
    cdi_salary_min: p.cdi_salary_min,
    cdi_salary_max: p.cdi_salary_max,
    cdi_sectors: p.cdi_sectors,
    cdi_geo_mobility: p.cdi_geo_mobility,
    cdi_contract_types: p.cdi_contract_types,
    city: p.city,
    country: p.country,
  }
}

function pubToForMatching(row: PublicationRow, locale: MatchingLocale): PublicationForMatching {
  const branch = pickRel(row.branches)
  const speciality = pickRel(row.specialities)
  const safeType: AnnonceType = row.type === 'mission' || row.type === 'offre' ? row.type : 'mission'
  return {
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
  }
}

export async function runMatchingForExpert(args: {
  supabaseAdmin: SupabaseClient
  profileId: string
  /** Locale de l'expert (pour explanation.reason / notifs). Fallback users.locale. */
  locale?: string
}): Promise<MatchingVerdict> {
  const { supabaseAdmin, profileId } = args

  // 1. Config
  const config = await loadMatchingConfig(supabaseAdmin)
  if (!config) {
    return { status: 'no_config', proposals: [], notes: 'Provider profile_matching non configuré.', model: null }
  }

  // 2. Profil + check éligibilité
  const { data: profileData, error: pErr } = await supabaseAdmin
    .from('profiles')
    .select(
      'id, user_id, domain_id, expert_type, title, summary, seniority, ' +
        'years_experience, years_total_experience, skills, languages, certifications, ' +
        'tjm_min, tjm_max, work_modes, mobility, availability_status, availability_date, ' +
        'cdi_status, cdi_notice_period, cdi_salary_min, cdi_salary_max, ' +
        'cdi_sectors, cdi_geo_mobility, cdi_contract_types, city, country, ' +
        'verification_status, visible, ai_consent_at, cv_parsing_status, ' +
        'branches(name), specialities(name), ' +
        'users!profiles_user_id_fkey!inner(user_type, locale)',
    )
    .eq('id', profileId)
    .maybeSingle()

  if (pErr) {
    console.error('[matching-expert] profile lookup failed', pErr.message)
    return { status: 'error', proposals: [], notes: `Profile lookup: ${pErr.message}`, model: config.model }
  }
  const profile = profileData as unknown as ProfileFullRow | null
  if (!profile) {
    return { status: 'error', proposals: [], notes: 'Profile introuvable.', model: config.model }
  }

  if (!isExpertEligible(profile)) {
    // No-op silencieux : l'expert sort du pool (DND, non-approuvé, etc.).
    // On NE supprime PAS ses matches existants — ils seront soit notés
    // 'dismissed' par l'expert lui-même, soit nettoyés à la prochaine
    // réconciliation côté annonce.
    return {
      status: 'empty_pool',
      proposals: [],
      notes: `Expert ${profileId} hors scope (verif/visible/consent/cv/dnd).`,
      model: config.model,
    }
  }

  const u = pickRel(profile.users) as { user_type: string | null; locale: string | null } | null
  const userType = u?.user_type === 'expert_cdi' ? 'expert_cdi' : 'expert_freelance'
  const localeRaw = args.locale ?? u?.locale ?? 'fr'
  const locale = normalizeMatchingLocale(localeRaw)
  const targetPubType = publicationTypeForUserType(userType)

  // 3. Pool de publications éligibles (domain + type + published)
  const { data: pubData, error: pubErr } = await supabaseAdmin
    .from('publications')
    .select(
      'id, domain_id, type, title, description, branch_id, speciality_id, ' +
        'skills_required, seniority, work_mode, location, duration, ' +
        'budget_min, budget_max, status, ' +
        'branches(name), specialities(name)',
    )
    .eq('domain_id', profile.domain_id)
    .eq('status', 'published')
    .eq('type', targetPubType)
    .order('published_at', { ascending: false })
    .limit(config.max_candidates)

  if (pubErr) {
    console.error('[matching-expert] publications load failed', pubErr.message)
    return { status: 'error', proposals: [], notes: `Pub lookup: ${pubErr.message}`, model: config.model }
  }
  const pubRows = (pubData ?? []) as unknown as PublicationRow[]

  if (pubRows.length === 0) {
    // Pas de publications candidates → on reconcilie quand même (vide) pour
    // nettoyer d'éventuels matches obsolètes (sauf candidatures/dismissed).
    try {
      await reconcileMatches({
        supabaseAdmin,
        scope: { byProfileId: profileId },
        domainId: profile.domain_id,
        desired: [],
        model: config.model,
      })
    } catch (err) {
      console.error('[matching-expert] reconcile (empty_pool) threw', err)
    }
    return { status: 'empty_pool', proposals: [], notes: `Pool publications vide (domain=${profile.domain_id}, type=${targetPubType}).`, model: config.model }
  }

  // 4. AI call inverse — 1 expert vs N publications
  const expertCandidate = profileToCandidate(profile)
  const publications = pubRows.map((r) => pubToForMatching(r, locale))
  const aiResult = await callExpertMatchingAi({
    config,
    expert: expertCandidate,
    publications,
    locale,
  })
  if (!aiResult.ok) {
    return { status: 'error', proposals: [], notes: aiResult.error, model: config.model }
  }
  const proposals = aiResult.proposals

  // 5. Reconcile — préserve status, ne supprime jamais une candidature engagée
  //    ni un dismissed.
  const desired: ReconcileDesired[] = proposals.map((p) => ({
    profile_id: profileId,
    publication_id: p.publication_id,
    score: p.score,
    reason: p.reason,
    pitch_org: p.pitch_org ?? null,
  }))
  let stats
  try {
    stats = await reconcileMatches({
      supabaseAdmin,
      scope: { byProfileId: profileId },
      domainId: profile.domain_id,
      desired,
      model: aiResult.model,
    })
  } catch (err) {
    console.error('[matching-expert] reconcile threw', err)
    return {
      status: 'error',
      proposals: proposals.map((p) => ({ profile_id: profileId, score: p.score, reason: p.reason, pitch_org: p.pitch_org })),
      notes: 'Reconcile failed.',
      model: aiResult.model,
    }
  }

  // 6. Notifs — UNIQUEMENT inserts FRAIS dont le score dépasse le seuil.
  //    Symétrique côté publi : un re-run sur le même état ne re-notifie pas.
  if (stats.inserted.length > 0) {
    const freshScoredPubIds = new Set(
      proposals
        .filter((p) => p.score >= config.notify_threshold)
        .map((p) => p.publication_id),
    )
    const freshInserts = stats.inserted.filter((i) => freshScoredPubIds.has(i.publication_id))
    if (freshInserts.length > 0 && u) {
      const titlesById = new Map(pubRows.map((r) => [r.id, { title: r.title, type: r.type as AnnonceType }]))
      const specs: NotifySpec[] = []
      for (const f of freshInserts) {
        const meta = titlesById.get(f.publication_id)
        if (!meta) continue
        specs.push({
          user_id: profile.user_id,
          profile_id: profileId,
          publication_id: f.publication_id,
          publication_title: meta.title,
          publication_type: meta.type === 'offre' ? 'offre' : 'mission',
          domain_id: profile.domain_id,
          locale: u.locale ?? locale,
        })
      }
      await notifyAndFlip({ supabaseAdmin, specs })
    }
  }

  // Adapter la sortie au type MatchingVerdict (legacy : `profile_id, score, reason`).
  return {
    status: 'ok',
    proposals: proposals.map((p) => ({
      profile_id: profileId,
      score: p.score,
      reason: p.reason,
      pitch_org: p.pitch_org,
    })),
    notes: `Reconcile expert ${profileId}: +${stats.inserted.length} ~${stats.updated} -${stats.deleted} (préservés: dismissed=${stats.preserved_dismissed}, candidatures=${stats.preserved_with_candidature}).`,
    model: aiResult.model,
  }
}
