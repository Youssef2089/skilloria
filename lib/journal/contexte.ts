import { estPiece, nouvellePiece, type Piece } from './piece'
import { JournalError, type OrigineJournal, type TypeActeur } from './journaliser'

/**
 * LE CONTEXTE DE JOURNAL — la pièce, et ce qu'on sait du geste (§D.26).
 *
 * ═══ CE QUE C'EST ═══════════════════════════════════════════════════════════
 *   Un objet IMMUABLE créé à l'ENTRÉE d'un geste — la route après son
 *   authentification, la tâche planifiée au début de son passage — et passé
 *   en PARAMÈTRE à tout ce qui en découle : le moteur, le dépôt, le jugement,
 *   la vérification, le budget. Chaque ligne du grand livre écrite en chemin
 *   porte la même pièce, la même origine, le même acteur.
 *
 * ═══ POURQUOI UN PARAMÈTRE, ET RIEN D'AUTRE ═════════════════════════════════
 *   Aucun contexte ambiant : un `AsyncLocalStorage` perdrait la pièce au
 *   premier `after()`, au premier changement de contexte, en silence. Un
 *   paramètre obligatoire ne se perd pas — le compilateur nomme l'appel qui
 *   l'oublie. C'est exactement ainsi que la pièce traverse `after()` : capturée
 *   par la fermeture, comme n'importe quelle valeur (§E.5).
 *
 * ═══ TROIS FABRIQUES, PAS UNE DE PLUS ═══════════════════════════════════════
 *   · `contexteDepuisAuth(auth)` — un geste humain : l'acteur est le compte
 *     authentifié, l'origine découle de son type (admin → administrateur) ;
 *   · `contexteDeTache(job, pieceRecue)` — une tâche planifiée : la pièce est
 *     celle que le pilote SQL a transmise dans le corps HTTP (`gen_random_uuid()`),
 *     ou une pièce neuve s'il n'en a pas envoyé ; aucun acteur ;
 *   · `contexteSysteme()` — ce que la plateforme fait d'elle-même sans geste
 *     ni tâche (rare, et à justifier à chaque usage).
 *   Un rejeu passe par `contexteDepuisAuth(auth, pieceOrigine)` : NOUVELLE
 *   pièce, qui référence l'originale.
 */
export type ActeurJournal = { id: string; type: TypeActeur }

export type ContexteJournal = Readonly<{
  piece: Piece
  origine: OrigineJournal
  acteur: ActeurJournal | null
  ecosystemeId: string | null
  /** Pour un rejeu ou une contrepassation : la pièce du geste d'origine. */
  pieceOrigine: Piece | null
  /** Le nom de la tâche planifiée, quand c'en est une — pour le détail des lignes. */
  tache: string | null
}>

const TYPES_ACTEUR: readonly TypeActeur[] = ['expert_freelance', 'expert_cdi', 'client', 'cabinet', 'admin']

export function estTypeActeur(x: unknown): x is TypeActeur {
  return typeof x === 'string' && (TYPES_ACTEUR as readonly string[]).includes(x)
}

export function ouvrirContexte(args: {
  origine: OrigineJournal
  acteur?: ActeurJournal | null
  ecosystemeId?: string | null
  piece?: Piece
  pieceOrigine?: Piece | null
  tache?: string | null
}): ContexteJournal {
  // La base le tient aussi (grand_livre_acteur_si_humain) ; le dire ici évite
  // d'apprendre en base, à la première écriture, qu'un geste humain n'a pas d'acteur.
  if ((args.origine === 'utilisateur' || args.origine === 'administrateur') && !args.acteur) {
    throw new JournalError('contexte de journal : un geste humain a toujours un acteur', null)
  }
  return Object.freeze({
    piece: args.piece ?? nouvellePiece(),
    origine: args.origine,
    acteur: args.acteur ?? null,
    ecosystemeId: args.ecosystemeId ?? null,
    pieceOrigine: args.pieceOrigine ?? null,
    tache: args.tache ?? null,
  })
}

/** Un geste humain, depuis le contexte d'authentification d'une route. */
export function contexteDepuisAuth(
  auth: { user: { id: string; user_type: string | null }; domain: { id: string } },
  pieceOrigine: Piece | null = null,
): ContexteJournal {
  const type = auth.user.user_type
  if (!estTypeActeur(type)) {
    // requireAuth refuse déjà un type inconnu (unknown_user_type) : ce cas est
    // une incohérence, pas un état — on la nomme plutôt que d'écrire n'importe quoi.
    throw new JournalError(`contexte de journal : type d'acteur inconnu « ${String(type)} »`, null)
  }
  return ouvrirContexte({
    origine: type === 'admin' ? 'administrateur' : 'utilisateur',
    acteur: { id: auth.user.id, type },
    ecosystemeId: auth.domain.id,
    pieceOrigine,
  })
}

/** Une tâche planifiée. La pièce vient du pilote SQL si elle a été transmise, sinon elle naît ici. */
export function contexteDeTache(job: string, pieceRecue?: unknown): ContexteJournal {
  return ouvrirContexte({
    origine: 'tache_planifiee',
    piece: estPiece(pieceRecue) ? pieceRecue : nouvellePiece(),
    tache: job,
  })
}

/** Ce que la plateforme fait d'elle-même — sans geste, sans tâche. À justifier à chaque usage. */
export function contexteSysteme(): ContexteJournal {
  return ouvrirContexte({ origine: 'systeme' })
}
