import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContexteJournal } from '@/lib/journal/contexte'
import { journaliserDans, JournalError } from '@/lib/journal/journaliser'

/**
 * L'ÉCRIVAIN DE LA TAXONOMIE — `taxonomie_modifiee`, pour les SIX routes
 * d'administration des branches et des spécialités (§D.26, phase B, 2.2).
 *
 * ═══ UNE ACTION POUR SIX ROUTES, ET POURQUOI ══════════════════════════════
 *   Créer, modifier ou supprimer une branche ou une spécialité, c'est modifier
 *   LA taxonomie d'un écosystème — et filtrer « taxonomie modifiée » doit
 *   rendre les six. Le détail dit l'OBJET (branche | specialite) et
 *   l'OPÉRATION (creee | modifiee | supprimee) : c'est lui qui distingue, pas
 *   le nom. Un seul écrivain, ici — six copies divergeraient (§E.20).
 *
 * ═══ JOURNAL APRÈS ÉCRITURE, MÊME PIÈCE (§C.21) ═════════════════════════════
 *   Les routes écrivent la table puis les traductions, en plusieurs appels ;
 *   la ligne vient après, sous la pièce du geste. Un journal qui refuse se
 *   DIT : l'écrivain rend `{ ok: false }` et la route répond `journal_error`
 *   avec l'identifiant de ce qui a été écrit.
 *
 * ═══ AUCUNE DONNÉE PERSONNELLE — ET AUCUN LIBELLÉ ═══════════════════════════
 *   Les NOMS des champs touchés et les LANGUES des traductions, jamais leurs
 *   valeurs (un libellé est un texte libre).
 */
export type ResultatJournal = { ok: true } | { ok: false; message: string }

export async function taxonomieModifiee(
  admin: SupabaseClient,
  journal: ContexteJournal,
  args: {
    objet: 'branche' | 'specialite'
    operation: 'creee' | 'modifiee' | 'supprimee'
    id: string
    ecosystemeId: string | null
    branchId?: string | null
    champs?: string[]
    traductions?: string[]
  },
): Promise<ResultatJournal> {
  try {
    await journaliserDans(admin, journal, {
      type: 'taxonomie_modifiee',
      statut: 'reussi',
      ecosystemeId: args.ecosystemeId,
      sujet: { type: args.objet === 'branche' ? 'branches' : 'specialities', id: args.id },
      detail: {
        objet: args.objet,
        operation: args.operation,
        branch_id: args.branchId ?? null,
        champs: args.champs ?? [],
        traductions: args.traductions ?? [],
      },
    })
    return { ok: true }
  } catch (err) {
    if (!(err instanceof JournalError)) throw err
    return { ok: false, message: err.message }
  }
}
