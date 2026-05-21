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
 *
 * 11G — Vérification cohérence systématique :
 *   - L'IA n'est plus un fallback, c'est le décideur systématique.
 *   - Sirene devient un fournisseur de données (jamais d'`approved` direct).
 *   - VerificationInput étendu pour passer plus de champs comparables.
 *   - VerificationOutput peut transporter `structured_data` (Sirene → IA).
 *   - VerificationVerdict.verification_data trace `sirene_data` + `discrepancies`.
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

/**
 * Données envoyées par `register-org` / `finalize-org` au dispatcher.
 *
 * 11G : étendu avec `website_url` et `org_type` (saisis en modale post-login)
 * pour permettre à l'IA de les comparer aux données INSEE / au nom déclaré.
 */
export type VerificationInput = {
  country_code: string
  company_name: string
  email_domain: string
  siren?: string | null
  vat_number?: string | null
  /** Site web saisi (URL absolue). 11G — comparé au nom de domaine INSEE / email_domain. */
  website_url?: string | null
  /** Sous-type métier choisi en modale ('client' | 'cabinet' | 'esn'). 11G — comparé à la catégorie juridique INSEE. */
  org_type?: string | null
}

/**
 * Snapshot des données INSEE extraites par Sirene (11G).
 *
 * Transmis à l'IA pour analyse de cohérence, et persisté dans
 * `verification_data.sirene_data` pour traçabilité côté admin.
 *
 * Tous champs nullable car l'API Sirene peut les omettre selon le type
 * d'unité légale (personne physique vs morale, dissolution, etc.).
 */
export type SireneData = {
  /** Raison sociale officielle (personne morale). */
  denomination: string | null
  /** Sigle / nom usuel. */
  sigle: string | null
  /** Pour personne physique uniquement. */
  prenom_nom: string | null
  /** État administratif INSEE : 'A' (actif) | 'C' (cessé) | autre. */
  etat_administratif: string | null
  /** Code de forme juridique INSEE (ex: '5710' = SAS, '5499' = SARL, '1000' = entrepreneur indiv.). */
  categorie_juridique: string | null
  /** Code APE / NAF de l'activité principale (ex: '6201Z' = programmation info). */
  activite_principale: string | null
  /** Date de création de l'unité légale (ISO date). */
  date_creation: string | null
  /** Tranche d'effectifs INSEE (code). */
  tranche_effectifs: string | null
  /** Adresse complète assemblée à partir des champs Sirene. */
  adresse_complete: string | null
}

/**
 * Réponse standardisée d'un provider individuel.
 *
 * 11G : ajout optionnel `structured_data` pour permettre à Sirene de
 * transporter les champs INSEE bruts vers l'IA décideuse en aval.
 */
export type VerificationOutput = {
  result: VerificationResult
  confidence_score: number // 0..10
  raw_response: unknown
  provider_name: string
  /** Raison lisible (utile en cas de `rejected` ou `inconclusive`). */
  notes?: string
  /** 11G — données INSEE structurées (Sirene uniquement). */
  structured_data?: SireneData | null
  /** 11G — écarts détectés par l'IA entre données saisies et INSEE. */
  discrepancies?: string[]
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
    /** 11G — snapshot des données INSEE comparées (audit + affichage admin). */
    sirene_data?: SireneData | null
    /** 11G — liste textuelle des écarts détectés par l'IA (affichée fiche admin). */
    discrepancies?: string[]
  }
}
