import { tBDD, type TranslationsMap } from '@/lib/translations'
import type { AnnonceType } from '@/types/annonce'

/**
 * lib/publication-synthesis.ts — source UNIQUE de synthèse d'une publication
 * pour les surfaces "carte" (MissionCard / AnnonceCard / candidature expert
 * inline) et le panneau messagerie. Évite les 4 DTOs publication divergents
 * qui existaient avant ce lot.
 *
 * Aucune migration : tous les champs lus existent déjà dans `publications`.
 * Le label "contrat" pour les offres CDI est DÉRIVÉ de `type='offre'` →
 * libellé i18n (pas de colonne contract_type, décision Youssef).
 *
 * Whitelist stricte des champs publi exposés (pas de PII — la publication
 * elle-même n'en contient pas, mais on garde la discipline).
 */

export type PublicationSynthesis = {
  id: string
  type: AnnonceType
  title: string
  budget_min: number | null
  budget_max: number | null
  /** Dérivé du type : 'day' pour mission (TJM €/j), 'year' pour offre (€/an). */
  budget_unit: 'day' | 'year'
  location: string | null
  /** 'remote' | 'onsite' | 'hybrid' (ou autre valeur libre côté BDD). */
  work_mode: string | null
  duration: string | null
  /** ISO date (YYYY-MM-DD) ou null. */
  start_date: string | null
  seniority: string | null
  branch_label: string | null
  speciality_label: string | null
  confidential: boolean
}

/**
 * Forme attendue en entrée : ligne `publications` jointe avec branches/specialities
 * (id + name). Le helper est tolérant aux propriétés manquantes (null fallback).
 */
type PublicationLike = {
  id: string
  type: string
  title: string
  budget_min: number | null
  budget_max: number | null
  location?: string | null
  work_mode?: string | null
  duration?: string | null
  start_date?: string | null
  seniority?: string | null
  confidential?: boolean | null
  branches?: { id: string; name: string } | { id: string; name: string }[] | null
  specialities?: { id: string; name: string } | { id: string; name: string }[] | null
  branch_id?: string | null
  speciality_id?: string | null
}

function pickRel<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export function buildPublicationSynthesis(
  pub: PublicationLike,
  translations: TranslationsMap,
): PublicationSynthesis {
  const branch = pickRel(pub.branches ?? null)
  const speciality = pickRel(pub.specialities ?? null)
  const branchId = branch?.id ?? pub.branch_id ?? null
  const branchName = branch?.name ?? ''
  const specialityId = speciality?.id ?? pub.speciality_id ?? null
  const specialityName = speciality?.name ?? ''

  const branch_label = branchId
    ? tBDD(translations, 'branches', branchId, 'name', branchName)
    : null
  const speciality_label = specialityId
    ? tBDD(translations, 'specialities', specialityId, 'name', specialityName)
    : null

  const type: AnnonceType =
    pub.type === 'offre' ? 'offre' : pub.type === 'sous_traitance' ? 'sous_traitance' : 'mission'

  return {
    id: pub.id,
    type,
    title: pub.title,
    budget_min: pub.budget_min,
    budget_max: pub.budget_max,
    budget_unit: type === 'offre' ? 'year' : 'day',
    location: pub.location ?? null,
    work_mode: pub.work_mode ?? null,
    duration: pub.duration ?? null,
    start_date: pub.start_date ?? null,
    seniority: pub.seniority ?? null,
    branch_label,
    speciality_label,
    confidential: !!pub.confidential,
  }
}

/**
 * Liste des colonnes `publications` requises pour bâtir une synthèse
 * complète. À utiliser dans les `.select()` Supabase pour garantir que
 * toutes les routes servent la même base de champs.
 *
 * Note : ajouter `branches(id, name), specialities(id, name)` séparément
 * dans le select string (jointures).
 */
export const PUBLICATION_SYNTHESIS_SELECT =
  'id, type, title, budget_min, budget_max, location, work_mode, duration, ' +
  'start_date, seniority, confidential, branch_id, speciality_id'
