import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContexteJournal } from '@/lib/journal/contexte'
import { journaliserDans } from '@/lib/journal/journaliser'

/**
 * LES ÉCRIVAINS DU PROFIL — le CV, la publication, la modification, la
 * disponibilité (§D.26). Un écrivain par action, dans UN module : les DEUX
 * voies (freelance, CDI — parité §D.14) l'appellent, deux écrivains
 * divergeraient (§E.20).
 *
 * ═══ MOTIF « JOURNAL APRÈS ÉCRITURE, MÊME PIÈCE » (§C.21) ══════════════════
 *   Le CV passe par le Storage puis par le modèle ; le profil est un UPDATE
 *   dynamique. Rien de tout cela ne tient dans une transaction : la ligne
 *   vient après, sous la pièce du geste, et un journal qui refuse LÈVE — la
 *   route répond `journal_error` avec l'identifiant de ce qui a été écrit.
 *
 * ═══ AUCUNE DONNÉE PERSONNELLE ══════════════════════════════════════════════
 *   Des tailles, des comptes, des codes. Jamais le nom du fichier, jamais
 *   l'empreinte du CV (elle identifie un contenu), jamais un champ du profil.
 */

/**
 * LE CV TÉLÉVERSÉ — une ligne pour le geste ENTIER : stocké, analysé (ou non),
 * et le consentement à l'analyse posé pour la première fois s'il l'a été.
 * Écrite à la fin du geste, quand l'issue est connue ; statut de l'ÉTAPE :
 * `echoue` si l'analyse a échoué (le fichier, lui, est stocké).
 */
export async function cvTeleverse(
  admin: SupabaseClient,
  journal: ContexteJournal,
  args: {
    profileId: string
    octets: number
    analyse: 'done' | 'failed'
    premierConsentement: boolean
    experiences?: number
    formations?: number
    langues?: number
  },
): Promise<void> {
  await journaliserDans(admin, journal, {
    type: 'cv_televerse',
    statut: args.analyse === 'done' ? 'reussi' : 'echoue',
    sujet: { type: 'profiles', id: args.profileId },
    detail: {
      octets: args.octets,
      analyse: args.analyse,
      premier_consentement: args.premierConsentement,
      experiences: args.experiences,
      formations: args.formations,
      langues: args.langues,
    },
  })
}
