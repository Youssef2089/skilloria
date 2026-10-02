import { BLOCKING_FLAGS, PUBLICATION_QUALITY_FLAGS, type PublicationQualityFlag } from '@/lib/verification/ai-publication-quality'

/**
 * POURQUOI UNE ANNONCE EST EN REVUE — EN MOTS CLAIRS (lot S3, validation des annonces).
 *
 * Le verdict de la vérification automatique est écrit sur l'annonce (`verification_data` = { score, notes, flags },
 * lib/verification/publication-verification.ts). L'écran de l'administrateur ne montre JAMAIS un code brut
 * (`contact_info`) : ce module rend des CODES CONNUS, que l'écran traduit (`validation_annonces.signalements.<code>`),
 * et compte à part ce qu'il ne connaît pas — un code inconnu ne s'affiche pas, il se dit « autre signalement ».
 *
 * MODULE SERVEUR : il lit la liste des signalements dans le module de vérification (une seule liste, §E.20) — l'écran
 * reçoit le résultat, il n'importe pas ce fichier.
 */

export type RaisonsDuVerdict = {
  /** La note de la vérification automatique, 0-10 (§D.10) — null quand elle n'a pas jugé. */
  note: number | null
  /** Les signalements CONNUS, dans l'ordre de la liste de référence. */
  signalements: PublicationQualityFlag[]
  /** Parmi eux, ceux qui bloquent la publication automatique quelle que soit la note. */
  bloquants: PublicationQualityFlag[]
  /** Des signalements que la liste de référence ne connaît pas : comptés, jamais affichés. */
  autres: number
  /**
   * La vérification n'a PAS JUGÉ : fournisseur inactif, plafond de dépense atteint, modèle indisponible, réponse
   * illisible. Chacun de ces chemins écrit la même forme — note 0, aucun signalement — et un message INTERNE en
   * français technique. Une vraie note de 0 sans aucun signalement n'est pas un verdict que le modèle rend (une
   * annonce qui ne vaut rien porte « incohérente » ou « indésirable ») : la forme suffit à reconnaître le cas.
   */
  non_aboutie: boolean
  /** Le commentaire du modèle (dans la langue de l'auteur) — null quand la vérification n'a pas jugé (message interne). */
  commentaire: string | null
}

/** Les codes de signalement connus — servis à l'écran pour qu'il remplace un code cité dans le commentaire du modèle. */
export const SIGNALEMENTS_CONNUS: readonly PublicationQualityFlag[] = PUBLICATION_QUALITY_FLAGS

export function raisonsDuVerdict(data: unknown, score: number | null): RaisonsDuVerdict {
  const d = (data && typeof data === 'object' ? data : {}) as { score?: unknown; notes?: unknown; flags?: unknown }
  const flags = Array.isArray(d.flags) ? d.flags.filter((f): f is string => typeof f === 'string') : []
  const signalements = PUBLICATION_QUALITY_FLAGS.filter((f) => flags.includes(f))
  const autres = new Set(flags.filter((f) => !(PUBLICATION_QUALITY_FLAGS as readonly string[]).includes(f))).size
  const lue = typeof score === 'number' && Number.isFinite(score) ? score : typeof d.score === 'number' && Number.isFinite(d.score) ? d.score : null
  const sansVerdict = !data || typeof data !== 'object'
  const non_aboutie = sansVerdict || ((lue === null || lue === 0) && flags.length === 0)
  const notes = typeof d.notes === 'string' && d.notes.trim() ? d.notes.trim() : null
  return {
    note: non_aboutie ? null : lue,
    signalements,
    bloquants: signalements.filter((f) => (BLOCKING_FLAGS as readonly string[]).includes(f)),
    autres,
    non_aboutie,
    commentaire: non_aboutie ? null : notes,
  }
}

/**
 * LA VOIE PAR LAQUELLE UNE ANNONCE EST PASSÉE EN LIGNE, relue sur la ligne — la même que la base écrit au grand livre
 * (`publier_annonce()`, clé `voie`). La voie administrateur pose `verified_at` et `published_at` dans la MÊME instruction
 * (même `now()`) ; une annonce refusée puis modifiée et republiée automatiquement garde l'ancien `verified_at`, ANTÉRIEUR
 * à sa nouvelle mise en ligne — d'où la comparaison, et non la seule présence de `verified_by`.
 */
export function voieDeMiseEnLigne(r: {
  published_at: string | null
  verified_by: string | null
  verified_at: string | null
}): 'automatique' | 'administrateur' | null {
  if (!r.published_at) return null
  if (r.verified_by && r.verified_at && Date.parse(r.verified_at) >= Date.parse(r.published_at)) return 'administrateur'
  return 'automatique'
}
