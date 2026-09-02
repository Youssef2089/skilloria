import type { AnnonceType } from '@/types/annonce'
import { tBDD, type TranslationsMap } from '@/lib/translations'

/**
 * SYNTHÈSE D'UNE ANNONCE — la ligne de contexte affichée sous chaque titre.
 *
 * Source UNIQUE de la projection : carte d'annonce, détail mission, fiche de
 * sous-traitance et bandeau de messagerie lisent tous cette forme. Une seule
 * écriture, sinon le même champ finit affiché différemment selon l'écran.
 *
 * CE QUI A CHANGÉ AVEC LES CHAMPS MULTIPLES
 *   `speciality_label` et `seniority` étaient au singulier ; ils sont désormais
 *   des listes. Ce n'est pas une commodité : une annonce qui ne pouvait
 *   déclarer qu'une spécialité restait invisible aux experts de la spécialité
 *   voisine, sans que personne puisse dire pourquoi.
 *
 *   `location` — texte libre qui servait à la fois de critère supposé et
 *   d'affichage — se scinde en deux choses qui n'ont rien à voir :
 *     • `work_zone_labels` : les zones déclarées. Elles FILTRENT, elles sont
 *       opposables, et le moteur les recoupe des deux côtés du marché.
 *     • `location_note` : une précision affichée (« Paris ou Lyon »). Elle ne
 *       filtre rien, et le formulaire le dit à qui la saisit.
 *
 * RÉSOLUTION DES LIBELLÉS
 *   L'embed PostgREST `specialities(name)` reposait sur la clé étrangère
 *   `speciality_id`, supprimée par la migration. Les libellés multiples sont
 *   donc résolus par l'appelant, en UNE requête groupée pour toute la page, et
 *   passés ici sous forme de table. Le helper reste tolérant : un identifiant
 *   sans libellé est ignoré plutôt que rendu sous forme d'uuid.
 */

export type PublicationSynthesis = {
  id: string
  type: AnnonceType
  title: string
  budget_min: number | null
  budget_max: number | null
  /** Dérivé du type : 'day' pour mission (TJM €/j), 'year' pour offre (€/an). */
  budget_unit: 'day' | 'year'
  /** Zones déclarées, déjà traduites. Ce sont ELLES qui filtrent. */
  work_zone_labels: string[]
  /** Précision d'affichage. NE FILTRE RIEN. */
  location_note: string | null
  /** 'remote' | 'onsite' | 'hybrid' (ou autre valeur libre côté BDD). */
  work_mode: string | null
  duration: string | null
  /** ISO date (YYYY-MM-DD) ou null. */
  start_date: string | null
  seniorities: string[]
  branch_label: string | null
  speciality_labels: string[]
  confidential: boolean
}

/** Forme attendue en entrée : une ligne `publications`, propriétés tolérées absentes. */
type PublicationLike = {
  id: string
  type: string
  title: string
  budget_min: number | null
  budget_max: number | null
  location_note?: string | null
  work_mode?: string | null
  duration?: string | null
  start_date?: string | null
  seniorities?: string[] | null
  confidential?: boolean | null
  branches?: { id: string; name: string } | { id: string; name: string }[] | null
  branch_id?: string | null
  speciality_ids?: string[] | null
  work_zone_ids?: string[] | null
}

/** Libellés déjà traduits, résolus une fois par page par l'appelant. */
export type ReferentielLabels = {
  specialities?: ReadonlyMap<string, string>
  workZones?: ReadonlyMap<string, string>
}

function pickRel<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

const libelles = (
  ids: readonly string[] | null | undefined,
  table: ReadonlyMap<string, string> | undefined,
): string[] =>
  (ids ?? [])
    .map((id) => table?.get(id))
    .filter((n): n is string => typeof n === 'string' && n.length > 0)

export function buildPublicationSynthesis(
  pub: PublicationLike,
  translations: TranslationsMap,
  labels: ReferentielLabels = {},
): PublicationSynthesis {
  const branch = pickRel(pub.branches ?? null)
  const branchId = branch?.id ?? pub.branch_id ?? null
  const branchName = branch?.name ?? ''

  const branch_label = branchId
    ? tBDD(translations, 'branches', branchId, 'name', branchName)
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
    work_zone_labels: libelles(pub.work_zone_ids, labels.workZones),
    location_note: pub.location_note ?? null,
    work_mode: pub.work_mode ?? null,
    duration: pub.duration ?? null,
    start_date: pub.start_date ?? null,
    seniorities: pub.seniorities ?? [],
    branch_label,
    speciality_labels: libelles(pub.speciality_ids, labels.specialities),
    confidential: !!pub.confidential,
  }
}

/**
 * Colonnes `publications` requises pour bâtir une synthèse complète. À utiliser
 * dans les `.select()` pour que toutes les routes servent la même base.
 *
 * Note : ajouter `branches(id, name)` séparément dans le select (jointure).
 * Il n'y a PLUS d'embed `specialities(...)` — la clé étrangère a disparu avec
 * le passage au multiple ; les libellés se résolvent par lot (cf. en-tête).
 */
export const PUBLICATION_SYNTHESIS_SELECT =
  'id, type, title, budget_min, budget_max, location_note, work_zone_ids, work_mode, duration, ' +
  'start_date, seniorities, confidential, branch_id, speciality_ids'

/**
 * Résout les libellés des référentiels MULTIPLES pour un lot d'annonces.
 *
 * Deux requêtes groupées pour toute une page, jamais une par ligne. Écrit ici
 * plutôt que recopié dans chaque route : c'est le genre de boucle qu'on
 * n'aperçoit qu'en production, quand la page rame sans qu'on sache pourquoi.
 */
export async function loadReferentielLabels(
  supabaseAdmin: {
    from: (t: string) => {
      select: (c: string) => { in: (col: string, v: string[]) => Promise<{ data: unknown }> }
    }
  },
  translations: TranslationsMap,
  rows: ReadonlyArray<{ speciality_ids?: string[] | null; work_zone_ids?: string[] | null }>,
): Promise<ReferentielLabels> {
  const specIds = [...new Set(rows.flatMap((r) => r.speciality_ids ?? []))]
  const zoneIds = [...new Set(rows.flatMap((r) => r.work_zone_ids ?? []))]

  const [specRes, zoneRes] = await Promise.all([
    specIds.length
      ? supabaseAdmin.from('specialities').select('id, name').in('id', specIds)
      : Promise.resolve({ data: [] }),
    zoneIds.length
      ? supabaseAdmin.from('work_zones').select('id, name').in('id', zoneIds)
      : Promise.resolve({ data: [] }),
  ])

  const table = (data: unknown, nomTable: 'specialities' | 'work_zones') =>
    new Map(
      ((data ?? []) as Array<{ id: string; name: string }>).map((x) => [
        x.id,
        tBDD(translations, nomTable, x.id, 'name', x.name),
      ]),
    )

  return {
    specialities: table(specRes.data, 'specialities'),
    workZones: table(zoneRes.data, 'work_zones'),
  }
}
