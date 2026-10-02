// lib/annonces/formulaire.ts
//
// LE FORMULAIRE D'UNE ANNONCE, ÉCRIT UNE FOIS — pour l'annonce d'une organisation (client, cabinet, ESN) ET pour le
// besoin de sous-traitance entre experts (lot « critères des annonces », 03/10/2026, §D.39).
//
// Les deux écrans avaient chacun leurs champs : le besoin de sous-traitance n'avait ni spécialité, ni séniorité, ni mode
// de travail, ni durée. Décision de Youssef : « client et collaboration entre experts ont exactement les mêmes champs ».
// Les deux écrans rendent donc LE MÊME composant (components/annonces/ChampsAnnonce.tsx) sur CET état, le valident par
// CETTE fonction et envoient CE corps. Seul le TYPE diffère (choisi par l'organisation, imposé au besoin).
//
// Module PUR (imports relatifs) : `diag-criteres-communs` l'exécute tel quel.

import type { AnnonceType } from '../../types/annonce.ts'
import type { PublicationDraft } from '../../types/publication.ts'
import {
  DUREE_MAX,
  DUREE_MIN,
  JOURS_PAR_SEMAINE,
  MODES_TRAVAIL,
  SENIORITES,
  TEMPS_TRAVAIL,
  UNITES_DUREE,
  valeursConnues,
  type ModeTravail,
  type Seniorite,
  type TempsTravail,
  type UniteDuree,
} from '../criteres/communs.ts'
import { SPECIALITY_OTHER } from '../taxonomie/specialite-autre.ts'
import { missingForPublish, type PublicationPublishableField } from '../publications/publishable.ts'

/** L'état saisi — des chaînes pour ce qui se tape, des listes pour ce qui se coche. */
export type ValeursAnnonce = {
  title: string
  description: string
  branch_id: string
  // « Autre (préciser) » → SPECIALITY_OTHER (la sentinelle) parmi les spécialités choisies (§D.40).
  speciality_ids: string[]
  speciality_other: string
  skills_required: string[]
  seniorities: Seniorite[]
  work_modes: ModeTravail[]
  jours_sur_site: string
  jours_teletravail: string
  temps_travail: TempsTravail[]
  work_zone_ids: string[]
  location_note: string
  duree_valeur: string
  duree_unite: UniteDuree | ''
  start_date: string
  budget_min: string
  budget_max: string
  confidential: boolean
}

/** Les champs qu'une erreur peut viser (ceux de l'état, plus la répartition et la durée, chacune à deux champs). */
export type ChampAnnonce = keyof ValeursAnnonce | 'repartition_hybride' | 'duree'

/**
 * Les erreurs de saisie, en CODES — l'écran les traduit. Chaque code a sa phrase (quatre langues) : jamais « une erreur
 * est survenue » pour une saisie qu'on peut nommer.
 */
export type CodeErreurSaisie =
  | 'titre_invalide'
  | 'description_invalide'
  | 'manquant'
  | 'precision_autre_manquante'
  | 'repartition_manquante'
  | 'repartition_invalide'
  | 'duree_invalide'
  | 'budget_invalide'
  | 'budget_inverse'
  | 'date_invalide'

export const VALEURS_VIDES: ValeursAnnonce = {
  title: '',
  description: '',
  branch_id: '',
  speciality_ids: [],
  speciality_other: '',
  skills_required: [],
  seniorities: [],
  work_modes: [],
  jours_sur_site: '',
  jours_teletravail: '',
  temps_travail: [],
  work_zone_ids: [],
  location_note: '',
  duree_valeur: '',
  duree_unite: '',
  start_date: '',
  budget_min: '',
  budget_max: '',
  confidential: false,
}

const texteDe = (n: number | null | undefined) => (n == null ? '' : String(n))

/** L'état d'un brouillon relu (GET /api/publications/[id]). */
export function valeursDepuisBrouillon(d: PublicationDraft): ValeursAnnonce {
  return {
    title: d.title,
    description: d.description,
    branch_id: d.branch_id ?? '',
    // Aucune spécialité du référentiel mais une précision libre → « Autre ».
    speciality_ids: (d.speciality_ids ?? []).length > 0
      ? [...d.speciality_ids, ...(d.speciality_other ? [SPECIALITY_OTHER] : [])]
      : d.speciality_other ? [SPECIALITY_OTHER] : [],
    speciality_other: d.speciality_other ?? '',
    skills_required: d.skills_required ?? [],
    seniorities: valeursConnues(SENIORITES, d.seniorities),
    work_modes: valeursConnues(MODES_TRAVAIL, d.work_modes),
    jours_sur_site: texteDe(d.jours_sur_site),
    jours_teletravail: texteDe(d.jours_teletravail),
    temps_travail: valeursConnues(TEMPS_TRAVAIL, d.temps_travail),
    work_zone_ids: d.work_zone_ids ?? [],
    location_note: d.location_note ?? '',
    duree_valeur: texteDe(d.duree_valeur),
    duree_unite: d.duree_unite ?? '',
    start_date: d.start_date ?? '',
    budget_min: texteDe(d.budget_min),
    budget_max: texteDe(d.budget_max),
    confidential: d.confidential ?? false,
  }
}

function nombre(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : NaN
}

/** Un entier lu, `null` pour un champ vide, `NaN` pour une saisie qui n'est pas un entier. */
function entier(s: string): number | null {
  const n = nombre(s)
  return n === null ? null : Number.isInteger(n) ? n : NaN
}

/** Ce que le corps de requête dira de la répartition (rien sans « Hybride »). */
function repartition(v: ValeursAnnonce): { sur_site: number | null; teletravail: number | null } {
  if (!v.work_modes.includes('hybrid')) return { sur_site: null, teletravail: null }
  return { sur_site: entier(v.jours_sur_site), teletravail: entier(v.jours_teletravail) }
}

/**
 * Le corps POST/PATCH — le même pour les deux écrans. Jamais de `status` : la publication passe par /publish. Les zones
 * partent en CODES stables (le serveur résout et refuse un code inconnu), les spécialités en identifiants du référentiel.
 */
export function corpsDeRequete(
  v: ValeursAnnonce,
  type: AnnonceType,
  codeDeZone: (id: string) => string | undefined,
): Record<string, unknown> {
  const r = repartition(v)
  const autre = v.speciality_ids.includes(SPECIALITY_OTHER)
  return {
    title: v.title.trim(),
    description: v.description.trim(),
    branch_id: v.branch_id || null,
    speciality_ids: v.speciality_ids.filter((id) => id !== SPECIALITY_OTHER),
    speciality_other: autre ? v.speciality_other.trim() : null,
    skills_required: v.skills_required,
    seniorities: v.seniorities,
    work_modes: v.work_modes,
    jours_sur_site: r.sur_site,
    jours_teletravail: r.teletravail,
    temps_travail: v.temps_travail,
    work_zone_codes: v.work_zone_ids.map(codeDeZone).filter((c): c is string => !!c),
    location_note: v.location_note.trim() || null,
    // UNE OFFRE CDI N'A PAS DE DURÉE (contrainte publications_offre_sans_duree) : rien ne part.
    duree_valeur: type === 'offre' ? null : entier(v.duree_valeur),
    duree_unite: type === 'offre' ? null : v.duree_unite || null,
    start_date: v.start_date || null,
    budget_min: nombre(v.budget_min),
    budget_max: nombre(v.budget_max),
    confidential: v.confidential,
  }
}

/**
 * LA VALIDATION DE L'ÉCRAN — les bornes fines, puis EXACTEMENT le prédicat que /publish applique pour refuser
 * (`missingForPublish`) : aucun champ exigé par le serveur ne manque à l'appel du formulaire. L'API reste la barrière.
 */
export function erreursDeSaisie(v: ValeursAnnonce, type: AnnonceType): Partial<Record<ChampAnnonce, CodeErreurSaisie>> {
  const e: Partial<Record<ChampAnnonce, CodeErreurSaisie>> = {}
  const titre = v.title.trim()
  const texte = v.description.trim()
  if (titre.length < 5 || titre.length > 200) e.title = 'titre_invalide'
  if (texte.length < 20 || texte.length > 10_000) e.description = 'description_invalide'
  const autre = v.speciality_ids.includes(SPECIALITY_OTHER)
  if (autre && !v.speciality_other.trim()) e.speciality_other = 'precision_autre_manquante'

  const r = repartition(v)
  const repartitionLue = r.sur_site !== null && r.teletravail !== null && !Number.isNaN(r.sur_site) && !Number.isNaN(r.teletravail)
  if (v.work_modes.includes('hybrid') && (r.sur_site !== null || r.teletravail !== null)) {
    const valable = repartitionLue && (r.sur_site as number) >= 1 && (r.teletravail as number) >= 1
      && (r.sur_site as number) + (r.teletravail as number) <= JOURS_PAR_SEMAINE
    if (!valable) e.repartition_hybride = 'repartition_invalide'
  }

  if (type !== 'offre' && (v.duree_valeur.trim() !== '' || v.duree_unite !== '')) {
    const n = entier(v.duree_valeur)
    if (n === null || Number.isNaN(n) || n < DUREE_MIN || n > DUREE_MAX || !(UNITES_DUREE as readonly string[]).includes(v.duree_unite)) {
      e.duree = 'duree_invalide'
    }
  }

  const bmin = nombre(v.budget_min)
  const bmax = nombre(v.budget_max)
  if (bmin !== null && (Number.isNaN(bmin) || bmin < 0)) e.budget_min = 'budget_invalide'
  if (bmax !== null && (Number.isNaN(bmax) || bmax < 0)) e.budget_max = 'budget_invalide'
  if (bmin !== null && bmax !== null && !Number.isNaN(bmin) && !Number.isNaN(bmax) && bmin > bmax) e.budget_max = 'budget_inverse'
  if (v.start_date !== '' && (!/^\d{4}-\d{2}-\d{2}$/.test(v.start_date) || !Number.isFinite(new Date(v.start_date).getTime()))) {
    e.start_date = 'date_invalide'
  }

  for (const champ of manquantsPourPublier(v)) {
    const cible: ChampAnnonce = champ
    if (!e[cible]) e[cible] = champ === 'repartition_hybride' ? 'repartition_manquante' : 'manquant'
  }
  return e
}

/** Le prédicat du serveur, appliqué à l'état saisi (le même `missingForPublish`). */
export function manquantsPourPublier(v: ValeursAnnonce): PublicationPublishableField[] {
  const r = repartition(v)
  return missingForPublish({
    title: v.title,
    description: v.description,
    branch_id: v.branch_id || null,
    speciality_ids: v.speciality_ids.filter((id) => id !== SPECIALITY_OTHER),
    speciality_other: v.speciality_ids.includes(SPECIALITY_OTHER) ? v.speciality_other : null,
    work_zone_ids: v.work_zone_ids,
    work_modes: v.work_modes,
    temps_travail: v.temps_travail,
    jours_sur_site: r.sur_site === null || Number.isNaN(r.sur_site) ? null : r.sur_site,
    jours_teletravail: r.teletravail === null || Number.isNaN(r.teletravail) ? null : r.teletravail,
  })
}

// ── LES MOTS DES REFUS — les deux écrans disent les mêmes refus avec les mêmes phrases ───────────────────────────────
type Traduire = (cle: string, valeurs?: Record<string, string | number>) => string

/** La phrase d'une erreur de saisie, sous son champ (`tPub` : espace `publications`, `tCrit` : espace `criteres`). */
export function messageDeSaisie(champ: ChampAnnonce, code: CodeErreurSaisie, tPub: Traduire, tCrit: Traduire): string {
  switch (code) {
    case 'titre_invalide': return tPub('errors.invalid_title')
    case 'description_invalide': return tPub('errors.invalid_description')
    case 'precision_autre_manquante': return tCrit('erreurs.precision_autre_manquante')
    case 'repartition_manquante': return tCrit('erreurs.repartition_hybride')
    case 'repartition_invalide': return tCrit('erreurs.repartition_hybride_invalide')
    case 'duree_invalide': return tCrit('erreurs.duree_invalide')
    case 'budget_invalide': return tPub('errors.invalid_budget')
    case 'budget_inverse': return tPub('errors.budget_inverted')
    case 'date_invalide': return tCrit('erreurs.date_invalide')
    case 'manquant':
      switch (champ) {
        case 'title': return tPub('form.field_errors.title')
        case 'description': return tPub('form.field_errors.description')
        case 'branch_id': return tPub('form.field_errors.branch_id')
        case 'work_zone_ids': return tPub('form.field_errors.work_zone_ids')
        case 'speciality_ids': return tCrit('erreurs.speciality_ids')
        case 'temps_travail': return tCrit('erreurs.temps_travail')
        default: return tCrit('erreurs.champ_obligatoire')
      }
  }
}

/** Toutes les erreurs de l'état, en phrases, champ par champ. */
export function messagesDeSaisie(
  erreurs: Partial<Record<ChampAnnonce, CodeErreurSaisie>>,
  tPub: Traduire,
  tCrit: Traduire,
): Partial<Record<ChampAnnonce, string>> {
  const out: Partial<Record<ChampAnnonce, string>> = {}
  for (const [champ, code] of Object.entries(erreurs) as Array<[ChampAnnonce, CodeErreurSaisie]>) {
    out[champ] = messageDeSaisie(champ, code, tPub, tCrit)
  }
  return out
}

/** Le nom d'un champ que /publish déclare manquant (`missing`), pour « Il manque : … ». */
export function libelleChampPubliable(champ: PublicationPublishableField, tPub: Traduire, tCrit: Traduire): string {
  switch (champ) {
    case 'title': return tPub('form.field_title')
    case 'description': return tPub('form.field_description')
    case 'branch_id': return tPub('form.field_branch')
    case 'speciality_ids': return tCrit('champs.specialites')
    case 'work_zone_ids': return tPub('form.field_work_zones')
    case 'repartition_hybride': return tCrit('champs.repartition')
    case 'temps_travail': return tCrit('champs.temps_travail')
  }
}

/**
 * Les refus du SERVEUR communs aux deux écrans (création, modification, publication), chacun NOMMÉ. `null` : le code
 * n'est pas de cette famille — l'écran le traite (commerce, organisation, session…), jamais par « une erreur est
 * survenue » quand le serveur a nommé la raison.
 */
export function messageDeRefusCommun(code: string | undefined, tPub: Traduire, tCrit: Traduire): string | null {
  switch (code) {
    case 'invalid_json': return tPub('errors.invalid_json')
    case 'invalid_type': return tPub('errors.invalid_type')
    case 'invalid_title': return tPub('errors.invalid_title')
    case 'invalid_description': return tPub('errors.invalid_description')
    case 'invalid_budget': return tPub('errors.invalid_budget')
    case 'budget_inverted': return tPub('errors.budget_inverted')
    case 'bad_work_zone': return tPub('form.field_errors.work_zone_ids')
    case 'wrong_status': return tPub('errors.wrong_status')
    case 'not_found': return tPub('errors.not_found')
    case 'forbidden': return tPub('errors.forbidden')
    case 'verification_failed': return tPub('errors.verification_failed')
    case 'repartition_hybride_invalide': return tCrit('erreurs.repartition_hybride_invalide')
    case 'duree_invalide': return tCrit('erreurs.duree_invalide')
    case 'duree_hors_offre': return tCrit('erreurs.duree_hors_offre')
    // Une annonce refusée se resoumet MODIFIÉE (ARRÊT 28) : inchangée, le serveur ne la repasse pas en brouillon.
    case 'annonce_refusee_inchangee': return tPub('errors.annonce_refusee_inchangee')
    // Le type d'une annonce ne change pas une fois le brouillon créé (relecture de l'ARRÊT 28, point 2).
    case 'type_immuable': return tPub('errors.type_immuable')
    default: return null
  }
}
