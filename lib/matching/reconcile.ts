import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Cœur partagé de réconciliation des matches — IDEMPOTENT.
 *
 * Remplace l'`upsert` historique qui resettait silencieusement le `status`
 * sur 'pending' à chaque re-run (bug racine du reset des "viewed/dismissed").
 *
 * INVARIANTS (les deux sens — expert→publi & publi→expert — s'appuient dessus) :
 *
 *  - Paire désirée absente des matches            → INSERT (status='pending').
 *  - Match existant TOUJOURS désiré               → UPDATE score + explanation,
 *                                                   STATUS PRÉSERVÉ (pending/
 *                                                   notified/viewed/dismissed).
 *  - Match existant PLUS désiré (drift IA) :
 *      • status = 'dismissed'                     → PAS TOUCHÉ (ne jamais
 *                                                   ressusciter une décision
 *                                                   active de l'expert).
 *      • candidature existante pour la paire      → PAS TOUCHÉ (acte engagé :
 *                                                   l'expert a postulé, l'org
 *                                                   travaille déjà dessus).
 *      • axe libre ENCORE en scope (inScopeFreeAxisIds) → PAS TOUCHÉ
 *                                                   (preserved_in_scope) : une
 *                                                   suppression ne peut venir
 *                                                   QUE d'une raison OBJECTIVE
 *                                                   (publi non-published, hors
 *                                                   type/domaine), JAMAIS de la
 *                                                   variance de re-proposition
 *                                                   IA. Score/explanation
 *                                                   strictement intacts.
 *      • status ∈ ('pending','notified','viewed') ET PAS de candidature ET
 *        HORS scope → DELETE.
 *
 * Le caller passe l'ensemble DÉSIRÉ (issu d'un appel IA borné à un scope), la
 * fonction se charge de comparer à l'existant et d'appliquer la diff. Retourne
 * la liste des paires nouvellement insérées (utile pour driver les notifs côté
 * orchestrateurs — on ne re-notifie JAMAIS un match déjà existant).
 *
 * Scope : exactement UNE dimension fixée — soit `byProfileId`, soit
 * `byPublicationId`. L'autre est libre.
 */

export type ReconcileDesired = {
  profile_id: string
  publication_id: string
  /** Score de pertinence BRUT du reranker, dans [0,1]. Jamais normalisé. */
  relevance_score: number
  /** Palier AFFICHÉ, figé ici et jamais recalculé à la lecture. */
  relevance_tier: 'strong' | 'normal'
  reason: string
  pitch_org?: string | null
}

export type ReconcileScope =
  | { byProfileId: string; byPublicationId?: undefined }
  | { byPublicationId: string; byProfileId?: undefined }

export type ReconcileStats = {
  inserted: { profile_id: string; publication_id: string }[]
  updated: number
  deleted: number
  preserved_dismissed: number
  preserved_with_candidature: number
  preserved_in_scope: number
}

type ExistingMatchRow = {
  id: string
  profile_id: string
  publication_id: string
  status: string
  explanation: unknown
}

function pairKey(p: { profile_id: string; publication_id: string }): string {
  return `${p.profile_id}:::${p.publication_id}`
}

export async function reconcileMatches(args: {
  supabaseAdmin: SupabaseClient
  scope: ReconcileScope
  domainId: string
  desired: ReconcileDesired[]
  model: string
  /**
   * Ids de l'axe LIBRE (celui non fixé par `scope`) encore DANS LE SCOPE au
   * moment du run : publications du pool pour un scope `byProfileId`, profils
   * éligibles pour un scope `byPublicationId`. Un existant absent de `desired`
   * mais dont l'axe libre ∈ cet ensemble est PRÉSERVÉ (preserved_in_scope),
   * sans aucun UPDATE.
   *
   * OBLIGATOIRE pour tout run IA (la variance de re-proposition ne doit jamais
   * supprimer un match encore en scope) ; optionnel uniquement pour les chemins
   * SANS IA (prune) dont le `desired` contient déjà tout l'in-scope.
   */
  inScopeFreeAxisIds?: string[]
}): Promise<ReconcileStats> {
  const { supabaseAdmin, scope, domainId, desired, model, inScopeFreeAxisIds } = args
  const nowIso = new Date().toISOString()

  const stats: ReconcileStats = {
    inserted: [],
    updated: 0,
    deleted: 0,
    preserved_dismissed: 0,
    preserved_with_candidature: 0,
    preserved_in_scope: 0,
  }

  // Ensemble des ids d'axe LIBRE encore en scope. L'axe libre est celui NON
  // fixé par `scope` : publication_id si scope byProfileId, profile_id sinon.
  const fixedOnProfile = 'byProfileId' in scope && !!scope.byProfileId
  const inScopeSet = new Set(inScopeFreeAxisIds ?? [])
  const freeAxisIdOf = (m: { profile_id: string; publication_id: string }): string =>
    fixedOnProfile ? m.publication_id : m.profile_id

  // ── 1. Charger l'existant pour le scope (axe fixé) ────────────────────────
  const existingQuery = supabaseAdmin
    .from('matches')
    .select('id, profile_id, publication_id, status, explanation')
  const filteredExisting =
    'byProfileId' in scope && scope.byProfileId
      ? existingQuery.eq('profile_id', scope.byProfileId)
      : existingQuery.eq('publication_id', (scope as { byPublicationId: string }).byPublicationId)

  const { data: existingData, error: existingErr } = await filteredExisting
  if (existingErr) {
    console.error('[reconcile] existing load failed', existingErr.message)
    throw new Error(`[reconcile] existing load failed: ${existingErr.message}`)
  }
  const existing = (existingData ?? []) as ExistingMatchRow[]
  const existingByKey = new Map(existing.map((m) => [pairKey(m), m]))

  // ── 2. Index des paires désirées (dédupé par sécurité côté caller) ────────
  const desiredByKey = new Map<string, ReconcileDesired>()
  for (const d of desired) {
    desiredByKey.set(pairKey(d), d)
  }

  // ── 3. Candidatures déjà ouvertes (acte engagé) sur ce scope ──────────────
  //   On charge en bloc TOUTES les candidatures du scope pour pouvoir bloquer
  //   les suppressions au cas par cas. Une candidature signifie : l'expert a
  //   postulé (received/in_review/shortlisted/unlocked/selected/rejected/
  //   withdrawn/archived). On considère TOUS les statuts comme un acte engagé
  //   à préserver côté `matches` — l'historique n'est pas effacé par l'IA.
  let candidatureKeys = new Set<string>()
  if (existing.length > 0) {
    const candQuery = supabaseAdmin
      .from('candidatures')
      .select('profile_id, publication_id')
    const candScoped =
      'byProfileId' in scope && scope.byProfileId
        ? candQuery.eq('profile_id', scope.byProfileId)
        : candQuery.eq('publication_id', (scope as { byPublicationId: string }).byPublicationId)
    const { data: candRows, error: candErr } = await candScoped
    if (candErr) {
      console.error('[reconcile] candidatures lookup failed', candErr.message)
      // Best-effort : si on ne sait pas, on PRÉSERVE par sécurité (ne pas supprimer).
      candidatureKeys = new Set(existing.map((m) => pairKey(m)))
    } else {
      candidatureKeys = new Set(
        (candRows ?? []).map((r) => pairKey(r as { profile_id: string; publication_id: string })),
      )
    }
  }

  // ── 4. Construire les 3 buckets (insert / update / delete) ────────────────
  const toInsert: Array<{
    publication_id: string
    profile_id: string
    domain_id: string
    relevance_score: number
    relevance_tier: 'strong' | 'normal'
    relevance_model: string
    relevance_scored_at: string
    explanation: { reason: string; pitch_org: string | null; model: string; evaluated_at: string }
    status: 'pending'
  }> = []
  const toUpdate: Array<{
    id: string
    relevance_score: number
    relevance_tier: 'strong' | 'normal'
    relevance_model: string
    explanation: unknown
  }> = []
  const toDeleteIds: string[] = []

  for (const [key, d] of desiredByKey) {
    const ex = existingByKey.get(key)
    if (!ex) {
      toInsert.push({
        publication_id: d.publication_id,
        profile_id: d.profile_id,
        domain_id: domainId,
        relevance_score: d.relevance_score,
        relevance_tier: d.relevance_tier,
        relevance_model: model,
        relevance_scored_at: nowIso,
        explanation: {
          reason: d.reason,
          pitch_org: d.pitch_org ?? null,
          model,
          evaluated_at: nowIso,
        },
        status: 'pending',
      })
    } else {
      // Préserver status : on UPDATE score + explanation seulement.
      const prevExp = (typeof ex.explanation === 'object' && ex.explanation !== null
        ? (ex.explanation as Record<string, unknown>)
        : {}) as Record<string, unknown>
      toUpdate.push({
        id: ex.id,
        relevance_score: d.relevance_score,
        relevance_tier: d.relevance_tier,
        relevance_model: model,
        explanation: {
          ...prevExp,
          reason: d.reason,
          pitch_org: d.pitch_org ?? (prevExp.pitch_org as string | null | undefined) ?? null,
          model,
          evaluated_at: nowIso,
        },
      })
    }
  }

  for (const [key, ex] of existingByKey) {
    if (desiredByKey.has(key)) continue
    if (ex.status === 'dismissed') {
      stats.preserved_dismissed++
      continue
    }
    if (candidatureKeys.has(key)) {
      stats.preserved_with_candidature++
      continue
    }
    // STABILITÉ : l'axe libre est TOUJOURS en scope mais l'IA ne l'a pas
    // re-proposé ce run (variance non-déterministe) → on PRÉSERVE tel quel,
    // aucun UPDATE (score/explanation intacts). Une suppression ne peut venir
    // que d'une raison OBJECTIVE (publi hors-scope/non-published), donc d'un
    // axe libre ABSENT de inScopeSet.
    if (inScopeSet.has(freeAxisIdOf(ex))) {
      stats.preserved_in_scope++
      continue
    }
    if (ex.status === 'pending' || ex.status === 'notified' || ex.status === 'viewed') {
      toDeleteIds.push(ex.id)
    } else {
      // Status inconnu (futur enum) : on préserve par sécurité.
      stats.preserved_dismissed++
    }
  }

  // ── 5. Appliquer (INSERT puis UPDATE puis DELETE) ─────────────────────────
  if (toInsert.length > 0) {
    const { error: insErr } = await supabaseAdmin.from('matches').insert(toInsert)
    if (insErr) {
      console.error('[reconcile] insert failed', insErr.message)
      throw new Error(`[reconcile] insert failed: ${insErr.message}`)
    }
    stats.inserted = toInsert.map((r) => ({ profile_id: r.profile_id, publication_id: r.publication_id }))
  }

  // ── LES MISES À JOUR PARTENT EN UNE SEULE ÉCRITURE ───────────────────────
  //  Elles partaient UNE PAR UNE. Invisible à dix profils, fatal à dix mille :
  //  dix mille allers-retours pour une seule annonce, et un run qui n'a plus
  //  aucune chance de tenir dans un budget de temps. Le plafond de vivier
  //  masquait le problème ; il n'y a plus de plafond.
  //
  //  La fonction SQL ne cite jamais `status` : elle ne peut donc pas le remettre
  //  à 'pending', ce qui était le bug d'origine de la réconciliation.
  if (toUpdate.length > 0) {
    const PAQUET = 500
    for (let i = 0; i < toUpdate.length; i += PAQUET) {
      const tranche = toUpdate.slice(i, i + PAQUET)
      const { data: touchees, error: updErr } = await supabaseAdmin.rpc(
        'appliquer_scores_de_pertinence',
        { p_lignes: tranche },
      )
      if (updErr) {
        // Best-effort assumé : on n'arrête pas le run sur une tranche. Mais on
        // le DIT — une mise à jour muette ferait croire à des scores frais sur
        // des matches restés vieux.
        console.error('[reconcile] tranche de scores NON appliquée', {
          taille: tranche.length,
          message: updErr.message,
        })
        continue
      }
      stats.updated += typeof touchees === 'number' ? touchees : tranche.length
    }
  }

  if (toDeleteIds.length > 0) {
    const { error: delErr } = await supabaseAdmin
      .from('matches')
      .delete()
      .in('id', toDeleteIds)
    if (delErr) {
      console.error('[reconcile] delete failed', delErr.message)
      // Best-effort.
    } else {
      stats.deleted = toDeleteIds.length
    }
  }

  return stats
}
