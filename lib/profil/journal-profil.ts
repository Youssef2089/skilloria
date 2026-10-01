import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContexteJournal } from '@/lib/journal/contexte'
import { journaliserDans } from '@/lib/journal/journaliser'
import { DELAI_RELANCE_MINUTES } from '@/lib/matching/relance'
import { dejaDitDansLaSeance } from '@/lib/profil/changements'

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
 * LE CV TÉLÉVERSÉ — une ligne pour le geste ENTIER : stocké, analysé, et le
 * consentement à l'analyse posé pour la première fois s'il l'a été.
 *
 * Depuis le 30/09/2026 (§D.30), l'analyse est un TRAVAIL : cette ligne est écrite
 * par l'exécutant quand l'analyse ABOUTIT, sous la pièce du dépôt, avec le nombre
 * d'ÉCARTS (valeurs du document ramenées ou écartées, §E.88). Un travail abandonné
 * a SA ligne (`travail_ia_echoue`, écrite en base, même pièce) : l'échec ne se
 * perd pas, et il n'est pas écrit deux fois.
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
    ecarts?: number
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
      ecarts: args.ecarts,
    },
  })
}

/**
 * LE PROFIL PUBLIÉ — l'expert se rend visible (`visible: true`), première
 * fois ou republication : toute (re)publication relance la vérification, et
 * la ligne le dit avec l'état de vérification d'AVANT. Écrite avant la
 * vérification qui en découle : c'est le geste qui compte, pas son issue —
 * le verdict a SA ligne : `verification_conclue` quand la machine conclut
 * (approuvé, ou déféré à un humain), `compte_valide` / `compte_refuse` quand un
 * administrateur arbitre.
 */
/**
 * LA PHOTO DÉPOSÉE (fusion de la recette S1, décision de Youssef, 01/10/2026) — à CHAQUE dépôt, remplacement compris.
 * Le chemin du fichier est dérivé du compte et ne change jamais : « Profil modifié » ne verrait pas un remplacement
 * (ARRÊT 22 : une ligne seulement si une valeur change). Or une photo remplacée change ce qu'une organisation voit après
 * dévoilement (§D.4, §D.5). Le détail dit seulement si une photo existait déjà.
 */
export async function photoDeposee(
  admin: SupabaseClient,
  journal: ContexteJournal,
  args: { profileId: string; remplacement: boolean },
): Promise<void> {
  await journaliserDans(admin, journal, {
    type: 'photo_deposee',
    statut: 'reussi',
    sujet: { type: 'profiles', id: args.profileId },
    detail: { remplacement: args.remplacement },
  })
}

/**
 * LE CV CONSULTÉ PAR UN ADMINISTRATEUR (fusion de la recette S1, décision de Youssef, 01/10/2026) — LA SEULE
 * consultation qui s'écrit : un accès du personnel à une donnée personnelle. Écrite quand le lien est signé ; l'appelant
 * ne rend aucun lien si elle échoue. Détail vide : ni chemin, ni nom de fichier.
 */
export async function cvConsulte(
  admin: SupabaseClient,
  journal: ContexteJournal,
  args: { profileId: string },
): Promise<void> {
  await journaliserDans(admin, journal, {
    type: 'cv_consulte',
    statut: 'reussi',
    sujet: { type: 'profiles', id: args.profileId },
    detail: {},
  })
}

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
 * LE PROFIL MODIFIÉ — les NOMS des champs scalaires et des blocs qui ont VRAIMENT changé (expériences, formations,
 * langues), jamais leur contenu. Une modification qui ne fait que publier ou basculer la disponibilité n'écrit pas
 * cette ligne : ces deux gestes ont la leur (`profil_publie`, `disponibilite_basculee`).
 *
 * UNE LIGNE PAR SÉANCE D'ÉDITION (décision de Youssef, 01/10/2026, ARRÊT 22) : l'appelant ne passe que ce qui a changé
 * (lib/profil/changements.ts) ; ici, un enregistrement qui ne touche que des champs déjà dits par la ligne de la
 * même séance — celle des `DELAI_RELANCE_MINUTES` dernières minutes, le délai que la recherche attend déjà avant de
 * repartir — n'en écrit pas une autre. Des champs NOUVEAUX écrivent une ligne : rien ne se tait.
 * La ligne précédente se lit au grand livre ; une lecture en panne n'empêche pas d'écrire (le doute écrit).
 */
export async function profilModifie(
  admin: SupabaseClient,
  journal: ContexteJournal,
  args: { profileId: string; champs: string[]; blocs: string[] },
): Promise<void> {
  if (args.champs.length === 0 && args.blocs.length === 0) return
  const depuis = new Date(Date.now() - DELAI_RELANCE_MINUTES * 60 * 1000).toISOString()
  const { data: recente, error } = await admin
    .from('grand_livre')
    .select('detail')
    .eq('type_action', 'profil_modifie')
    .eq('sujet_id', args.profileId)
    .gte('horodatage', depuis)
    .order('horodatage', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!error && recente) {
    const d = (recente.detail ?? {}) as { champs?: unknown; blocs?: unknown }
    const precedente = {
      champs: Array.isArray(d.champs) ? (d.champs as string[]) : [],
      blocs: Array.isArray(d.blocs) ? (d.blocs as string[]) : [],
    }
    if (dejaDitDansLaSeance({ champs: args.champs, blocs: args.blocs }, precedente)) return
  }
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
