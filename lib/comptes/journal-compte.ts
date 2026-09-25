import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContexteJournal } from '@/lib/journal/contexte'
import { journaliserDans } from '@/lib/journal/journaliser'

/**
 * LES ÉCRIVAINS DE LA SÉCURITÉ DU COMPTE — sessions, suppression, e-mail, mot
 * de passe, téléphone (§D.26). Un écrivain par action, dans UN module.
 *
 * ═══ MOTIF « JOURNAL APRÈS ÉCRITURE, MÊME PIÈCE » (§C.21) ══════════════════
 *   Ces gestes n'écrivent pas tous dans une table métier : le mot de passe et
 *   l'e-mail vivent chez Supabase Auth, la rotation de session est un helper
 *   partagé. Rien de cela ne tient dans une transaction Postgres : la ligne
 *   vient APRÈS, sous la pièce du geste, et un journal qui refuse LÈVE — la
 *   route répond `journal_error` plutôt qu'un 200 qui ment.
 *
 * ═══ AUCUNE DONNÉE PERSONNELLE ══════════════════════════════════════════════
 *   Ni adresse, ni numéro, ni mot de passe, ni jeton. Ce qui s'écrit est le
 *   FAIT : une session a été révoquée, une adresse a été changée (et non
 *   laquelle), un numéro a été vérifié (et non lequel). Les routes le faisaient
 *   déjà pour leur audit ; le grand livre tient la même règle, et la liste
 *   blanche la rend inviolable.
 */

/**
 * LES AUTRES SESSIONS RÉVOQUÉES — le geste du titulaire, jamais un effet de
 * bord. La rotation qui accompagne une SUSPENSION et l'effacement qui
 * accompagne une SUPPRESSION ne passent pas par ici : ce sont des effets, et
 * leurs actions (`compte_suspendu`, `suppression_programmee`) les portent.
 * Confondre les trois ferait lire « l'utilisateur a révoqué ses sessions »
 * là où un administrateur l'a suspendu.
 *
 * Sujet : le compte lui-même. Aucun détail — il n'y a rien à dire de plus que
 * le fait, et le nombre de sessions tombées n'est connu de personne.
 */
export async function sessionRevoquee(
  admin: SupabaseClient,
  journal: ContexteJournal,
  args: { userId: string },
): Promise<void> {
  await journaliserDans(admin, journal, {
    type: 'session_revoquee',
    statut: 'reussi',
    sujet: { type: 'users', id: args.userId },
    detail: {},
  })
}

/**
 * LA SUPPRESSION ANNULÉE — le compte revient toujours ; la VISIBILITÉ du
 * profil, elle, ne revient que si elle était acquise avant la suppression ET
 * que le profil est encore complet. Écrire l'un sans l'autre laisserait croire
 * qu'un expert réactivé est de nouveau visible alors qu'il ne l'est pas.
 * `avait_un_profil` distingue l'expert de l'organisation : sans lui, une
 * visibilité « non restaurée » se lirait comme un refus là où il n'y a
 * simplement pas de profil.
 */
export async function suppressionAnnulee(
  admin: SupabaseClient,
  journal: ContexteJournal,
  args: { userId: string; visibiliteRestauree: boolean; avaitUnProfil: boolean },
): Promise<void> {
  await journaliserDans(admin, journal, {
    type: 'suppression_annulee',
    statut: 'reussi',
    sujet: { type: 'users', id: args.userId },
    detail: { visibilite_restauree: args.visibiliteRestauree, avait_un_profil: args.avaitUnProfil },
  })
}

/**
 * LE CHANGEMENT D'ADRESSE — LA DEMANDE, PAS LA BASCULE. La route déclenche
 * l'e-mail de confirmation ; l'adresse ne change que quand la personne clique
 * le lien. Écrire « adresse changée » ici annoncerait un fait qui n'est pas
 * arrivé (§E.24) : `etape` dit ce qui EST arrivé. Le jour où le retour du lien
 * sera branché, il écrira la même action avec `'confirme'`.
 *
 * Ni l'ancienne adresse ni la nouvelle n'entrent dans la ligne.
 */
export async function emailChange(
  admin: SupabaseClient,
  journal: ContexteJournal,
  args: { userId: string; etape: 'demande' | 'confirme' },
): Promise<void> {
  await journaliserDans(admin, journal, {
    type: 'email_change',
    statut: 'reussi',
    sujet: { type: 'users', id: args.userId },
    detail: { etape: args.etape },
  })
}

/**
 * LE MOT DE PASSE CHANGÉ — la bascule est IMMÉDIATE (contrairement à
 * l'adresse), il n'y a donc pas d'étape à distinguer. Aucun détail : ni le
 * mot de passe, ni son empreinte, ni sa LONGUEUR — elle n'a l'air de rien et
 * réduit l'espace de recherche. La liste blanche vide refuse tout.
 */
export async function motDePasseChange(
  admin: SupabaseClient,
  journal: ContexteJournal,
  args: { userId: string },
): Promise<void> {
  await journaliserDans(admin, journal, {
    type: 'mot_de_passe_change',
    statut: 'reussi',
    sujet: { type: 'users', id: args.userId },
    detail: {},
  })
}
