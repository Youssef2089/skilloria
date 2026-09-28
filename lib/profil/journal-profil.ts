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

/**
 * LE PROFIL PUBLIÉ — l'expert se rend visible (`visible: true`), première
 * fois ou republication : toute (re)publication relance la vérification, et
 * la ligne le dit avec l'état de vérification d'AVANT. Écrite avant la
 * vérification qui en découle : c'est le geste qui compte, pas son issue —
 * l'approbation a sa propre action (`compte_valide`).
 */
export async function profilPublie(
  admin: SupabaseClient,
  journal: ContexteJournal,
  args: { profileId: string; dejaVisible: boolean; verificationAvant: string | null },
): Promise<void> {
  await journaliserDans(admin, journal, {
    type: 'profil_publie',
    statut: 'reussi',
    sujet: { type: 'profiles', id: args.profileId },
    detail: { deja_visible: args.dejaVisible, verification_avant: args.verificationAvant },
  })
}

/**
 * LE PROFIL MODIFIÉ — les NOMS des champs scalaires et des blocs touchés
 * (expériences, formations, langues), jamais leur contenu. Une modification
 * qui ne fait que publier ou basculer la disponibilité n'écrit pas cette
 * ligne : ces deux gestes ont la leur (`profil_publie`, `disponibilite_basculee`).
 */
export async function profilModifie(
  admin: SupabaseClient,
  journal: ContexteJournal,
  args: { profileId: string; champs: string[]; blocs: string[] },
): Promise<void> {
  await journaliserDans(admin, journal, {
    type: 'profil_modifie',
    statut: 'reussi',
    sujet: { type: 'profiles', id: args.profileId },
    detail: { champs: args.champs, blocs: args.blocs },
  })
}

/**
 * LA DISPONIBILITÉ BASCULÉE — le champ de la voie (`availability_status` en
 * freelance, `cdi_status` en CDI — §D.14), l'état d'AVANT tel que lu avec le
 * profil, l'état d'après. Des codes, jamais une date ni un texte.
 */
export async function disponibiliteBasculee(
  admin: SupabaseClient,
  journal: ContexteJournal,
  // Les deux ouvertures croisées (`open_to_cdi`, `open_to_freelance`) sont des bascules de
  // disponibilité : elles passent par le même geste (POST /api/profile/disponibilite), la même action.
  args: {
    profileId: string
    champ: 'availability_status' | 'cdi_status' | 'open_to_cdi' | 'open_to_freelance'
    de: string | boolean | null
    vers: string | boolean | null
  },
): Promise<void> {
  await journaliserDans(admin, journal, {
    type: 'disponibilite_basculee',
    statut: 'reussi',
    sujet: { type: 'profiles', id: args.profileId },
    detail: { champ: args.champ, de: args.de, vers: args.vers },
  })
}

/**
 * LE CV RÉINITIALISÉ — la remise à zéro COMPLÈTE : le fichier, tout ce que
 * l'analyse avait rempli, les sous-tables, le consentement à l'analyse, et le
 * profil repasse en brouillon hors-ligne. La ligne dit s'il QUITTE LA VITRINE
 * (il était visible des organisations) et s'il portait un fichier — deux faits,
 * aucune valeur du profil.
 */
export async function cvReinitialise(
  admin: SupabaseClient,
  journal: ContexteJournal,
  args: { profileId: string; retireDeLaVitrine: boolean; avaitUnFichier: boolean },
): Promise<void> {
  await journaliserDans(admin, journal, {
    type: 'cv_reinitialise',
    statut: 'reussi',
    sujet: { type: 'profiles', id: args.profileId },
    detail: { retire_de_la_vitrine: args.retireDeLaVitrine, avait_un_fichier: args.avaitUnFichier },
  })
}
