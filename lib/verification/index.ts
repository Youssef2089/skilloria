import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  VerificationInput,
  VerificationOutput,
  VerificationProviderRow,
  VerificationVerdict,
  VerificationMethod,
} from './types'
import { verifyWithSirene } from './sirene'
import { verifyWithCompaniesHouse } from './companies-house'
import { verifyWithAiFallback } from './ai-fallback'

/**
 * Dispatcher de vérification entreprise.
 *
 * Lit `verification_providers WHERE country_code=X AND is_active`
 * triés par `priority ASC`, itère séquentiellement, insère un row dans
 * `verification_attempts` à chaque tentative, et retourne un verdict final
 * que `register-org` / `finalize-org-registration` écrira dans `organizations`.
 *
 * Logique du verdict (règle métier figée — JAMAIS de rejected automatique) :
 *   - 1er provider qui retourne `approved` ET confidence ≥ threshold
 *     → verdict='approved'. Short-circuit ici.
 *   - Sinon, on enchaîne TOUS les providers (Sirene → IA, etc.) — un
 *     `rejected` d'un provider n'arrête PAS la chaîne, il est juste tracké
 *     dans `had_rejection` + `rejected_by[]` pour info admin.
 *   - À la fin : si aucun provider n'a `approved`, verdict est
 *     `pending_admin_review` (l'admin tranche en dernier ressort).
 *
 * → Aucun verdict final ne peut JAMAIS être `rejected` automatiquement.
 */

type ProviderFn = (input: VerificationInput) => Promise<VerificationOutput>

const PROVIDER_REGISTRY: Record<string, ProviderFn> = {
  sirene_insee: verifyWithSirene,
  companies_house_uk: verifyWithCompaniesHouse,
  claude_web_fallback: verifyWithAiFallback,
}

function methodFromProviderType(type: string): VerificationMethod | null {
  if (type === 'official_api') return 'official_api'
  if (type === 'ai_web_search') return 'ai_web_search'
  if (type === 'manual_only') return 'manual_admin'
  return null
}

export async function runVerification(args: {
  supabaseAdmin: SupabaseClient
  organization_id: string
  input: VerificationInput
}): Promise<VerificationVerdict> {
  const { supabaseAdmin, organization_id, input } = args

  const { data: providers, error: provErr } = await supabaseAdmin
    .from('verification_providers')
    .select('*')
    .eq('country_code', input.country_code)
    .eq('is_active', true)
    .order('priority', { ascending: true })
    .returns<VerificationProviderRow[]>()

  if (provErr) {
    console.error('[verification:index] providers lookup error', provErr.message)
  }

  const list: VerificationProviderRow[] = providers ?? []

  if (list.length === 0) {
    // Aucun provider configuré pour ce pays → review admin direct.
    return {
      verification_status: 'pending_admin_review',
      verification_method: null,
      verification_data: {
        score: 0,
        notes: `Aucun provider actif pour le pays ${input.country_code}`,
        attempts_count: 0,
      },
    }
  }

  let attempts_count = 0
  let lastOutput: VerificationOutput | null = null
  let lastProvider: VerificationProviderRow | null = null
  // Tracking diagnostic : provider(s) qui ont voté 'rejected' pendant la
  // chaîne (info admin uniquement — n'influe plus sur le verdict final
  // depuis B3.4-fix, cf. règle "JAMAIS de rejected automatique").
  let had_rejection = false
  const rejected_by: string[] = []

  for (const provider of list) {
    const fn = PROVIDER_REGISTRY[provider.provider_name]
    if (!fn) {
      console.warn('[verification:index] unknown provider in registry', {
        provider_name: provider.provider_name,
      })
      continue
    }

    const output = await fn(input)
    attempts_count++
    lastOutput = output
    lastProvider = provider

    // Insert attempt (best-effort, on continue même en cas d'erreur d'insert)
    const triggeredAdminReview =
      output.result !== 'approved' && output.result !== 'rejected'
    try {
      const { error: insErr } = await supabaseAdmin
        .from('verification_attempts')
        .insert({
          organization_id,
          provider_used: output.provider_name,
          result: output.result,
          confidence_score: output.confidence_score,
          raw_response: output.raw_response as never,
          triggered_admin_review: triggeredAdminReview,
        })
      if (insErr) {
        console.error('[verification:index] attempt insert failed', insErr.message)
      }
    } catch (err) {
      console.error('[verification:index] attempt insert threw', err)
    }

    if (output.result === 'rejected') {
      // Tracking pour info admin. Ne short-circuite plus la chaîne — on
      // continue jusqu'au provider IA qui pourrait sauver le verdict.
      had_rejection = true
      rejected_by.push(output.provider_name)
    }

    if (
      output.result === 'approved' &&
      output.confidence_score >= provider.confidence_threshold
    ) {
      return {
        verification_status: 'approved',
        verification_method: methodFromProviderType(provider.provider_type),
        verification_data: {
          score: output.confidence_score,
          notes: output.notes,
          last_provider: output.provider_name,
          attempts_count,
          ...(had_rejection ? { had_rejection, rejected_by } : {}),
        },
      }
    }
    // Sinon (rejected, inconclusive, error, ou approved-mais-sous-threshold) :
    // on enchaîne sur le provider suivant.
  }

  return {
    verification_status: 'pending_admin_review',
    verification_method: lastProvider
      ? methodFromProviderType(lastProvider.provider_type)
      : null,
    verification_data: {
      score: lastOutput?.confidence_score ?? 0,
      notes: lastOutput?.notes ?? 'Aucun provider concluant',
      last_provider: lastOutput?.provider_name,
      attempts_count,
      ...(had_rejection ? { had_rejection, rejected_by } : {}),
    },
  }
}

export type { VerificationInput, VerificationOutput, VerificationVerdict } from './types'
