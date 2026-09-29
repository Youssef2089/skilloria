import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContexteJournal } from '@/lib/journal/contexte'
import { journaliserDans, JournalError } from '@/lib/journal/journaliser'

/**
 * LES ÉCRIVAINS DES ÉCOSYSTÈMES — `ecosysteme_cree` et `ecosysteme_modifie`
 * (§D.26, phase B, 2.2). Un écrivain par action, dans UN module.
 *
 * ═══ DEUX ACTIONS, ET POURQUOI ═════════════════════════════════════════════
 *   Une création filtrée sous « écosystème modifié » serait un chiffre juste
 *   sous une étiquette fausse (§E.24) : la création a son nom (arbitré par
 *   Youssef, audit de la phase B). La modification garde les trois routes
 *   (les champs, le visuel déposé, le visuel retiré) — l'activation en est
 *   une, dite par l'OPÉRATION du détail, parce qu'elle ouvre ou ferme
 *   l'écosystème aux organisations et ne doit pas se noyer dans le reste.
 *
 * ═══ JOURNAL APRÈS ÉCRITURE, MÊME PIÈCE (§C.21) ═════════════════════════════
 *   Un journal qui refuse se DIT : `{ ok: false }`, la route répond
 *   `journal_error` avec l'identifiant de l'écosystème.
 *
 * ═══ AUCUN TEXTE LIBRE ══════════════════════════════════════════════════════
 *   Le slug (un identifiant : le sous-domaine), les NOMS des champs, les CLÉS
 *   des traductions — jamais un nom, une accroche, une description.
 */
export type ResultatJournal = { ok: true } | { ok: false; message: string }

async function ecrire(fn: () => Promise<unknown>): Promise<ResultatJournal> {
  try {
    await fn()
    return { ok: true }
  } catch (err) {
    if (!(err instanceof JournalError)) throw err
    return { ok: false, message: err.message }
  }
}

/** L'ÉCOSYSTÈME CRÉÉ — il naît désactivé ; la ligne dit si sa configuration est née avec lui. */
export async function ecosystemeCree(
  admin: SupabaseClient,
  journal: ContexteJournal,
  args: { id: string; slug: string; configurationCreee: boolean },
): Promise<ResultatJournal> {
  return ecrire(() =>
    journaliserDans(admin, journal, {
      type: 'ecosysteme_cree',
      statut: 'reussi',
      ecosystemeId: args.id,
      sujet: { type: 'domains', id: args.id },
      detail: { slug: args.slug, configuration_creee: args.configurationCreee },
    }),
  )
}

/**
 * L'ÉCOSYSTÈME MODIFIÉ — les champs (l'activation et la désactivation sont des
 * OPÉRATIONS à part, elles ouvrent ou ferment l'écosystème), le visuel déposé,
 * le visuel retiré, ou le SOUS-DOMAINE changé (une opération à part, elle aussi :
 * elle déplace l'adresse de l'écosystème). Les NOMS des champs, les CLÉS des
 * traductions touchées (`table.champ.langue`), le TYPE de visuel, et pour le
 * sous-domaine l'ancien et le nouveau — des identifiants d'adresse, jamais un texte.
 */
export async function ecosystemeModifie(
  admin: SupabaseClient,
  journal: ContexteJournal,
  args: {
    id: string
    operation: 'modification' | 'activation' | 'desactivation' | 'visuel_depose' | 'visuel_retire' | 'sous_domaine'
    champs?: string[]
    traductions?: string[]
    visuel?: string | null
    sousDomaine?: { avant: string; apres: string }
  },
): Promise<ResultatJournal> {
  return ecrire(() =>
    journaliserDans(admin, journal, {
      type: 'ecosysteme_modifie',
      statut: 'reussi',
      ecosystemeId: args.id,
      sujet: { type: 'domains', id: args.id },
      detail: {
        operation: args.operation,
        champs: args.champs ?? [],
        traductions: args.traductions ?? [],
        visuel: args.visuel ?? null,
        // Clé par clé, jamais par étalement (§E.38) : le type vérifie ce qui part.
        sous_domaine: args.sousDomaine ? { avant: args.sousDomaine.avant, apres: args.sousDomaine.apres } : null,
      },
    }),
  )
}
