import type { SupabaseClient } from '@supabase/supabase-js'
import {
  verifyAiPublicationQuality,
  BLOCKING_FLAGS,
  type PublicationQualityInput,
  type PublicationQualityFlag,
} from './ai-publication-quality'

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

async function loadProviderThreshold(
  supabaseAdmin: SupabaseClient,
): Promise<{ threshold: number; active: boolean }> {
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
    return { threshold: 0, active: false }
  }
  if (!data) {
    return { threshold: 0, active: false }
  }
  const row = data as unknown as ProviderRow
  return { threshold: row.confidence_threshold, active: true }
}

export async function runPublicationVerification(args: {
  supabaseAdmin: SupabaseClient
  publication_id: string
  input: PublicationQualityInput
}): Promise<PublicationVerdict> {
  const { supabaseAdmin, input } = args

  // 1. Provider lookup ─────────────────────────────────────────────────────
  const { threshold, active } = await loadProviderThreshold(supabaseAdmin)
  if (!active) {
    // Provider inactif / absent / lookup en erreur → pending_review sûre.
    return {
      status: 'pending_review',
      score: 0,
      method: 'ai_publication_quality',
      data: {
        score: 0,
        notes: `Provider IA '${PROVIDER_TYPE}' inactif ou non configuré — passage en revue admin.`,
        flags: [],
      },
    }
  }

  // 2. Appel IA ────────────────────────────────────────────────────────────
  const ai = await verifyAiPublicationQuality(input)

  // 3. Décision ────────────────────────────────────────────────────────────
  // 'published' SI score >= threshold ET pas de flag bloquant.
  // Sinon 'pending_review'. JAMAIS 'rejected' automatique.
  const hasBlockingFlag = ai.flags.some((f) =>
    (BLOCKING_FLAGS as readonly PublicationQualityFlag[]).includes(f),
  )
  const isPublished =
    ai.result === 'ok' && ai.score >= threshold && !hasBlockingFlag

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
