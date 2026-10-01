import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContexteJournal } from '@/lib/journal/contexte'
import { journaliserDans, JournalError } from '@/lib/journal/journaliser'
import { clesModifiees } from '@/lib/profil/changements'

/**
 * CE QUI CHANGE VRAIMENT dans une branche ou une spécialité (décision de Youssef, 01/10/2026, ARRÊT 22) : le
 * formulaire renvoie ses champs et TOUTES ses traductions ; « Taxonomie modifiée » ne doit nommer que ce qui change,
 * et ne pas s'écrire si rien ne change. Relu AVANT l'écriture ; une relecture en panne compte tout comme modifié.
 */
export async function changementsTaxonomie(
  admin: SupabaseClient,
  args: {
    table: 'branches' | 'specialities'
    id: string
    updates: Record<string, unknown>
    aEcrire: Array<{ locale: string; value: string }>
    aEffacer: string[]
  },
): Promise<{ champs: string[]; traductions: string[] }> {
  const cles = Object.keys(args.updates).filter((k) => k !== 'updated_at')
  let champs = cles
  if (cles.length > 0) {
    const { data, error } = await admin.from(args.table).select(cles.join(', ')).eq('id', args.id).maybeSingle()
    if (!error && data) {
      champs = clesModifiees(Object.fromEntries(cles.map((k) => [k, args.updates[k]])), data as unknown as Record<string, unknown>)
    }
  }
  const { data: tr, error: trErr } = await admin
    .from('translations')
    .select('locale, value')
    .eq('table_name', args.table)
    .eq('row_id', args.id)
    .eq('field', 'name')
  if (trErr) return { champs, traductions: [...args.aEcrire.map((t) => t.locale), ...args.aEffacer] }
  const existantes = new Map((tr ?? []).map((t) => [t.locale as string, t.value as string]))
  const traductions = [
    ...args.aEcrire.filter((t) => existantes.get(t.locale) !== t.value).map((t) => t.locale),
    ...args.aEffacer.filter((l) => existantes.has(l)),
  ]
  return { champs, traductions }
}

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
    /** Une modification sans aucun changement réel : rien ne s'écrit. */
    rienNeChange?: boolean
  },
): Promise<ResultatJournal> {
  if (args.rienNeChange) return { ok: true }
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
