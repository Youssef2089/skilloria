/**
 * Type partagé pour les annonces affichées dans le dashboard organisation.
 *
 * Source de vérité unique (réutilisé par AnnonceCard + OrganisationDashboard).
 *
 * V1 (B3.5) : aucune table d'annonces n'existe en BDD (la table `opportunities`
 * existante est un héritage incompatible : owner_id sur users, pas de relation
 * candidatures, statut libre). Le dashboard charge donc `annonces: []` —
 * empty state permanent. Quand la vraie table sera créée (B4+), ce type
 * devra rester compatible (ou évoluer ici en 1 seul endroit).
 *
 * TODO B4+ : le contenu d'annonce multilingue ne pourra PAS appeler tBDD()
 * directement depuis ce composant client (loadTranslations instancie un
 * client admin serveur-only). Deux options : (a) route API
 * /api/taxonomy?locale=, ou (b) rendu des annonces via un Server Component
 * parent.
 */

export type AnnonceStatus = 'published' | 'in_discussion' | 'closed'

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
  title: string
  status: AnnonceStatus
  /** ISO string. Null si jamais publiée (V1 : non utilisé). */
  published_at: string | null
  /** ISO string. Non null uniquement si status='closed'. */
  closed_at: string | null
  budget_min: number | null
  budget_max: number | null
  budget_unit: AnnonceBudgetUnit
  candidatures: AnnonceCandidatures
}
