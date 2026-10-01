import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContexteJournal } from './contexte'
import { JournalError } from './journaliser'
import type { DetailDe, SousDetail } from './detail'

/**
 * `reglage_modifie` DEPUIS LE CODE — pour les gestes qu'une transaction ne
 * peut pas contenir (§D.26, §C.21).
 *
 * L'écrivain unique de `reglage_modifie` est la RPC `journaliser_reglage()`
 * (migration `journal_reglages`). Les réglages simples l'appellent depuis leur
 * RPC métier, dans la même transaction. Ceux-ci l'appellent depuis le code,
 * APRÈS leur écriture, sous la même pièce :
 *   · créer ou modifier une offre — Stripe est synchronisé au milieu ;
 *   · attribuer ou migrer des offres — plusieurs lignes, une décision ;
 *   · synchroniser le catalogue — l'écriture est chez Stripe.
 * Un texte libre n'entre pas (la liste blanche le refuse) : le détail porte
 * les colonnes touchées et un complément NOMMÉ. Un réglage aboutit ou échoue
 * (`statut`) ; il n'est jamais « refusé » par ici.
 *
 * UN ÉCHEC LÈVE (`JournalError`) : l'appelant a déjà écrit, il le dit avec
 * l'identifiant de ce qu'il a écrit — jamais un succès muet.
 */
export async function journaliserReglage(
  admin: SupabaseClient,
  journal: ContexteJournal,
  r: {
    sujet: { type: string; id: string }
    avant: SousDetail<'reglage_modifie', 'avant'>
    apres: SousDetail<'reglage_modifie', 'apres'>
    /** Les clés de premier niveau de `reglage_modifie` — la base fusionne avant, après et complément. */
    complement?: DetailDe<'reglage_modifie'>
    statut?: 'reussi' | 'echoue'
  },
): Promise<number | null> {
  if (!journal.acteur) {
    throw new JournalError('reglage_modifie : un réglage a toujours un auteur', null)
  }
  const { data, error } = await admin.rpc('journaliser_reglage', {
    p_piece: journal.piece,
    p_acteur_id: journal.acteur.id,
    p_ecosysteme_id: journal.ecosystemeId,
    p_sujet_type: r.sujet.type,
    p_sujet_id: r.sujet.id,
    p_avant: r.avant,
    p_apres: r.apres,
    p_complement: r.complement ?? {},
    p_statut: r.statut ?? 'reussi',
  })
  if (error) {
    throw new JournalError(`grand livre : reglage_modifie refusé (${r.sujet.type}) — ${error.message}`, error.code ?? null)
  }
  // `null` : rien n'a changé, rien ne s'est écrit (décision de Youssef, 01/10/2026, ARRÊT 22) — pas une panne.
  return data === null ? null : Number(data)
}
