import type { SupabaseClient } from '@supabase/supabase-js'
import { callProfileMatchingAi } from './ai-profile-matching'
import { reconcileMatches, type ReconcileDesired } from './reconcile'
import type {
  MatchingLocale,
  MatchingVerdict,
  PublicationForMatching,
} from './types'
import type { AnnonceType } from '@/types/annonce'
import {
  loadMatchingConfig,
  loadEligibleProfiles,
  normalizeMatchingLocale,
  notifyAndFlip,
  pickRel,
  userTypeForPublication,
  type NotifySpec,
} from './shared'

/**
 * Orchestrateur de matching IA — direction PUBLICATION → EXPERTS.
 *
 * Refactor du Lot 2a vers le modèle RÉCONCILIÉ (cf. lib/matching/reconcile.ts) :
 *   - L'`upsert` à plat (qui resettait status='pending') est remplacé par un
 *     reconcileMatches({ scope: { byPublicationId } }) qui PRÉSERVE le status,
 *     ne supprime jamais une candidature engagée ni un dismissed, et nettoie
 *     les matches devenus obsolètes (drift IA — édition annonce p.ex.).
 *   - Les notifications ne sont émises QUE sur les inserts FRAIS (jamais sur un
 *     match déjà existant) → re-runs idempotents, l'expert n'est pas spammé.
 *
 * Cohabite avec `runMatchingForExpert` (direction inverse, cf.
 * lib/matching/run-for-expert.ts). Les deux partagent shared.ts (config, pool,
 * notifs) et reconcile.ts (CRUD idempotent) — UN seul cœur, deux directions.
 *
 * SCOPE (frontière + actif + consentement) :
 *   - profiles.domain_id = publications.domain_id
 *   - users.user_type = 'expert_freelance' (mission) | 'expert_cdi' (offre)
 *   - profiles.cv_parsing_status = 'done'
 *   - profiles.visible = true
 *   - profiles.ai_consent_at IS NOT NULL
 *   - profiles.verification_status = 'approved'
 *   - PAS en DND
 *
 * FAIL-SAFE : tout retour `status='error'` est non-bloquant côté caller.
 */

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
      // Sens publication→experts : l'annonce est le PIVOT, pas un élément du
      // pool. Le marquage croisé porte ici sur chaque CANDIDAT
      // (ProfileCandidate.cross_type_opt_in, cf. loadEligibleProfiles).
      cross_type_opt_in: false,
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

export async function runMatchingForPublication(args: {
  supabaseAdmin: SupabaseClient
  publicationId: string
  /** Locale de la publication (pour générer explanation.reason). FR par défaut. */
  locale?: string
}): Promise<MatchingVerdict> {
  const { supabaseAdmin, publicationId } = args
  const locale = normalizeMatchingLocale(args.locale ?? 'fr')

  // 1. Config
  const config = await loadMatchingConfig(supabaseAdmin)
  if (!config) {
    return { status: 'no_config', proposals: [], notes: 'Provider profile_matching non configuré.', model: null }
  }

  // 2. Publication
  const pubLoad = await loadPublication(supabaseAdmin, publicationId, locale)
  if (!pubLoad) {
    return { status: 'error', proposals: [], notes: 'Publication introuvable.', model: config.model }
  }
  const { pub, domain_id } = pubLoad

  // 3. Profils éligibles (frontière D + E + user_type C)
  const expectedUserType = userTypeForPublication(pub.type)
  const candidates = await loadEligibleProfiles(supabaseAdmin, domain_id, expectedUserType, config.max_candidates)
  if (candidates.length === 0) {
    console.warn('[matching] empty pool', { publicationId, domain_id, expectedUserType })
    try {
      await reconcileMatches({
        supabaseAdmin,
        scope: { byPublicationId: publicationId },
        domainId: domain_id,
        desired: [],
        model: config.model,
      })
    } catch (err) {
      console.error('[matching] reconcile (empty_pool) threw', err)
    }
    return { status: 'empty_pool', proposals: [], notes: `Pool vide (domain=${domain_id}, user_type=${expectedUserType}).`, model: config.model }
  }

  // 4. AI call (direction publi → candidats)
  const aiResult = await callProfileMatchingAi({ config, publication: pub, candidates })
  if (!aiResult.ok) {
    return { status: 'error', proposals: [], notes: aiResult.error, model: config.model }
  }
  const proposals = aiResult.proposals

  // 5. Reconcile (insert/update/delete avec garde-fous candidature/dismissed)
  const desired: ReconcileDesired[] = proposals.map((p) => ({
    profile_id: p.profile_id,
    publication_id: publicationId,
    score: p.score,
    reason: p.reason,
    pitch_org: p.pitch_org ?? null,
  }))
  let stats
  try {
    stats = await reconcileMatches({
      supabaseAdmin,
      scope: { byPublicationId: publicationId },
      domainId: domain_id,
      desired,
      model: aiResult.model,
      // STABILITÉ : les profils éligibles in-scope protègent de la variance IA —
      // un match vers un expert encore éligible mais non re-proposé ce run est
      // préservé (preserved_in_scope), jamais supprimé.
      inScopeFreeAxisIds: candidates.map((c) => c.profile_id),
    })
  } catch (err) {
    console.error('[matching] reconcile threw', err)
    return { status: 'error', proposals, notes: 'Reconcile failed.', model: aiResult.model }
  }

  // 6. Notifications — UNIQUEMENT pour les inserts FRAIS dont le score
  //    dépasse le seuil. Un re-run après édition ne re-notifie pas.
  if (stats.inserted.length > 0) {
    const freshScoredProfileIds = new Set(
      proposals
        .filter((p) => p.score >= config.notify_threshold)
        .map((p) => p.profile_id),
    )
    const freshInserts = stats.inserted.filter((p) => freshScoredProfileIds.has(p.profile_id))
    if (freshInserts.length > 0) {
      const profileIds = freshInserts.map((p) => p.profile_id)
      const { data: pUsers } = await supabaseAdmin
        .from('profiles')
        .select('id, user_id, users!profiles_user_id_fkey!inner(locale, user_type)')
        .in('id', profileIds)
      // Ouverture croisée : le pool peut mêler les 2 types → on capte le vrai
      // user_type de CHAQUE profil matché (pas expectedUserType) pour le deep-link.
      const targetMap = new Map<string, { user_id: string; locale: string; user_type: 'expert_freelance' | 'expert_cdi' }>()
      for (const row of (pUsers ?? []) as Array<{ id: string; user_id: string; users: { locale: string; user_type: string } | { locale: string; user_type: string }[] }>) {
        const u = pickRel(row.users)
        if (u) {
          targetMap.set(row.id, {
            user_id: row.user_id,
            locale: u.locale,
            user_type: u.user_type === 'expert_cdi' ? 'expert_cdi' : 'expert_freelance',
          })
        }
      }
      const specs: NotifySpec[] = []
      for (const f of freshInserts) {
        const t = targetMap.get(f.profile_id)
        if (!t) continue
        specs.push({
          user_id: t.user_id,
          profile_id: f.profile_id,
          publication_id: f.publication_id,
          publication_title: pub.title,
          publication_type: pub.type,
          user_type: t.user_type,
          domain_id,
          locale: t.locale,
        })
      }
      await notifyAndFlip({ supabaseAdmin, specs })
    }
  }

  return {
    status: 'ok',
    proposals,
    notes: `Reconcile publi ${publicationId}: +${stats.inserted.length} ~${stats.updated} -${stats.deleted} (préservés: dismissed=${stats.preserved_dismissed}, candidatures=${stats.preserved_with_candidature}, in_scope=${stats.preserved_in_scope}).`,
    model: aiResult.model,
  }
}

// Alias legacy : ancien nom, comportement réconcilié.
// La route publish (et le diag script) appelle encore `runMatching`. On garde
// l'API pour ne pas casser, mais le moteur est désormais le réconcilié.
export const runMatching = runMatchingForPublication

export { runMatchingForExpert, clearExpertRecommendations, runPruneForExpert } from './run-for-expert'
export type { MatchingVerdict, MatchingLocale } from './types'
