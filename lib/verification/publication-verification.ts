import type { SupabaseClient } from '@supabase/supabase-js'
import {
  verifyAiPublicationQuality,
  BLOCKING_FLAGS,
  type PublicationQualityInput,
  type PublicationQualityFlag,
} from './ai-publication-quality'
import { budgetDisponible, enregistrerDepenseIA } from '@/lib/ai-budget'

/**
 * Dispatcher de vérification d'une PUBLICATION.
 *
 * Flux SÉPARÉ de la vérification ORG (lib/verification/index.ts) :
 *   1. Charge le row verification_providers (provider_type='opportunity_quality_check').
 *      Inactif / absent → 'pending_review' SÛRE (pas de fallback IA aveugle).
 *   2. Appelle verifyAiPublicationQuality avec le contenu de l'annonce.
 *   3. Décision :
 *        - 'published' SI score >= threshold ET aucun flag bloquant
 *          ('contact_info' / 'discriminatory' / 'illegal')
 *        - 'pending_review' sinon (admin tranche)
 *      JAMAIS 'rejected' automatique.
 *
 * Pas d'écriture dans verification_attempts (consigne Lot 1a) : le verdict
 * est stocké directement sur la ligne publications (verification_score /
 * verification_method / verification_data) par le caller (route publish).
 */

const PROVIDER_TYPE = 'opportunity_quality_check'

export type PublicationVerdictStatus = 'published' | 'pending_review'

export type PublicationVerdictData = {
  score: number
  notes: string
  flags: PublicationQualityFlag[]
}

export type PublicationVerdict = {
  status: PublicationVerdictStatus
  score: number
  method: 'ai_publication_quality'
  data: PublicationVerdictData
}

type ProviderRow = {
  confidence_threshold: number
  is_active: boolean
}

/**
 * Le seuil, ou la RAISON de son absence. Jamais les deux, jamais un nombre
 * fabriqué à côté d'un drapeau.
 *
 * ═══ POURQUOI CETTE FORME ════════════════════════════════════════════════
 *   Cette fonction rendait `{ threshold: 0, active: false }`. Le `0` était
 *   neutralisé par le drapeau, donc inoffensif — mais c'est LA FORME qui est le
 *   piège : un nombre inventé posé à côté de son invalidant survit au premier
 *   appelant qui lit `threshold` sans lire `active`. Et « seuil 0 » veut dire
 *   « tout passe », soit exactement l'inverse du refus voulu.
 *
 *   Un type somme rend l'erreur IMPOSSIBLE à écrire : il n'y a pas de
 *   `threshold` à lire quand il n'y en a pas.
 */
type Reglage = { ok: true; threshold: number } | { ok: false; raison: string }

async function loadProviderThreshold(supabaseAdmin: SupabaseClient): Promise<Reglage> {
  const { data, error } = await supabaseAdmin
    .from('verification_providers')
    .select('confidence_threshold, is_active')
    .eq('provider_type', PROVIDER_TYPE)
    .eq('is_active', true)
    .order('priority', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[publication-verification] provider lookup failed', error.message)
    return { ok: false, raison: `lecture du fournisseur impossible : ${error.message}` }
  }
  if (!data) {
    return { ok: false, raison: `aucun fournisseur '${PROVIDER_TYPE}' actif` }
  }
  const row = data as unknown as ProviderRow
  return { ok: true, threshold: row.confidence_threshold }
}

export async function runPublicationVerification(args: {
  supabaseAdmin: SupabaseClient
  publication_id: string
  /**
   * L'organisation qui publie — elle DÉCLENCHE le contrôle qualité, donc elle
   * le porte. Transmise par l'appelant plutôt que relue ici : la route de
   * publication l'a déjà en main, et une relecture serait une requête de plus
   * pour une valeur déjà connue.
   */
  organization_id: string
  input: PublicationQualityInput
}): Promise<PublicationVerdict> {
  const { supabaseAdmin, input } = args

  // 1. Provider lookup ─────────────────────────────────────────────────────
  const reglage = await loadProviderThreshold(supabaseAdmin)
  if (!reglage.ok) {
    // Provider inactif / absent / lookup en erreur → pending_review sûre, avec
    // la RAISON exacte plutôt qu'un motif générique : c'est elle qui dit à
    // l'admin s'il doit activer une ligne ou réparer une panne de lecture.
    return {
      status: 'pending_review',
      score: 0,
      method: 'ai_publication_quality',
      data: {
        score: 0,
        notes: `Contrôle qualité non applicable — ${reglage.raison}. Passage en revue admin.`,
        flags: [],
      },
    }
  }

  // 2. Appel IA ────────────────────────────────────────────────────────────
  // ── LE PLAFOND EST CONSULTÉ AVANT D'APPELER ──────────────────────────────
  //  Un point qui enregistre mais ne regarde jamais le plafond dépense au-delà.
  //  FAIL-CLOSED assumé (lib/ai-budget.ts) : sur panne de lecture on REFUSE.
  //  Ne pas savoir combien on a dépensé n'autorise pas à dépenser plus — c'est
  //  l'exception au fail-open du reste du projet, et elle protège de l'argent.
  //  Au plafond : l’annonce part en revue manuelle, jamais publiée sans examen.
  //  Le MÊME acteur qu'à l'enregistrement plus bas (§E.39).
  const budget = await budgetDisponible(supabaseAdmin, 'claude', {
    acteur: { type: 'organization', id: args.organization_id },
    action: 'publication_quality',
  })
  if (!budget.ok) {
    console.error('[publication-verification] contrôle refusé — budget', budget.raison)
    return {
      status: 'pending_review',
      score: 0,
      method: 'ai_publication_quality',
      data: { score: 0, notes: 'Plafond de dépense IA atteint — revue admin. ' + budget.raison, flags: [] },
    }
  }

  const ai = await verifyAiPublicationQuality(input)

  // ── LA DÉPENSE, ENREGISTRÉE QUE L'APPEL AIT ABOUTI OU NON ──────────────
  if (ai.usage) {
    await enregistrerDepenseIA(supabaseAdmin, {
      provider: 'claude',
      action: 'publication_quality',
      acteur: { type: 'organization', id: args.organization_id },
      consommation: ai.usage,
      context: { publication_id: args.publication_id },
    })
  }

  // 3. Décision ────────────────────────────────────────────────────────────
  // 'published' SI score >= threshold ET pas de flag bloquant.
  // Sinon 'pending_review'. JAMAIS 'rejected' automatique.
  const hasBlockingFlag = ai.flags.some((f) =>
    (BLOCKING_FLAGS as readonly PublicationQualityFlag[]).includes(f),
  )
  const isPublished =
    ai.result === 'ok' && ai.score >= reglage.threshold && !hasBlockingFlag

  return {
    status: isPublished ? 'published' : 'pending_review',
    score: ai.score,
    method: 'ai_publication_quality',
    data: {
      score: ai.score,
      notes: ai.notes,
      flags: ai.flags,
    },
  }
}
