import type { AnnonceStatus, AnnonceType } from './annonce'

import type { CriteresAnnonceLus } from '@/lib/annonces/criteres'

// Les listes de valeurs des critères communs vivent dans lib/criteres/communs.ts — UNE liste, partagée avec le profil
// de l'expert et les contraintes de base (§D.39). Plus aucune copie ici.

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
  speciality_ids: string[]
  speciality_other: string | null
  skills_required: string[]
  seniorities: string[]
  // Texte libre d'appoint, jamais un critère de mise en relation.
  location_note: string | null
  // Zones de travail — obligatoires pour publier : une annonce sans zone ne
  // recouperait aucun expert (cf. lib/publications/publishable.ts).
  work_zone_ids: string[]
  start_date: string | null
  budget_min: number | null
  budget_max: number | null
  confidential: boolean
  status: AnnonceStatus
  verification_score: number | null
  // Le motif d'un refus de l'administration, pour l'auteur — servi SEULEMENT quand l'annonce est refusée (ARRÊT 28).
  motif_refus?: string | null
  created_at: string
  updated_at: string
  published_at: string | null
} & CriteresAnnonceLus
