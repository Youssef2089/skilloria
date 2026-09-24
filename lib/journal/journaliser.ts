import type { SupabaseClient } from '@supabase/supabase-js'
import type { Piece } from './piece'
import type { TypeAction } from './actions'

/**
 * LA SEULE PORTE TYPESCRIPT VERS LE GRAND LIVRE (§D.26).
 *
 * ═══ CE QUE C'EST ═══════════════════════════════════════════════════════════
 *   L'enveloppe de la RPC `journaliser()` — la fonction UNIQUE qui écrit une
 *   ligne du grand livre. Elle sert aux actions qui n'insèrent rien d'autre :
 *   les REFUS (plafond atteint, expert inapte, garde d'éligibilité, quota de
 *   CV, dépôt sans jugement) et les faits sans table (un plafond mord, une
 *   annonce expire). Une action qui ÉCRIT une ligne métier ne passe pas par
 *   ici : elle passe par une RPC métier qui écrit la ligne ET appelle
 *   `journaliser()` dans la même transaction — `regler_durees_place()` en est
 *   le premier exemple.
 *
 * ═══ CE QU'ELLE EXIGE, ET N'INVENTE PAS ═════════════════════════════════════
 *   La pièce et le type sont OBLIGATOIRES, sans défaut : cette fonction ne
 *   fabrique jamais une pièce à la place de l'appelant. Une pièce inventée ici
 *   serait une ligne orpheline qui a l'air reliée.
 *   La base refuse un type absent de la liste fermée (GL003), une pièce nulle
 *   (GL002), un statut contraire à celui que le type impose (GL003) — et
 *   retire du détail toute clé personnelle (`audit_logs_detail_sans_pii`).
 *
 * ═══ UN ÉCHEC LÈVE ══════════════════════════════════════════════════════════
 *   Contrairement à `logAudit` (best-effort, §E.68), un journal qui ne peut
 *   pas écrire le DIT. L'appelant décide ce qu'il en fait — un refus qu'on
 *   n'a pas pu journaliser reste un refus, mais on le sait.
 */
export type StatutJournal = 'reussi' | 'echoue' | 'refuse'
export type OrigineJournal = 'utilisateur' | 'tache_planifiee' | 'administrateur' | 'systeme'
/** Les valeurs de `users.user_type` — l'acteur est un compte, jamais un nom. */
export type TypeActeur = 'expert_freelance' | 'expert_cdi' | 'client' | 'cabinet' | 'admin'

export type EcritureJournal = {
  piece: Piece
  type: TypeAction
  statut: StatutJournal
  origine: OrigineJournal
  acteur?: { id: string; type: TypeActeur } | null
  ecosystemeId?: string | null
  sujet?: { type: string; id: string } | null
  /** Identifiants et faits seulement — la base retire les clés personnelles, le contrôle refuse les valeurs. */
  detail?: Record<string, unknown>
  /** La pièce d'ORIGINE : contrepassation, rejeu (§D.26) — une nouvelle pièce qui la référence. */
  pieceOrigine?: Piece | null
  /** Ce que ça a coûté, dans l'unité FACTURÉE par le fournisseur (§D.24). */
  cout?: { usd: number; unite: string } | null
}

export class JournalError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message)
    this.name = 'JournalError'
  }
}

export async function journaliser(admin: SupabaseClient, e: EcritureJournal): Promise<number> {
  const { data, error } = await admin.rpc('journaliser', {
    p_piece: e.piece,
    p_type_action: e.type,
    p_statut: e.statut,
    p_origine: e.origine,
    p_acteur_id: e.acteur?.id ?? null,
    p_acteur_type: e.acteur?.type ?? null,
    p_ecosysteme_id: e.ecosystemeId ?? null,
    p_sujet_type: e.sujet?.type ?? null,
    p_sujet_id: e.sujet?.id ?? null,
    p_detail: e.detail ?? {},
    p_piece_origine: e.pieceOrigine ?? null,
    p_cout_usd: e.cout?.usd ?? null,
    p_unite_facturee: e.cout?.unite ?? null,
  })
  if (error) {
    throw new JournalError(`grand livre : écriture refusée (${e.type}) — ${error.message}`, error.code ?? null)
  }
  return Number(data)
}
