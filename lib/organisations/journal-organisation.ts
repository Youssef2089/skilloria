import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContexteJournal } from '@/lib/journal/contexte'
import { journaliserDans, JournalError } from '@/lib/journal/journaliser'

/**
 * L'ÉCRIVAIN DE LA FICHE D'ORGANISATION — `organisation_modifiee`, pour ses
 * trois routes : les champs (PATCH), le logo déposé, le logo retiré (§D.26,
 * phase B, 2.2). Le logo est une propriété de l'organisation : filtrer sur
 * l'action rend les trois, l'OPÉRATION du détail les distingue.
 *
 * ═══ PAS D'ÉCOSYSTÈME SUR LA LIGNE ═════════════════════════════════════════
 *   Une organisation en rejoint plusieurs (§D.3) : la ligne n'en porte aucun,
 *   comme la ligne d'organisation de `compte_valide`. Le sujet la désigne.
 *
 * ═══ JOURNAL APRÈS ÉCRITURE, MÊME PIÈCE (§C.21) ═════════════════════════════
 *   Un journal qui refuse se DIT : `{ ok: false }`, la route répond
 *   `journal_error` avec l'identifiant de l'organisation.
 *
 * ═══ AUCUNE VALEUR ══════════════════════════════════════════════════════════
 *   Les NOMS des champs touchés (raison sociale, site, adresse… sont des
 *   valeurs) ; pour le logo, rien d'autre que l'opération.
 */
export type ResultatJournal = { ok: true } | { ok: false; message: string }

export async function organisationModifiee(
  admin: SupabaseClient,
  journal: ContexteJournal,
  args: {
    organizationId: string
    operation: 'modification' | 'logo_depose' | 'logo_retire'
    champs?: string[]
  },
): Promise<ResultatJournal> {
  try {
    await journaliserDans(admin, journal, {
      type: 'organisation_modifiee',
      statut: 'reussi',
      ecosystemeId: null,
      sujet: { type: 'organizations', id: args.organizationId },
      detail: { operation: args.operation, champs: args.champs ?? [] },
    })
    return { ok: true }
  } catch (err) {
    if (!(err instanceof JournalError)) throw err
    return { ok: false, message: err.message }
  }
}
