/**
 * Type partagé pour les annonces affichées dans le dashboard organisation.
 *
 * Lot 1b.1 : alignement strict sur les 7 valeurs de `publications.status` en BDD.
 * Le statut UI = statut BDD (pas de mapping). Les onglets dashboard regroupent
 * plusieurs statuts (cf. OrganisationDashboard.tsx).
 *
 * Le DTO est servi par GET /api/publications après projection serveur :
 *   - branch_label / speciality_label = nom localisé (via tBDD, fallback nom BDD)
 *   - verification_score = score IA si déjà gate-é (publish gate du Lot 1a)
 *   - candidatures = compteurs agrégés depuis la table candidatures
 *     (V1 : tous à 0 — Lot 2 branchera le vrai calcul)
 *   - JAMAIS de verification_data / verification_method / review_reason
 *     (fuite admin → on les expose dans /admin/* uniquement)
 *
 * Champs sensibles NON exposés ici : verification_data, verification_method,
 * review_reason, verified_by, verified_at, expires_at, description complète,
 * skills_required (réservés à la vue détail si pertinents).
 */

export type AnnonceStatus =
  | 'draft'
  | 'pending_review'
  | 'published'
  | 'suspended'
  | 'expired'
  | 'archived'
  | 'rejected'

// 'sous_traitance' : besoin publié par un EXPERT (via son organisation
// personnelle) et matché à d'autres experts — collaboration entre pairs.
export type AnnonceType = 'mission' | 'offre' | 'sous_traitance'

/**
 * Unité de budget. V1 sans colonne `budget_unit` en BDD : dérivée du type
 * côté serveur dans le DTO (mission → 'day', offre → 'year'). Le client
 * n'a pas à recalculer.
 */
export type AnnonceBudgetUnit = 'day' | 'month' | 'year' | 'mission'

/**
 * Entonnoir candidatures par annonce (Lot refonte dashboard org).
 *
 * 4 buckets EXCLUSIFS qui s'additionnent au total :
 *   - to_review   : 'received' + 'in_review' + 'shortlisted'  (à consulter)
 *   - in_progress : 'unlocked'                                (échanges en cours)
 *   - accepted    : 'selected'                                (candidature acceptée)
 *   - rejected    : 'rejected'                                (candidature refusée)
 *   - total       = to_review + in_progress + accepted + rejected
 *
 * 'withdrawn' / 'archived' = hors-funnel V1, ne sont comptés nulle part.
 *
 * Codes ANGLAIS pour cohérence avec les statuts DB ; les libellés FR
 * ("À consulter", "Échanges en cours", "Acceptées", "Refusées") vivent
 * dans messages/{fr,en,es,de}.json — clés dashboard_entreprise.funnel.*.
 */
export type AnnonceCandidatureFunnel = {
  total: number
  to_review: number
  in_progress: number
  accepted: number
  rejected: number
}

/**
 * Entonnoir VENTILÉ PAR ÉTAT DE VIE dérivé (lib/candidatures/lifecycle.ts).
 *
 * POURQUOI DEUX ENTONNOIRS ET PAS UN
 *   Le statut brut ne dit pas si une candidature est encore vivante. Sur une
 *   annonce expirée ou clôturée, une candidature 'received' reste 'received' —
 *   la carte annonçait « 3 à consulter » pendant que l'onglet « Actives » de la
 *   page candidatures (bucket par défaut) en affichait 0. Le compteur et sa
 *   liste dérivent maintenant du MÊME helper.
 *
 * Les cartes affichent `active`. `archived` est exposé — pas masqué — pour
 *   qu'un écran futur n'ait pas à le recalculer, et parce que « 0 à consulter »
 *   sans dire qu'il y a 3 candidatures rangées serait une autre demi-vérité.
 */
export type AnnonceCandidatures = {
  active: AnnonceCandidatureFunnel
  archived: AnnonceCandidatureFunnel
}

export type Annonce = {
  id: string
  type: AnnonceType
  title: string
  status: AnnonceStatus
  branch_label: string | null
  speciality_label: string | null
  budget_min: number | null
  budget_max: number | null
  budget_unit: AnnonceBudgetUnit
  /** Score IA 0..10 si la publi a déjà été soumise au gate. Null sinon. */
  verification_score: number | null
  /** ISO. Toujours présent. */
  created_at: string
  /** ISO. Null si la publi n'a jamais été passée en 'published'. */
  published_at: string | null
  candidatures: AnnonceCandidatures
  /** Lot synthèse parlante — champs publi enrichis pour <PublicationSynthesisLine>. */
  location: string | null
  work_mode: string | null
  duration: string | null
  start_date: string | null
  seniority: string | null
  confidential: boolean
}
