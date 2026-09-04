import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnnonceType } from '@/types/annonce'
import { estTypeAnnonce, expertKindForAnnonce, type ExpertKind } from '@/lib/annonces/audience'
import { loadMatchingSettings } from './settings'
import { chargerVivierPourAnnonce, type CriteresAnnonce } from './pool'
import { buildAnnonceQuery, buildExpertDocument, documentUtilisable } from './document'
import { rerankerTout } from './rerank'
import { reconcileMatches, type ReconcileDesired } from './reconcile'
import { notifyAndFlip, type NotifySpec } from './shared'
import type { MatchingVerdict } from './types'

/**
 * MISE EN RELATION — sens ANNONCE → EXPERTS.
 *
 * ═══ CE QUI A CHANGÉ, ET POURQUOI ═════════════════════════════════════════
 *   Claude est SORTI de la mise en relation. Il notait cent profils d'un coup,
 *   dans un seul prompt, en les comparant les uns aux autres — et « ne les
 *   compare pas entre eux » n'était qu'une phrase dans ce prompt, que rien ne
 *   garantissait. Le vivier était plafonné à cent, sans ORDER BY : une liste
 *   d'autorisés stable et invisible, où le 101ᵉ n'existait pas.
 *
 *   Le reranking note chaque couple (annonce, profil) INDÉPENDAMMENT. Il n'y a
 *   donc plus rien à couper, plus de plafond, et l'absence de compétition
 *   devient une propriété du moteur au lieu d'une consigne.
 *
 * ═══ QUATRE TEMPS, ET CHACUN SAIT SE TAIRE OU PARLER ══════════════════════
 *   1. RÉGLAGES — absents ⇒ on refuse et on le dit. Aucun repli codé en dur :
 *      un repli invisible est un second réglage qui prend la main le jour où
 *      l'on comprend le moins ce qui se passe.
 *   2. VIVIER — filtres SQL sur des critères DÉCLARÉS, y compris les décisions
 *      déjà prises par l'expert (décliné, déjà postulé).
 *   3. NOTATION — tout le vivier, par lots, budget relu entre chaque lot.
 *   4. RÉCONCILIATION puis NOTIFICATIONS — seulement les inserts FRAIS, et
 *      seulement si les notifications sont activées.
 *
 * ═══ LA TRACE N'EST PAS UN DÉTAIL ═════════════════════════════════════════
 *   Un run écrit ce qu'il a fait dans `publications.matching_stats` :
 *   périmètre, notés, lots en échec, distribution des scores, seuil appliqué.
 *   C'est ce qui distingue « noté, personne ne correspond » de « jamais noté »,
 *   et c'est la matière première du réglage des seuils. Un run interrompu reste
 *   INACHEVÉ, donc visible et rejouable.
 */

type LigneAnnonce = {
  id: string
  domain_id: string
  type: string
  created_by: string | null
  title: string | null
  description: string | null
  branch_id: string | null
  speciality_ids: string[] | null
  seniorities: string[] | null
  skills_required: string[] | null
  work_zone_countries: string[] | null
  status: string
  matching_attempts: number | null
}

// Le moteur ne connaît PAS le catalogue des types d'annonce : il demande. Une
// liste recopiée ici oublierait le type ajouté demain, et retomberait en silence
// sur une valeur par défaut.
const typeSur = (v: string): AnnonceType => (estTypeAnnonce(v) ? v : 'mission')

/**
 * LA TRACE D'UN RUN — construite en UN SEUL endroit, pour les deux chemins.
 *
 * Il y a deux façons de terminer : un vivier sans personne à noter, et un run
 * qui a noté. Tant que chacune écrivait son propre objet, l'une pouvait oublier
 * une clé que la supervision lit — et une clé absente se lit `null`, qu'une
 * somme SQL affiche ZÉRO. La supervision dirait alors « tout va bien » sur un
 * moteur muet.
 *
 * Les deux chemins passent désormais par ici. La divergence n'est plus une
 * question de vigilance : elle est impossible.
 */
type TraceDeRun = {
  eligible_after_filters: number
  ecartes_deja_decline: number
  ecartes_deja_postule: number
  sans_matiere: number
  reranked: number
  rerank_failed: number
  above_threshold: number
  matches_created: number
  notified: number
  notify_enabled: boolean
  feed_threshold_used: number
  threshold_used: number
  score_p50: number | null
  score_p90: number | null
  score_max: number | null
  arret: string | null
}

function construireTrace(t: TraceDeRun): Record<string, unknown> {
  return { ...t }
}

/** Percentile d'une liste triée croissante. Rendu à 4 décimales, comme la trace. */
function percentile(triee: readonly number[], p: number): number | null {
  if (triee.length === 0) return null
  const i = Math.min(triee.length - 1, Math.max(0, Math.round((triee.length - 1) * p)))
  return Number(triee[i].toFixed(4))
}

async function marquerTentative(
  supabaseAdmin: SupabaseClient,
  publicationId: string,
  tentativesActuelles: number,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('publications')
    .update({
      matching_attempted_at: new Date().toISOString(),
      matching_completed_at: null,
      matching_attempts: tentativesActuelles + 1,
    })
    .eq('id', publicationId)
  if (error) {
    // Un run non marqué est un run qu'aucun rattrapage ne retrouvera. On ne
    // bloque pas pour autant : mieux vaut un run non tracé qu'un run non fait.
    console.error('[matching] tentative non marquée', { publicationId, message: error.message })
  }
}

async function acheverRun(
  supabaseAdmin: SupabaseClient,
  publicationId: string,
  stats: Record<string, unknown>,
  model: string,
  acheve: boolean,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('publications')
    .update({
      // INACHEVÉ tant qu'un lot a échoué ou que le budget a arrêté le run : un
      // trou qui reste ouvert vaut mieux qu'un trou refermé sur une erreur.
      matching_completed_at: acheve ? new Date().toISOString() : null,
      matching_stats: stats,
      matching_model: model,
    })
    .eq('id', publicationId)
  if (error) {
    console.error('[matching] trace du run non écrite', { publicationId, message: error.message })
  }
}

/**
 * LE RUN N'A PLUS DE LANGUE, et ce n'est pas un oubli.
 *
 * Il en avait une tant que Claude produisait un texte d'explication par match.
 * Le reranking ne produit qu'un nombre : il n'y a plus rien à rédiger, donc plus
 * rien à traduire. Les notifications, elles, restent traduites — mais dans la
 * langue de CHAQUE destinataire, lue sur son compte, pas dans une langue de run.
 */
export async function runMatchingForPublication(args: {
  supabaseAdmin: SupabaseClient
  publicationId: string
}): Promise<MatchingVerdict> {
  const { supabaseAdmin, publicationId } = args

  // ── 1. L'annonce ─────────────────────────────────────────────────────────
  const { data: pubData, error: pubErr } = await supabaseAdmin
    .from('publications')
    .select(
      'id, domain_id, type, created_by, title, description, branch_id, speciality_ids, ' +
        'seniorities, skills_required, work_zone_countries, status, matching_attempts',
    )
    .eq('id', publicationId)
    .maybeSingle()

  // Une requête en ÉCHEC n'est pas une annonce ABSENTE. Les confondre enverrait
  // chercher une annonce supprimée alors que c'est la base qui n'a pas répondu.
  if (pubErr) {
    console.error('[matching] lecture de l annonce en échec', { publicationId, message: pubErr.message })
    return { status: 'error', proposals: [], notes: `Lecture de l'annonce en échec : ${pubErr.message}`, model: null }
  }
  if (!pubData) {
    return { status: 'error', proposals: [], notes: 'Annonce introuvable.', model: null }
  }
  const pub = pubData as unknown as LigneAnnonce

  // ── 2. Les réglages ──────────────────────────────────────────────────────
  const reglages = await loadMatchingSettings(supabaseAdmin, pub.domain_id)
  if (!reglages.ok) {
    return { status: 'no_config', proposals: [], notes: reglages.detail, model: null }
  }
  const s = reglages.settings

  await marquerTentative(supabaseAdmin, publicationId, pub.matching_attempts ?? 0)

  const criteres: CriteresAnnonce = {
    id: pub.id,
    domain_id: pub.domain_id,
    type: typeSur(pub.type),
    created_by: pub.created_by,
    branch_id: pub.branch_id,
    speciality_ids: pub.speciality_ids ?? [],
    seniorities: pub.seniorities ?? [],
    work_zone_countries: pub.work_zone_countries ?? [],
  }

  // ── 3. Le vivier ─────────────────────────────────────────────────────────
  const vivier = await chargerVivierPourAnnonce(supabaseAdmin, criteres)
  if (vivier.erreur) {
    await acheverRun(supabaseAdmin, publicationId, { erreur: vivier.erreur }, s.rerank_model, false)
    return { status: 'error', proposals: [], notes: vivier.erreur, model: s.rerank_model }
  }

  const requete = buildAnnonceQuery({
    title: pub.title,
    description: pub.description,
    skills_required: pub.skills_required,
  })
  if (!documentUtilisable(requete)) {
    // Une annonce sans matière ne peut pas être notée. Le dire vaut mieux que
    // rendre un vivier vide, qui se lirait « personne ne correspond ».
    const note = 'Annonce trop courte pour être notée (titre + description + compétences).'
    await acheverRun(supabaseAdmin, publicationId, { erreur: note }, s.rerank_model, false)
    return { status: 'error', proposals: [], notes: note, model: s.rerank_model }
  }

  const documents = vivier.profils
    .map((p) => ({ id: p.profile_id, texte: buildExpertDocument(p) }))
    .filter((d) => documentUtilisable(d.texte))
  const sansMatiere = vivier.profils.length - documents.length

  const baseStats = {
    eligible_after_filters: vivier.profils.length,
    ecartes_deja_decline: vivier.ecartes.deja_decline,
    ecartes_deja_postule: vivier.ecartes.deja_postule,
    // Un profil sans matière n'est pas un profil écarté : il n'a rien à noter.
    // Le compter à part évite de lire un écart de couverture là où il n'y en a pas.
    sans_matiere: sansMatiere,
  }

  if (documents.length === 0) {
    // Vivier vide : on réconcilie quand même (les matches d'un run précédent
    // doivent être nettoyés) et on ACHÈVE le run — « noté, personne » est un
    // résultat, pas une panne.
    try {
      await reconcileMatches({
        supabaseAdmin,
        scope: { byPublicationId: publicationId },
        domainId: pub.domain_id,
        desired: [],
        model: s.rerank_model,
      })
    } catch (err) {
      console.error('[matching] réconciliation (vivier vide) a levé', err)
    }
    await acheverRun(
      supabaseAdmin,
      publicationId,
      construireTrace({
        ...baseStats,
        reranked: 0,
        rerank_failed: 0,
        above_threshold: 0,
        matches_created: 0,
        notified: 0,
        notify_enabled: s.notify_enabled,
        feed_threshold_used: s.feed_threshold,
        threshold_used: s.notify_threshold,
        // Aucun score n'a été produit : `null` dit « rien à distribuer », là où
        // un 0 se lirait « tout le monde à zéro ».
        score_p50: null,
        score_p90: null,
        score_max: null,
        arret: null,
      }),
      s.rerank_model,
      true,
    )
    return { status: 'empty_pool', proposals: [], notes: 'Aucun profil éligible à noter.', model: s.rerank_model }
  }

  // ── 4. La notation ───────────────────────────────────────────────────────
  const notation = await rerankerTout({
    supabaseAdmin,
    domainId: pub.domain_id,
    model: s.rerank_model,
    tailleLot: s.rerank_batch_size,
    requete,
    documents,
    contexte: { publication_id: publicationId },
  })

  const parProfil = new Map(vivier.profils.map((p) => [p.profile_id, p]))
  const scores: number[] = []
  const desired: ReconcileDesired[] = []
  for (const [profileId, score] of notation.scores) {
    if (score < s.feed_threshold) continue
    const p = parProfil.get(profileId)
    if (!p) continue
    scores.push(score)
    desired.push({
      profile_id: profileId,
      publication_id: publicationId,
      relevance_score: score,
      // Le palier est figé ICI, contre le seuil EN VIGUEUR ce jour-là. Le
      // recalculer à l'affichage rebaptiserait des matches anciens en silence.
      relevance_tier: s.notify_threshold > 0 && score >= s.notify_threshold ? 'strong' : 'normal',
      reason: '',
      pitch_org: null,
    })
  }
  scores.sort((a, b) => a - b)
  const auDessusDuSeuil = desired.filter((d) => d.relevance_tier === 'strong')

  // ── 5. Réconciliation ────────────────────────────────────────────────────
  let stats
  try {
    stats = await reconcileMatches({
      supabaseAdmin,
      scope: { byPublicationId: publicationId },
      domainId: pub.domain_id,
      desired,
      model: notation.model,
      // Un profil encore éligible mais non renoté ce run est PRÉSERVÉ. La seule
      // suppression légitime vient d'une raison objective : sorti du vivier.
      inScopeFreeAxisIds: vivier.profils.map((p) => p.profile_id),
    })
  } catch (err) {
    const note = err instanceof Error ? err.message : String(err)
    await acheverRun(supabaseAdmin, publicationId, { ...baseStats, erreur: note }, notation.model, false)
    return { status: 'error', proposals: [], notes: `Réconciliation en échec : ${note}`, model: notation.model }
  }

  // ── 6. Les notifications ─────────────────────────────────────────────────
  //  Seulement les inserts FRAIS, seulement au-dessus du seuil, et seulement si
  //  les notifications sont ACTIVÉES. Tant que personne n'a lu la distribution,
  //  elles ne le sont pas : notifier 12 000 personnes sur un seuil deviné est
  //  pire que ne pas notifier encore.
  let notifies = 0
  if (s.notify_enabled && stats.inserted.length > 0) {
    const fortsFrais = new Set(auDessusDuSeuil.map((d) => d.profile_id))
    const cibles = stats.inserted.filter((i) => fortsFrais.has(i.profile_id))
    const specs: NotifySpec[] = []
    for (const c of cibles) {
      const p = parProfil.get(c.profile_id)
      if (!p) continue
      specs.push({
        user_id: p.user_id,
        profile_id: p.profile_id,
        publication_id: publicationId,
        publication_title: pub.title ?? '',
        publication_type: criteres.type,
        user_type: p.user_type,
        domain_id: pub.domain_id,
        locale: p.locale,
      })
    }
    if (specs.length > 0) {
      await notifyAndFlip({ supabaseAdmin, specs })
      notifies = specs.length
    }
  }

  // ── 7. La trace ──────────────────────────────────────────────────────────
  const acheve = notation.lots_en_echec === 0 && !notation.arret
  await acheverRun(
    supabaseAdmin,
    publicationId,
    construireTrace({
      ...baseStats,
      reranked: notation.notes,
      rerank_failed: notation.lots_en_echec,
      above_threshold: auDessusDuSeuil.length,
      matches_created: stats.inserted.length,
      notified: notifies,
      notify_enabled: s.notify_enabled,
      feed_threshold_used: s.feed_threshold,
      threshold_used: s.notify_threshold,
      score_p50: percentile(scores, 0.5),
      score_p90: percentile(scores, 0.9),
      score_max: scores.length > 0 ? Number(scores[scores.length - 1].toFixed(4)) : null,
      // Toujours une RAISON NOMMABLE quand le run s'est arrêté. Un run muet
      // envoie chercher un bug pendant deux jours.
      arret: notation.arret ?? null,
    }),
    notation.model,
    acheve,
  )

  const resume =
    `Vivier ${vivier.profils.length} · notés ${notation.notes} · retenus ${desired.length} · ` +
    `forts ${auDessusDuSeuil.length} · +${stats.inserted.length} ~${stats.updated} -${stats.deleted}` +
    (notation.arret ? ` · ARRÊTÉ : ${notation.arret}` : '') +
    (notation.lots_en_echec > 0 ? ` · ${notation.lots_en_echec} lot(s) NON noté(s)` : '')

  return {
    status: acheve ? 'ok' : 'error',
    proposals: desired.map((d) => ({ profile_id: d.profile_id, relevance_score: d.relevance_score })),
    notes: resume,
    model: notation.model,
  }
}

/** Le public natif d'une annonce, réexporté pour les appelants historiques. */
export function userTypeForPublication(type: AnnonceType): ExpertKind {
  return expertKindForAnnonce(type)
}

// Alias historique : la route de publication appelle encore `runMatching`.
export const runMatching = runMatchingForPublication

export { runMatchingForExpert, clearExpertRecommendations, runPruneForExpert } from './run-for-expert'
export type { MatchingVerdict, MatchingLocale } from './types'
