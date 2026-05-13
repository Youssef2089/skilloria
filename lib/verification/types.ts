/**
 * Types partagés pour la couche `lib/verification/*`.
 *
 * Note : `lib/database.types.ts` a été généré AVANT l'exécution de la
 * migration B1 ; il ne contient donc pas encore `verification_providers`
 * ni `verification_attempts`. On définit les types localement ici pour
 * ne pas bloquer B2.b/B2.c. Quand `database.types.ts` sera régénéré,
 * on pourra basculer ces types vers
 *   Database['public']['Tables']['verification_providers']['Row']
 * sans changer les call-sites.
 */

export type VerificationProviderRow = {
  id: string
  country_code: string
  provider_type: string
  provider_name: string
  api_endpoint: string | null
  api_key_secret_ref: string | null
  is_active: boolean
  priority: number
  confidence_threshold: number
  created_at: string
  updated_at: string
}

export type VerificationStatus =
  | 'pending_provider_check'
  | 'pending_admin_review'
  | 'approved'
  | 'rejected'
  | 'requires_more_info'

export type VerificationMethod = 'official_api' | 'ai_web_search' | 'manual_admin'

export type VerificationResult = 'approved' | 'rejected' | 'inconclusive' | 'error'

/** Données envoyées par `register-org` au dispatcher. */
export type VerificationInput = {
  country_code: string
  company_name: string
  email_domain: string
  siren?: string | null
  vat_number?: string | null
}

/** Réponse standardisée d'un provider individuel. */
export type VerificationOutput = {
  result: VerificationResult
  confidence_score: number // 0..10
  raw_response: unknown
  provider_name: string
  /** Raison lisible (utile en cas de `rejected` ou `inconclusive`). */
  notes?: string
}

/** Verdict final retourné par `runVerification()` au caller. */
export type VerificationVerdict = {
  verification_status: VerificationStatus
  verification_method: VerificationMethod | null
  verification_data: {
    score: number
    notes?: string
    last_provider?: string
    attempts_count: number
    /**
     * Drapeau diagnostic : au moins 1 provider a voté 'rejected' pendant la
     * chaîne, mais le verdict final n'est jamais 'rejected' automatique (cf.
     * règle métier figée). Info admin uniquement.
     */
    had_rejection?: boolean
    /** Liste des provider_name qui ont voté 'rejected' (info admin). */
    rejected_by?: string[]
  }
}
