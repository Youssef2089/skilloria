/**
 * Types partagés du moteur de matching (Lot 2a).
 */

import type { AnnonceType } from '@/types/annonce'

export type MatchingLocale = 'fr' | 'en' | 'es' | 'de'

/**
 * Config lue depuis `verification_providers` (row provider_type='profile_matching').
 * confidence_threshold = seuil de notification (entier 0..10).
 */
export type MatchingConfig = {
  model: string
  max_candidates: number
  max_tokens: number
  notify_threshold: number
}

/**
 * Résumé COMPACT d'un profil envoyé à l'IA. PII strictement exclues.
 * `profile_id` est une référence opaque (UUID) — non-PII, utilisée pour
 * tracer la réponse IA.
 */
export type ProfileCandidate = {
  profile_id: string
  expert_type: string | null
  /**
   * OUVERTURE CROISÉE — ce candidat n'est pas du type natif attendu par
   * l'annonce, mais il a EXPLICITEMENT opté pour recevoir ce type de contrat
   * (open_to_cdi / open_to_freelance). Transmis à l'IA pour qu'elle n'utilise
   * JAMAIS le type de contrat comme critère négatif le concernant.
   * Marquage NEUTRE : le même champ sert les deux sens de l'ouverture.
   */
  cross_type_opt_in: boolean
  title: string | null
  summary: string | null
  seniority: string | null
  years_experience: number | null
  years_total_experience: number | null
  branch_name: string | null
  speciality_name: string | null
  // D6 : spécialité hors référentiel saisie via « Autre » (nourrit le prompt IA).
  speciality_other: string | null
  skills: string[]
  languages: string[]
  certifications_count: number
  // Préférences mission (freelance)
  tjm_min: number | null
  tjm_max: number | null
  work_modes: string[]
  mobility: string | null
  availability_status: string | null
  availability_date: string | null
  // Préférences CDI
  cdi_status: string | null
  cdi_notice_period: string | null
  cdi_salary_min: number | null
  cdi_salary_max: number | null
  cdi_sectors: string[] | null
  cdi_geo_mobility: string | null
  cdi_contract_types: string[] | null
  // Localisation grossière (jamais postal_code / address_line)
  city: string | null
  country: string | null
}

/**
 * Données d'annonce présentées à l'IA pour matching.
 */
export type PublicationForMatching = {
  id: string
  type: AnnonceType
  /**
   * OUVERTURE CROISÉE — cette annonce n'est pas du type natif de l'expert à qui
   * on la propose, mais il a EXPLICITEMENT opté pour la recevoir. Même
   * sémantique que ProfileCandidate.cross_type_opt_in, dans l'autre sens.
   * Toujours `false` côté publication→experts (l'annonce y est le pivot, pas
   * un élément du pool).
   */
  cross_type_opt_in: boolean
  title: string
  description: string
  branch_name: string | null
  speciality_name: string | null
  // D6 : spécialité hors référentiel saisie via « Autre » (nourrit le prompt IA).
  speciality_other: string | null
  skills_required: string[]
  seniority: string | null
  work_mode: string | null
  location: string | null
  duration: string | null
  budget_min: number | null
  budget_max: number | null
  locale: MatchingLocale
}

/**
 * Sortie IA pour UN match. `profile_id` doit appartenir au set candidates fourni.
 *
 * - reason     : pitch neutre/factuel, affiché côté expert ("Pourquoi ça vous
 *                correspond").
 * - pitch_org  : pitch orienté chasse/recruteur, affiché côté org dans la card
 *                de candidature ("Pourquoi ce candidat colle à votre mission").
 *                ⚠ Généré dans la même langue que reason (locale de l'annonce =
 *                locale de l'org au moment du publish). Pas de PII (prompt
 *                strictement whitelist ProfileCandidate).
 *                Optionnel pour compat legacy : si absent, le DTO org tombe en
 *                fallback sur `reason`.
 */
export type AiMatchProposal = {
  profile_id: string
  score: number  // 0..10
  reason: string
  pitch_org?: string
}

export type MatchingVerdict = {
  status: 'ok' | 'error' | 'empty_pool' | 'no_config'
  proposals: AiMatchProposal[]
  /** Notes de pilotage (logs) — pas affichées utilisateur. */
  notes: string
  /** Modèle effectivement appelé. */
  model: string | null
}
