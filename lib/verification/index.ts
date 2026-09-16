import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  SireneData,
  VerificationInput,
  VerificationOutput,
  VerificationProviderRow,
  VerificationVerdict,
} from './types'
import { verifyWithSirene } from './sirene'
import { verifyAiCoherence } from './ai-fallback'
import { budgetDisponible, enregistrerDepenseIA } from '@/lib/ai-budget'

/**
 * Dispatcher de vérification entreprise — flow déterministe (11G).
 *
 * Refacto majeur 11G : l'IA n'est plus un fallback, c'est le DÉCIDEUR
 * SYSTÉMATIQUE de cohérence. Sirene devient un fournisseur de données.
 *
 * Flux :
 *   1. Sirene fetch (si country=FR + siren fourni)
 *      → extrait sireneData (raison sociale, forme juridique, APE, état, ...)
 *      → résultat 'inconclusive' systématique (Sirene NE TRANCHE PLUS)
 *      → si échec/404/erreur : sireneData=null, on continue
 *   2. IA Claude (TOUJOURS, peu importe Sirene) reçoit (input, sireneData)
 *      → compare champ par champ, produit score + notes + discrepancies[]
 *   3. Décision finale :
 *      → threshold = confidence_threshold du row provider_type='ai_web_search'
 *        pour ce country_code (sémantique par TYPE, pas par nom — D5/11G)
 *      → AUCUN row trouvé ⇒ REFUS EXPLICITE : pending_admin_review, motif nommé,
 *        et AUCUN appel IA. Il n'existe plus de seuil de repli (cf. encadré).
 *      → score >= threshold → 'approved'
 *      → score < threshold  → 'pending_admin_review'
 *      → JAMAIS 'rejected' automatique (règle métier figée)
 *
 * verification_method posé selon disponibilité Sirene :
 *   → 'official_api'  si sireneData != null (IA a comparé avec INSEE)
 *   → 'ai_web_search' si sireneData == null (IA sur saisi seul)
 *
 * verification_data trace TOUT : score, notes IA, sirene_data, discrepancies,
 * last_provider, attempts_count.
 */

/**
 * ═══ IL N'Y A PLUS DE SEUIL DE REPLI, ET C'EST LE SUJET DE CE BLOC ═══════════
 *
 * Ce module portait `FALLBACK_DECISION_THRESHOLD = 7`, utilisé quand aucun
 * provider n'est configuré pour le pays. Trois choses le condamnaient :
 *
 *  ① LES DEUX AUTRES CHEMINS DE VÉRIFICATION ÉCHOUENT FERMÉ, ET LE DISENT.
 *    Configuration absente ⇒ `expert-verification` pose `pending_admin_review`
 *    avec le motif « provider non configuré » ; `publication-verification` rend
 *    `pending_review` avec le même genre de note. Seul celui-ci DEVINAIT un
 *    nombre, et ne le disait pas. Trois replis pour une même absence, dont un
 *    qui invente.
 *
 *  ② UN REPLI CODÉ EN DUR EST UN SECOND RÉGLAGE, INVISIBLE, qui prend la main
 *    le jour où l'on comprend le moins ce qui se passe. C'est la règle déjà
 *    écrite pour `matching_settings` : ligne absente ⇒ on refuse, et on le dit.
 *
 *  ③ IL MENTAIT DÉJÀ. L'en-tête de ce fichier annonçait « fallback threshold =
 *    9 » pendant que la constante valait 7. Personne ne pouvait le voir sans
 *    lire les deux.
 *
 * CE QUI SE PASSE DÉSORMAIS, ET POURQUOI ON N'APPELLE MÊME PAS L'IA :
 *   Sans seuil, aucun score ne peut être tranché — l'appel serait payé pour
 *   produire une décision qu'on ne sait pas prendre. On rend donc
 *   `pending_admin_review` AVANT toute dépense, avec un motif nommé, exactement
 *   comme les deux autres chemins. La règle métier « jamais de rejet
 *   automatique » est préservée : un refus de configuration n'est pas un refus
 *   d'organisation.
 */
const MOTIF_SANS_SEUIL =
  "Aucun fournisseur de décision actif pour ce pays (provider_type='ai_web_search') — " +
  'seuil introuvable, vérification manuelle requise. Aucun appel IA n’a été fait.'

function findDecisionProvider(
  providers: VerificationProviderRow[],
  countryCode: string,
): VerificationProviderRow | null {
  // Sémantique par TYPE (pas par nom) : le décideur du nouveau flow est le
  // row de type 'ai_web_search' pour ce pays. Si plusieurs (improbable),
  // on prend celui de priorité la plus haute (priority asc).
  const matches = providers
    .filter((p) => p.country_code === countryCode && p.is_active && p.provider_type === 'ai_web_search')
    .sort((a, b) => a.priority - b.priority)
  return matches[0] ?? null
}

function findSireneProvider(
  providers: VerificationProviderRow[],
  countryCode: string,
): VerificationProviderRow | null {
  // V1 : Sirene = seul provider de type 'official_api' pour FR. Si on
  // ajoute Companies House UK plus tard, on pourra brancher par
  // provider_name='sirene_insee' explicitement.
  const matches = providers.filter(
    (p) => p.country_code === countryCode && p.is_active && p.provider_type === 'official_api',
  )
  return matches[0] ?? null
}

async function logAttempt(args: {
  supabaseAdmin: SupabaseClient
  organization_id: string
  output: VerificationOutput
}): Promise<void> {
  const { supabaseAdmin, organization_id, output } = args
  const triggeredAdminReview =
    output.result !== 'approved' && output.result !== 'rejected'
  try {
    const { error } = await supabaseAdmin.from('verification_attempts').insert({
      organization_id,
      provider_used: output.provider_name,
      result: output.result,
      confidence_score: output.confidence_score,
      raw_response: output.raw_response as never,
      triggered_admin_review: triggeredAdminReview,
    })
    if (error) {
      console.error('[verification:index] attempt insert failed', error.message)
    }
  } catch (err) {
    console.error('[verification:index] attempt insert threw', err)
  }
}

export async function runVerification(args: {
  supabaseAdmin: SupabaseClient
  organization_id: string
  input: VerificationInput
}): Promise<VerificationVerdict> {
  const { supabaseAdmin, organization_id, input } = args

  // ── Charger les providers configurés pour ce pays ───────────────────────
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

  const providerList: VerificationProviderRow[] = providers ?? []
  const sireneProvider = findSireneProvider(providerList, input.country_code)
  const decisionProvider = findDecisionProvider(providerList, input.country_code)
  // ── PAS DE SEUIL ⇒ REFUS EXPLICITE, AVANT TOUTE DÉPENSE ──────────────────
  //  On sort ICI, avant Sirene et avant l'IA : cf. l'encadré en tête de fichier.
  if (!decisionProvider) {
    console.error('[verification:index] aucun provider de décision', {
      country_code: input.country_code,
      organization_id,
    })
    return {
      verification_status: 'pending_admin_review',
      verification_method: null,
      verification_data: {
        score: 0,
        notes: MOTIF_SANS_SEUIL,
        attempts_count: 0,
        sirene_data: null,
        discrepancies: [],
        sirene_status: 'skipped',
      },
    }
  }
  const threshold = decisionProvider.confidence_threshold

  let attempts_count = 0
  let sireneData: SireneData | null = null
  // Fix Sirene (D4) — exposer le résultat Sirene au verdict pour visibilité
  // admin. 'skipped' par défaut (cas où Sirene n'est pas appelé : country ≠ FR
  // ou pas de SIREN ou pas de row sirene actif).
  let sireneStatus: 'ok' | 'not_found' | 'error' | 'skipped' = 'skipped'
  let sireneErrorNote: string | null = null

  // ── 1. Sirene (fournisseur de données) ──────────────────────────────────
  if (sireneProvider) {
    const sireneOutput = await verifyWithSirene(input)
    attempts_count++
    await logAttempt({ supabaseAdmin, organization_id, output: sireneOutput })
    sireneData = sireneOutput.structured_data ?? null

    // Mapping Sirene result → sirene_status pour le verdict (D4).
    if (sireneOutput.result === 'error') {
      sireneStatus = 'error'
      sireneErrorNote = sireneOutput.notes ?? 'Sirene en erreur'
    } else if (sireneData) {
      sireneStatus = 'ok'
    } else {
      // result='inconclusive' + structured_data null = 404 légitime ou
      // réponse vide. Pour la fiche admin, c'est "not_found".
      sireneStatus = 'not_found'
    }
  }

  // ── 2. IA Claude (DÉCIDEUR systématique) ────────────────────────────────
  if (!decisionProvider) {
    // Cas edge : aucun row 'ai_web_search' configuré pour ce pays.
    // On retourne en review admin avec une note explicite.
    return {
      verification_status: 'pending_admin_review',
      verification_method: null,
      verification_data: {
        score: 0,
        notes: `Aucun analyseur de cohérence IA configuré pour le pays ${input.country_code}`,
        attempts_count,
        sirene_data: sireneData,
        sirene_status: sireneStatus,
        ...(sireneErrorNote ? { sirene_error_note: sireneErrorNote } : {}),
      },
    }
  }

  // Passe sireneStatus à l'IA pour qu'elle puisse appliquer le disqualifiant
  // D4 (Sirene indisponible par défaillance technique → score plafonné à 5).
  // Cf. lib/verification/ai-fallback.ts.
  // ── LE PLAFOND EST CONSULTÉ AVANT D'APPELER ──────────────────────────────
  //  Un point qui enregistre mais ne regarde jamais le plafond dépense au-delà.
  //  FAIL-CLOSED assumé (lib/ai-budget.ts) : sur panne de lecture on REFUSE —
  //  ne pas savoir combien on a dépensé n'autorise pas à dépenser plus.
  //  Au plafond, l'organisation part en revue manuelle. La règle métier
  //  « JAMAIS de rejet automatique » est préservée : un refus de budget n'est
  //  pas un refus d'organisation.
  const budget = await budgetDisponible(supabaseAdmin, 'claude')
  if (!budget.ok) {
    console.error('[verification:index] vérification refusée — budget', budget.raison)
    return {
      verification_status: 'pending_admin_review',
      verification_method: null,
      verification_data: {
        score: 0,
        notes: 'Plafond de dépense IA atteint — vérification manuelle requise. ' + budget.raison,
        attempts_count,
        sirene_data: sireneData,
        sirene_status: sireneStatus,
        ...(sireneErrorNote ? { sirene_error_note: sireneErrorNote } : {}),
      },
    }
  }

  const aiOutput = await verifyAiCoherence(input, sireneData, sireneStatus)

  // ── LA DÉPENSE, ENREGISTRÉE QUE L'APPEL AIT ABOUTI OU NON ────────────────
  //  Une réponse illisible se paie autant qu'une réponse lisible.
  //  N'interrompt jamais : lib/ai-budget.ts ne lève sur aucun chemin.
  if (aiOutput.usage) {
    await enregistrerDepenseIA(supabaseAdmin, {
      provider: 'claude',
      action: 'org_verification',
      // L'organisation demande SA vérification : c'est elle qui déclenche.
      acteur: { type: 'organization', id: organization_id },
      consommation: aiOutput.usage,
    })
  }
  attempts_count++
  await logAttempt({ supabaseAdmin, organization_id, output: aiOutput })

  // ── 3. Décision finale ──────────────────────────────────────────────────
  // Règle métier figée :
  //   - score >= threshold (config BDD)  → approved
  //   - score <  threshold               → pending_admin_review
  //   - JAMAIS rejected auto
  const isApproved =
    aiOutput.result !== 'error' && aiOutput.confidence_score >= threshold

  // verification_method : 'official_api' si on a pu comparer avec INSEE,
  // 'ai_web_search' sinon (saisi seul).
  const method = sireneData ? 'official_api' : 'ai_web_search'

  return {
    verification_status: isApproved ? 'approved' : 'pending_admin_review',
    verification_method: method,
    verification_data: {
      score: aiOutput.confidence_score,
      notes: aiOutput.notes,
      last_provider: aiOutput.provider_name,
      attempts_count,
      sirene_data: sireneData,
      discrepancies: aiOutput.discrepancies ?? [],
      sirene_status: sireneStatus,
      ...(sireneErrorNote ? { sirene_error_note: sireneErrorNote } : {}),
    },
  }
}

export type { VerificationInput, VerificationOutput, VerificationVerdict } from './types'
