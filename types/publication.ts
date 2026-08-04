import type { AnnonceStatus, AnnonceType } from './annonce'

/**
 * Code BDD pour les niveaux de séniorité (stocké en anglais, libellé via i18n).
 * `seniority` est une colonne `text` libre côté schéma — mais le formulaire
 * verrouille les valeurs autorisées à cette enum applicative pour cohérence
 * cross-org et matching IA correct.
 */
export const SENIORITY_CODES = ['junior', 'confirmed', 'senior', 'expert'] as const
export type SeniorityCode = (typeof SENIORITY_CODES)[number]

/**
 * Code BDD pour les modes de travail (idem : text libre BDD, enum applicative).
 */
export const WORK_MODE_CODES = ['remote', 'onsite', 'hybrid'] as const
export type WorkModeCode = (typeof WORK_MODE_CODES)[number]

/**
 * DTO complet d'une publication owner-scopée — retourné par
 * GET /api/publications/[id] et consommé par le formulaire d'édition.
 *
 * Tous les champs éditables sont présents, plus le `status` courant (pour
 * conditionner l'UI : édition autorisée si status ∈ {draft,suspended,archived},
 * publication autorisée si status === 'draft').
 *
 * JAMAIS retourné : verification_data, verification_method, review_reason,
 * verified_by, verified_at, expires_at, organization_id, domain_id, created_by.
 */
export type PublicationDraft = {
  id: string
  type: AnnonceType
  title: string
  description: string
  branch_id: string | null
  speciality_id: string | null
  speciality_other: string | null
  skills_required: string[]
  seniority: string | null
  work_mode: string | null
  location: string | null
  duration: string | null
  start_date: string | null
  budget_min: number | null
  budget_max: number | null
  confidential: boolean
  status: AnnonceStatus
  verification_score: number | null
  created_at: string
  updated_at: string
  published_at: string | null
}
