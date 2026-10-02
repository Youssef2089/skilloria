// lib/annonces/mise-en-forme.ts
//
// LES CRITÈRES D'UNE ANNONCE, MIS EN MOTS — une écriture pour tous les écrans (lot « critères des annonces »,
// 03/10/2026, §D.39).
//
// Ce que Youssef a vu : la durée s'affichait « 6 », sans unité ; la carte du besoin de sous-traitance disait
// « 600–700€/an » au-dessus de « 600 €–700 € /jour ». Chaque écran mettait en forme lui-même — le budget avait quatre
// écritures, et son unité trois règles (« mission → jour, sinon an » rangeait la sous-traitance parmi les salaires).
//
// LA RÈGLE : les cartes, les détails, le suivi de candidature et l'administration mettent en mots par CES fonctions.
// L'unité du budget suit le TYPE d'annonce par `budgetUnitForAnnonce` (lib/annonces/audience.ts), et nulle part ailleurs.
//
// `t` est un traducteur sur l'espace `criteres` (useTranslations('criteres') à l'écran, getTranslations au serveur) ;
// `tPub` sur l'espace `publications` (l'unité du budget y vit déjà).

import type { AnnonceType } from '../../types/annonce.ts'
import { budgetUnitForAnnonce } from './audience.ts'
import type { CriteresAnnonceLus } from './criteres.ts'

export type Traduire = (cle: string, valeurs?: Record<string, string | number>) => string

/** « 6 mois », « 3 semaines », « 1 an » — ou `null` quand l'annonce n'a pas de durée (une offre CDI n'en a jamais). */
export function libelleDuree(c: Pick<CriteresAnnonceLus, 'duree_valeur' | 'duree_unite'>, t: Traduire): string | null {
  if (c.duree_valeur == null || !c.duree_unite) return null
  return t(`duree.${c.duree_unite}`, { n: c.duree_valeur })
}

/** « 3 j sur site · 2 j en télétravail » — ou `null` sans répartition. */
export function libelleRepartition(c: Pick<CriteresAnnonceLus, 'jours_sur_site' | 'jours_teletravail'>, t: Traduire): string | null {
  if (c.jours_sur_site == null || c.jours_teletravail == null) return null
  return t('repartition', { sur_site: c.jours_sur_site, teletravail: c.jours_teletravail })
}

/** Les modes de travail, chacun dans la langue de l'écran ; « Hybride » porte sa répartition quand elle est dite. */
export function libellesModesTravail(
  c: Pick<CriteresAnnonceLus, 'work_modes' | 'jours_sur_site' | 'jours_teletravail'>,
  t: Traduire,
): string[] {
  const repartition = libelleRepartition(c, t)
  return c.work_modes.map((m) =>
    m === 'hybrid' && repartition
      ? t('mode_hybride_reparti', { mode: t('modes_travail.hybrid'), repartition })
      : t(`modes_travail.${m}`),
  )
}

/** « Temps plein », « Temps partiel », ou les deux. */
export function libellesTempsTravail(c: Pick<CriteresAnnonceLus, 'temps_travail'>, t: Traduire): string[] {
  return c.temps_travail.map((v) => t(`temps_travail.${v}`))
}

/**
 * LE MOT QUI SUIT LE TYPE D'ANNONCE — le suffixe des clés qui se déclinent par type (« retenu pour cette mission »,
 * « pour ce poste », « pour ce besoin de sous-traitance »). Regroupement, ARRÊT 28 : la fiche de candidat disait « pour
 * ce poste » à un besoin de sous-traitance (`mission ? mission : offre`), le suivi « mission » (`offre ? offre :
 * mission`) — deux règles « X ? A : B » sur un type à TROIS valeurs, la classe de §E.96. Les trois cas, écrits ; un type
 * inconnu (une ligne d'avant les types) garde le mot « mission », le défaut historique du suivi.
 */
export function motDuType(type: string | null | undefined): AnnonceType {
  switch (type) {
    case 'offre': return 'offre'
    case 'sous_traitance': return 'sous_traitance'
    default: return 'mission'
  }
}

/** La clé de l'unité du budget dans l'espace `publications` — le TYPE la décide (`budgetUnitForAnnonce`). */
export function cleUniteBudget(type: AnnonceType): 'budget_unit.day' | 'budget_unit.year' {
  return budgetUnitForAnnonce(type) === 'year' ? 'budget_unit.year' : 'budget_unit.day'
}

/** « 600 €–700 € /jour », « 55 000 € /an » — ou `null` sans budget. Une écriture, toutes les surfaces. */
export function libelleBudget(
  pub: { type: AnnonceType; budget_min: number | null; budget_max: number | null },
  tPub: Traduire,
  locale: string,
): string | null {
  const { budget_min: min, budget_max: max } = pub
  if (min == null && max == null) return null
  const fmt = (v: number) => `${Math.round(v).toLocaleString(locale)} €`
  const unite = tPub(cleUniteBudget(pub.type))
  if (min != null && max != null && min !== max) return `${fmt(min)}–${fmt(max)} ${unite}`
  return `${fmt((min ?? max) as number)} ${unite}`
}
