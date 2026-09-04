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

import type { CandidatureFacetCounts } from '@/lib/candidatures/facets'

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
 * Entonnoir candidatures par annonce, VENTILÉ PAR FACETTE
 * (lib/candidatures/facets.ts).
 *
 * POURQUOI PLUS PAR STATUT
 *   L'entonnoir comptait sur `candidatures.status` regroupé, puis ventilait le
 *   résultat par bucket d'état de vie. Deux vocabulaires pour un seul fait, et
 *   un piège structurel : « Refusées » lisait le bucket ACTIF alors qu'une
 *   candidature refusée est archivée par définition — la tuile ne pouvait
 *   afficher que 0, à vie. Le même piège avait déjà été retiré des accueils
 *   experts ; l'accueil entreprise et la carte annonce l'avaient conservé.
 *
 *   Les facettes sont dérivées de `lifecycle.reason`, c'est-à-dire de la MÊME
 *   grandeur que celle sur laquelle les listes de candidatures filtrent
 *   (`?facet=`). Un compteur et la liste qu'il ouvre ne peuvent plus diverger,
 *   et chaque facette porte son propre bucket : « Refusées » compte là où les
 *   refus vivent.
 *
 * PARTITION COMPLÈTE : la somme des 7 facettes vaut `total`. Les raisons que
 * l'ancien entonnoir ne comptait nulle part (annonce expirée, annonce retirée,
 * échange clos, retrait) ont maintenant leur case.
 */
export type AnnonceCandidatures = {
  /** Toutes candidatures confondues (actives + archivées). */
  total: number
  /** Nombre de candidatures du bucket actif. */
  active: number
  /** Nombre de candidatures du bucket archivé. */
  archived: number
  /** Répartition fine — clés de `CandidatureFacet`. */
  facets: CandidatureFacetCounts
}

export type Annonce = {
  id: string
  type: AnnonceType
  title: string
  status: AnnonceStatus
  branch_label: string | null
  /**
   * SPÉCIALITÉS — multiple, libellés déjà traduits.
   *
   * Remplace `speciality_label` au singulier. Ce n'est pas une commodité
   * d'affichage : une annonce peut légitimement viser deux spécialités
   * voisines, et n'en déclarer qu'une la rendait invisible aux experts de
   * l'autre — sans que personne puisse dire pourquoi.
   */
  speciality_labels: string[]
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
  /**
   * ZONES DE TRAVAIL — libellés déjà traduits, prêts à afficher.
   *
   * Remplace l'ancien `location`, texte libre qui servait à la fois de critère
   * supposé et d'affichage. Ce sont désormais deux choses distinctes : les
   * zones FILTRENT (elles sont opposables, déclarées des deux côtés du marché,
   * et le moteur les recoupe), `location_note` n'est qu'une précision affichée.
   */
  work_zone_labels: string[]
  /**
   * Précision d'affichage (« Paris ou Lyon »). NE FILTRE RIEN — et le
   * formulaire le dit à celui qui la saisit, sans quoi il croirait restreindre
   * quelque chose.
   */
  location_note: string | null
  work_mode: string | null
  duration: string | null
  start_date: string | null
  /** SÉNIORITÉS — multiple : une mission peut chercher « confirmé OU senior ». */
  seniorities: string[]
  confidential: boolean
}
