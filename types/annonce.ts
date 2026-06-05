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

export type AnnonceType = 'mission' | 'offre'

/**
 * Unité de budget. V1 sans colonne `budget_unit` en BDD : dérivée du type
 * côté serveur dans le DTO (mission → 'day', offre → 'year'). Le client
 * n'a pas à recalculer.
 */
export type AnnonceBudgetUnit = 'day' | 'month' | 'year' | 'mission'

export type AnnonceCandidatures = {
  recues: number
  nouvelles: number
  en_discussion: number
  retenues: number
  refusees: number
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
