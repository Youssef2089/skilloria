import type { SupabaseClient } from '@supabase/supabase-js'
import { cleObjet, referencesDe, type NomsJournal, type ReferenceObjet } from './phrase'

/**
 * LES NOMS DES OBJETS D'UNE PAGE DU GRAND LIVRE, relus au moment de l'affichage (ARRÊT 22, §D.33).
 *
 * Le grand livre ne porte que des identifiants (§D.26) ; une phrase lisible nomme le profil, l'organisation,
 * l'annonce. Les références de chaque ligne viennent de `referencesDe()` (le module des phrases — une seule
 * définition de ce qu'une phrase nomme), les noms de `libelles_journal()` (réservée à l'administrateur, AD002).
 *
 * ⚠️ UNE LECTURE EN PANNE SE DIT : `indisponibles: true`, et l'écran l'annonce — une phrase sans nom n'est pas
 *    une phrase sur un objet sans nom (§E.22). La page, elle, reste lisible : chaque phrase retombe sur le nom
 *    commun de l'objet (« un profil », « une annonce »).
 */
export async function nomsDesLignes(
  admin: SupabaseClient,
  adminId: string,
  lignes: ReadonlyArray<{ type_action: string; sujet_type: string | null; sujet_id: string | null; detail: Record<string, unknown> | null }>,
): Promise<{ noms: NomsJournal; indisponibles: boolean }> {
  const vues = new Map<string, ReferenceObjet>()
  for (const l of lignes) for (const r of referencesDe(l)) vues.set(cleObjet(r.type, r.id), r)
  const refs = [...vues.values()]
  const noms: NomsJournal = {}
  // La fonction borne chaque appel à 500 sujets : on découpe, on ne tronque pas.
  for (let i = 0; i < refs.length; i += 500) {
    const { data, error } = await admin.rpc('libelles_journal', {
      p_admin_id: adminId,
      p_sujets: refs.slice(i, i + 500),
    })
    if (error) {
      console.error('[admin:journal] noms des objets illisibles', error.message)
      return { noms, indisponibles: true }
    }
    for (const r of (data ?? []) as Array<{ sujet_type: string; sujet_id: string; nom: string | null; contexte: string | null }>) {
      noms[cleObjet(r.sujet_type, r.sujet_id)] = { nom: r.nom, contexte: r.contexte }
    }
  }
  return { noms, indisponibles: false }
}
