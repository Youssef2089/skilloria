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
  open_to_cdi: boolean | null
  open_to_freelance: boolean | null
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
    // Sens expert→publications : l'expert est le PIVOT, pas un élément du pool.
    // Le marquage croisé porte ici sur chaque PUBLICATION (cf. pubToForMatching).
    cross_type_opt_in: false,
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

function pubToForMatching(
  row: PublicationRow,
  locale: MatchingLocale,
  /** Type d'annonce NATIF de l'expert — tout autre type est un croisé opt-in. */
  nativeType: AnnonceType,
): PublicationForMatching {
  const branch = pickRel(row.branches)
  const speciality = pickRel(row.specialities)
  const safeType: AnnonceType = row.type === 'mission' || row.type === 'offre' ? row.type : 'mission'
  return {
    id: row.id,
    type: safeType,
    // OUVERTURE CROISÉE : cette annonce est dans le pool UNIQUEMENT parce que
    // l'expert a coché l'opt-in (le pool est restreint au type natif sinon).
    cross_type_opt_in: safeType !== nativeType,
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

/**
 * Écrit la TRACE du scope du dernier run (cf. migration 20260708000009 —
 * profiles.last_matching_scope jsonb). Le routeur /api/me/sync-matching s'en
 * sert pour DÉRIVER le sens d'un changement de scope côté serveur :
 *   - crossOpen true → false (rétréci) : prune-only SQL, hors cooldown IA.
 *   - crossOpen false → true (élargi)   : run IA complet, cooldown strict.
 *
 * Best-effort : non-bloquant (un échec d'écriture ne casse pas le run).
 */
async function writeMatchingScopeTrace(
  supabaseAdmin: SupabaseClient,
  profileId: string,
  crossOpen: boolean,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ last_matching_scope: { crossOpen, evaluated_at: new Date().toISOString() } })
    .eq('id', profileId)
  if (error) console.warn('[matching-expert] scope trace write failed', error.message)
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
        'open_to_cdi, open_to_freelance, ' +
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

  // Ouverture croisée (opt-in) : un freelance qui a coché open_to_cdi voit AUSSI
  // les offres CDI ; un CDI qui a coché open_to_freelance voit AUSSI les missions.
  // Dans ce cas le pool couvre les deux types ; sinon il reste sur le type natif.
  const crossOpen =
    (userType === 'expert_freelance' && profile.open_to_cdi === true) ||
    (userType === 'expert_cdi' && profile.open_to_freelance === true)

  // 3. Pool de publications éligibles (domain + type + published)
  let pubQuery = supabaseAdmin
    .from('publications')
    .select(
      'id, domain_id, type, title, description, branch_id, speciality_id, ' +
        'skills_required, seniority, work_mode, location, duration, ' +
        'budget_min, budget_max, status, ' +
        'branches(name), specialities(name)',
    )
    .eq('domain_id', profile.domain_id)
    .eq('status', 'published')
  pubQuery = crossOpen
    ? pubQuery.in('type', ['mission', 'offre'])
    : pubQuery.eq('type', targetPubType)
  const { data: pubData, error: pubErr } = await pubQuery
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
    // Le pool vide constitue un run : on trace le scope courant.
    await writeMatchingScopeTrace(supabaseAdmin, profileId, crossOpen)
    return { status: 'empty_pool', proposals: [], notes: `Pool publications vide (domain=${profile.domain_id}, type=${targetPubType}).`, model: config.model }
  }

  // 4. AI call inverse — 1 expert vs N publications
  const expertCandidate = profileToCandidate(profile)
  const publications = pubRows.map((r) => pubToForMatching(r, locale, targetPubType))
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
      // STABILITÉ : le pool in-scope (publications) protège de la variance IA —
      // un match vers une publi encore dans le pool mais non re-proposée ce run
      // est préservé (preserved_in_scope), jamais supprimé.
      inScopeFreeAxisIds: pubRows.map((r) => r.id),
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
          user_type: userType,
          domain_id: profile.domain_id,
          locale: u.locale ?? locale,
        })
      }
      await notifyAndFlip({ supabaseAdmin, specs })
    }
  }

  // Fin de run complet : on trace le scope courant (sens dérivable côté serveur).
  await writeMatchingScopeTrace(supabaseAdmin, profileId, crossOpen)

  // Adapter la sortie au type MatchingVerdict (legacy : `profile_id, score, reason`).
  return {
    status: 'ok',
    proposals: proposals.map((p) => ({
      profile_id: profileId,
      score: p.score,
      reason: p.reason,
      pitch_org: p.pitch_org,
    })),
    notes: `Reconcile expert ${profileId}: +${stats.inserted.length} ~${stats.updated} -${stats.deleted} (préservés: dismissed=${stats.preserved_dismissed}, candidatures=${stats.preserved_with_candidature}, in_scope=${stats.preserved_in_scope}).`,
    model: aiResult.model,
  }
}

/**
 * Retire les RECOMMANDATIONS de missions d'un expert — DÉMOTION.
 *
 * Appelé quand l'expert n'est plus 'approved' (re-publication qui repasse en
 * pending_admin_review/rejected, ou refus admin). Les missions recommandées
 * doivent suivre STRICTEMENT le statut de vérif : un expert non approuvé ne
 * doit plus rien voir/recevoir.
 *
 * N'introduit AUCUNE logique nouvelle : réutilise le primitif idempotent
 * `reconcileMatches({ desired: [] })`, qui supprime les recommandations pures
 * (status pending/notified/viewed SANS candidature) tout en PRÉSERVANT :
 *   - les matches 'dismissed' (décision active de l'expert),
 *   - les matches liés à une candidature (acte engagé — candidatures/
 *     conversations restent intactes ; matches.id → candidatures.match_id est
 *     ON DELETE SET NULL côté schéma de toute façon).
 *
 * Best-effort : tout échec est non-bloquant côté caller (loggé).
 */
export async function clearExpertRecommendations(args: {
  supabaseAdmin: SupabaseClient
  profileId: string
}): Promise<{ ok: boolean; deleted: number }> {
  const { supabaseAdmin, profileId } = args

  // domain_id requis par reconcileMatches (utilisé uniquement pour les INSERT ;
  // ici desired=[] → aucun insert, mais on respecte le contrat de la fonction).
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('domain_id')
    .eq('id', profileId)
    .maybeSingle()
  if (error || !data) {
    console.error('[matching-expert] clear: profile lookup failed', error?.message ?? 'not found')
    return { ok: false, deleted: 0 }
  }
  const domainId = (data as { domain_id: string }).domain_id

  try {
    const stats = await reconcileMatches({
      supabaseAdmin,
      scope: { byProfileId: profileId },
      domainId,
      desired: [],
      model: 'demotion-cleanup',
    })
    return { ok: true, deleted: stats.deleted }
  } catch (err) {
    console.error('[matching-expert] clear reconcile threw', err)
    return { ok: false, deleted: 0 }
  }
}

/**
 * PRUNE-ONLY — élagage des matches devenus hors-scope, SANS aucun appel Claude.
 *
 * Cas d'usage : DÉCOCHAGE de l'ouverture croisée (rétrécissement du pool). Le
 * seul travail nécessaire est de retirer les matches vers des publications
 * sorties du scope (ex. offres CDI après décochage) — pur SQL, donc exécutable
 * HORS du cooldown IA (cf. routage /api/me/sync-matching). Latence ~secondes.
 *
 * Principe :
 *   1. Lire le profil : domaine + user_type + flags open_to_* ACTUELS.
 *   2. Types de publication encore en scope (crossOpen courant lu du profil).
 *   3. desired = matches EXISTANTS dont la publication est encore `published`,
 *      du bon type et du bon domaine — en RÉUTILISANT leurs score/explanation
 *      actuels (ZÉRO re-scoring, aucun callExpertMatchingAi).
 *   4. reconcileMatches → supprime les matches hors-desired (pending/notified/
 *      viewed sans candidature), PRÉSERVE dismissed + candidatures (garde-fous
 *      identiques au run complet — reconcile n'est PAS modifié).
 *   5. Écrit la trace de scope (un prune constitue un run).
 *
 * Best-effort : tout échec est non-bloquant côté caller.
 */
export async function runPruneForExpert(args: {
  supabaseAdmin: SupabaseClient
  profileId: string
}): Promise<{ ok: boolean; deleted: number; kept: number; crossOpen: boolean }> {
  const { supabaseAdmin, profileId } = args

  // 1. Profil : domaine + user_type + flags d'ouverture croisée COURANTS.
  const { data: profileData, error: pErr } = await supabaseAdmin
    .from('profiles')
    .select('id, domain_id, open_to_cdi, open_to_freelance, users!profiles_user_id_fkey!inner(user_type)')
    .eq('id', profileId)
    .maybeSingle()
  if (pErr || !profileData) {
    console.error('[matching-prune] profile lookup failed', pErr?.message ?? 'not found')
    return { ok: false, deleted: 0, kept: 0, crossOpen: false }
  }
  const profile = profileData as unknown as {
    id: string
    domain_id: string
    open_to_cdi: boolean | null
    open_to_freelance: boolean | null
    users: { user_type: string | null } | { user_type: string | null }[] | null
  }
  const u = pickRel(profile.users) as { user_type: string | null } | null
  const userType = u?.user_type === 'expert_cdi' ? 'expert_cdi' : 'expert_freelance'
  const crossOpen =
    (userType === 'expert_freelance' && profile.open_to_cdi === true) ||
    (userType === 'expert_cdi' && profile.open_to_freelance === true)
  const nativeType = publicationTypeForUserType(userType)
  const allowedTypes: string[] = crossOpen ? ['mission', 'offre'] : [nativeType]

  // 2. Matches existants + type/statut/domaine de leur publication (jointure SQL).
  const { data: existData, error: exErr } = await supabaseAdmin
    .from('matches')
    .select('id, publication_id, score, explanation, publications!inner(type, status, domain_id)')
    .eq('profile_id', profileId)
  if (exErr) {
    console.error('[matching-prune] existing matches load failed', exErr.message)
    return { ok: false, deleted: 0, kept: 0, crossOpen }
  }
  const existRows = (existData ?? []) as unknown as Array<{
    id: string
    publication_id: string
    score: number
    explanation: { reason?: string; pitch_org?: string | null } | null
    publications:
      | { type: string; status: string; domain_id: string }
      | { type: string; status: string; domain_id: string }[]
      | null
  }>

  // 3. desired = matches ENCORE en scope (published + bon type + bon domaine),
  //    score/explanation RÉUTILISÉS tels quels. Les hors-scope (offres après
  //    décochage) sont volontairement ABSENTS → reconcile les élaguera.
  const desired: ReconcileDesired[] = []
  for (const r of existRows) {
    const pub = pickRel(r.publications) as { type: string; status: string; domain_id: string } | null
    if (!pub) continue
    if (pub.status !== 'published') continue
    if (pub.domain_id !== profile.domain_id) continue
    if (!allowedTypes.includes(pub.type)) continue
    desired.push({
      profile_id: profileId,
      publication_id: r.publication_id,
      score: Number(r.score),
      reason: r.explanation?.reason ?? '',
      pitch_org: r.explanation?.pitch_org ?? null,
    })
  }

  // 4. reconcile (SQL pur) : supprime les hors-desired, préserve dismissed +
  //    candidatures. Modèle sentinelle 'prune-no-rescore' (aucun scoring IA).
  let deleted = 0
  try {
    const stats = await reconcileMatches({
      supabaseAdmin,
      scope: { byProfileId: profileId },
      domainId: profile.domain_id,
      desired,
      model: 'prune-no-rescore',
    })
    deleted = stats.deleted
  } catch (err) {
    console.error('[matching-prune] reconcile threw', err)
    return { ok: false, deleted: 0, kept: desired.length, crossOpen }
  }

  // 5. Trace de scope — le prune constitue un run.
  await writeMatchingScopeTrace(supabaseAdmin, profileId, crossOpen)

  return { ok: true, deleted, kept: desired.length, crossOpen }
}
