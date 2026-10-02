// lib/annonces/criteres.ts
//
// LES CRITÈRES D'UNE ANNONCE, LUS UNE FOIS — pour la création, la modification et le formulaire (lot « critères des
// annonces », 03/10/2026, §D.39).
//
// La création (POST /api/publications) et la modification (PATCH /api/publications/[id]) lisaient chacune ses champs
// avec ses propres fonctions : deux copies, et la seconde n'apprend jamais ce que la première a corrigé (§E.20). Les
// critères NOUVEAUX — modes de travail multiples, répartition hybride, temps plein ou partiel, durée en nombre et unité —
// se lisent ICI, par les deux routes et par l'écran, avec les mêmes refus nommés.
//
// Module PUR (imports relatifs seulement) : `diag-criteres-communs` l'exécute tel quel.

import {
  DUREE_MAX,
  DUREE_MIN,
  JOURS_PAR_SEMAINE,
  MODES_TRAVAIL,
  TEMPS_TRAVAIL,
  UNITES_DUREE,
  valeursConnues,
  type ModeTravail,
  type TempsTravail,
  type UniteDuree,
} from '../criteres/communs.ts'

/** Les refus nommés de ce module — chacun a sa phrase dans `criteres.erreurs.<code>`, quatre langues. */
export const REFUS_CRITERES = ['repartition_hybride_invalide', 'duree_invalide', 'duree_hors_offre'] as const
export type RefusCritere = (typeof REFUS_CRITERES)[number]

export type CriteresAnnonceLus = {
  work_modes: ModeTravail[]
  jours_sur_site: number | null
  jours_teletravail: number | null
  temps_travail: TempsTravail[]
  duree_valeur: number | null
  duree_unite: UniteDuree | null
}

/** Un entier, ou `null` pour une absence ; `undefined` pour une valeur qui n'est pas un entier. */
function entierOuNull(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN
  return Number.isInteger(n) ? n : undefined
}

/** La répartition est-elle valable pour ces modes ? (la règle de la contrainte de base, écrite une fois en TS) */
export function repartitionValable(modes: readonly string[], surSite: number | null, teletravail: number | null): boolean {
  if (surSite === null && teletravail === null) return true
  if (!modes.includes('hybrid')) return false
  if (surSite === null || teletravail === null) return false
  return surSite >= 1 && teletravail >= 1 && surSite + teletravail <= JOURS_PAR_SEMAINE
}

/**
 * Lit les critères NOUVEAUX d'un corps de requête. `present(cle)` dit si le champ est envoyé (le PATCH n'écrit que ce
 * qui l'est) ; le résultat ne porte que les champs présents.
 *
 * LES RÈGLES :
 *   · une valeur hors liste est IGNORÉE (comme les séniorités) : le client ne peut pas en fabriquer une utile ;
 *   · sans « Hybride », la répartition est EFFACÉE (elle ne dirait rien) ; avec, elle est lue et doit être valable ;
 *   · une durée est un nombre ET une unité, ou rien ; une offre CDI n'en a pas (`duree_hors_offre`).
 */
export function lireCriteresAnnonce(
  body: Record<string, unknown>,
  type: string | null,
): { ok: true; criteres: Partial<CriteresAnnonceLus> } | { ok: false; code: RefusCritere } {
  const present = (cle: string) => Object.prototype.hasOwnProperty.call(body, cle)
  const out: Partial<CriteresAnnonceLus> = {}

  if (present('work_modes')) out.work_modes = valeursConnues(MODES_TRAVAIL, body.work_modes)
  if (present('temps_travail')) out.temps_travail = valeursConnues(TEMPS_TRAVAIL, body.temps_travail)

  // LA RÉPARTITION VOYAGE AVEC LES MODES : elle ne se juge qu'avec eux. Envoyée seule, elle est refusée (le PATCH ne
  // relit pas les modes pour la juger) ; les deux écrans envoient toujours les trois champs ensemble.
  if (present('jours_sur_site') || present('jours_teletravail')) {
    if (!present('work_modes')) return { ok: false, code: 'repartition_hybride_invalide' }
  }
  if (out.work_modes !== undefined) {
    const surSite = entierOuNull(body.jours_sur_site)
    const teletravail = entierOuNull(body.jours_teletravail)
    if (surSite === undefined || teletravail === undefined) return { ok: false, code: 'repartition_hybride_invalide' }
    if (!out.work_modes.includes('hybrid')) {
      out.jours_sur_site = null
      out.jours_teletravail = null
    } else {
      if (!repartitionValable(out.work_modes, surSite, teletravail)) return { ok: false, code: 'repartition_hybride_invalide' }
      out.jours_sur_site = surSite
      out.jours_teletravail = teletravail
    }
  }

  if (present('duree_valeur') || present('duree_unite')) {
    const valeur = entierOuNull(body.duree_valeur)
    const unite = body.duree_unite === null || body.duree_unite === undefined || body.duree_unite === ''
      ? null
      : (UNITES_DUREE as readonly string[]).includes(String(body.duree_unite)) ? (String(body.duree_unite) as UniteDuree) : undefined
    if (valeur === undefined || unite === undefined) return { ok: false, code: 'duree_invalide' }
    if ((valeur === null) !== (unite === null)) return { ok: false, code: 'duree_invalide' }
    if (valeur !== null && (valeur < DUREE_MIN || valeur > DUREE_MAX)) return { ok: false, code: 'duree_invalide' }
    if (valeur !== null && type === 'offre') return { ok: false, code: 'duree_hors_offre' }
    out.duree_valeur = valeur
    out.duree_unite = unite
  }

  return { ok: true, criteres: out }
}

/** Les colonnes des critères nouveaux, pour les `select` — une seule liste, lue partout. */
export const COLONNES_CRITERES_ANNONCE = 'work_modes, jours_sur_site, jours_teletravail, temps_travail, duree_valeur, duree_unite'

/** Ces colonnes, projetées d'une ligne lue (une colonne absente se lit vide, jamais inventée). */
export function criteresDeLaLigne(row: Record<string, unknown>): CriteresAnnonceLus {
  const entier = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null)
  const unite = (UNITES_DUREE as readonly string[]).includes(String(row.duree_unite)) ? (row.duree_unite as UniteDuree) : null
  const valeur = entier(row.duree_valeur)
  return {
    work_modes: valeursConnues(MODES_TRAVAIL, row.work_modes),
    jours_sur_site: entier(row.jours_sur_site),
    jours_teletravail: entier(row.jours_teletravail),
    temps_travail: valeursConnues(TEMPS_TRAVAIL, row.temps_travail),
    duree_valeur: valeur !== null && unite !== null ? valeur : null,
    duree_unite: valeur !== null && unite !== null ? unite : null,
  }
}
