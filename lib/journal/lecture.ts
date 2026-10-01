import { ACTIONS_JOURNAL } from './actions'
import type { NomsJournal } from './phrase'

/**
 * LA LECTURE DU GRAND LIVRE — ce que l'écran /admin/journal et ses deux routes
 * partagent (§D.26, phase B 2.6). La lecture elle-même est en base
 * (`lire_grand_livre`, `lire_piece` : SECURITY DEFINER, bornées, réservées à
 * l'administrateur, AD002) ; ce module ne porte que les VOCABULAIRES FERMÉS des
 * filtres, le curseur opaque et les formes rendues.
 *
 * Sûr côté navigateur : l'écran l'importe. Le curseur (encodage serveur) vit dans
 * la route `app/api/admin/journal`.
 *
 * ⚠️ LE CURSEUR EST OPAQUE, ET L'IDENTIFIANT N'EST JAMAIS AFFICHÉ. `grand_livre.id`
 *    a des trous normaux (sondes annulées, §D.26) : montré comme une suite, il
 *    ferait croire à une ligne manquante. Il ne sert qu'à reprendre la lecture.
 */

/** Les familles de `grand_livre_actions` — la contrainte `grand_livre_actions_famille_check`. */
export const FAMILLES_JOURNAL = [
  'annonce', 'profil', 'recherche', 'candidature', 'devoilement', 'messagerie', 'compte',
  'organisation', 'commerce', 'administration', 'rgpd', 'journal', 'refus',
] as const
export type FamilleJournal = (typeof FAMILLES_JOURNAL)[number]

export const STATUTS_JOURNAL = ['reussi', 'echoue', 'refuse'] as const
export const ORIGINES_JOURNAL = ['utilisateur', 'tache_planifiee', 'administrateur', 'systeme'] as const

export type LigneJournal = {
  curseur_id: number
  horodatage: string
  piece: string
  piece_origine: string | null
  type_action: (typeof ACTIONS_JOURNAL)[number]
  famille: FamilleJournal
  statut: (typeof STATUTS_JOURNAL)[number]
  origine: (typeof ORIGINES_JOURNAL)[number]
  acteur_id: string | null
  acteur_type: string | null
  acteur_nom: string | null
  acteur_supprime: boolean
  ecosysteme_id: string | null
  ecosysteme_nom: string | null
  sujet_type: string | null
  sujet_id: string | null
  detail: Record<string, unknown>
  cout_usd: number | string | null
  unite_facturee: string | null
}

export type PageJournal = {
  lignes: LigneJournal[]
  limite: number
  /** Le curseur de la page suivante, opaque — `null` : il n'y a pas de suite. */
  suivant: string | null
  /** Les noms des objets que les phrases citent (`libelles_journal`), par `type:id`. */
  noms: NomsJournal
  /** La relecture des noms a échoué : l'écran le dit (les phrases retombent sur « un profil », « une annonce »). */
  noms_indisponibles: boolean
}

export type PieceJournal = {
  piece: string
  lignes: Omit<LigneJournal, 'curseur_id'>[]
  tronquee: boolean
  referencee_par: string[]
  sous_journaux: {
    audit_logs: Array<{ id: string; action: string; entity_type: string; entity_id: string; horodatage: string }>
    ai_spend_events: Array<{ provider: string; action: string | null; units: number; cost_usd: number | string; horodatage: string }>
    stripe_events: Array<{ id: string; type: string; status: string; horodatage: string }>
    cron_run_log: Array<{ job_name: string; trigger_source: string; http_status: number | null; horodatage: string }>
    notifications: Array<{ type: string; channel: string; status: string; horodatage: string }>
  }
  noms: NomsJournal
  noms_indisponibles: boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const estUuid = (x: unknown): x is string => typeof x === 'string' && UUID.test(x)

/** Une liste de valeurs d'un vocabulaire fermé, lue dans l'URL (`a,b,c`). Hors vocabulaire : refusé. */
export function listeFermee<T extends string>(brut: string | null, vocabulaire: readonly T[]): T[] | null | 'hors_liste' {
  if (!brut) return null
  const v = brut.split(',').map((x) => x.trim()).filter(Boolean)
  if (v.length === 0) return null
  if (!v.every((x) => (vocabulaire as readonly string[]).includes(x))) return 'hors_liste'
  return v as T[]
}
