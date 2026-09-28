import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContexteJournal } from '@/lib/journal/contexte'
import { journaliserDans } from '@/lib/journal/journaliser'

/**
 * LES ÉCRIVAINS DES ROUTES D'INSCRIPTION — la ligne que la ROUTE écrit, sous la
 * pièce qu'elle a mise dans les métadonnées d'inscription (§D.26, décision A).
 *
 * ═══ DEUX LIGNES, DEUX FAITS ═══════════════════════════════════════════════
 *   `compte_cree` est écrite par `handle_new_user`, pour TOUTE création de
 *   compte — appel direct à l'API d'authentification compris. Elle ne sait pas
 *   par quelle voie le compte arrive : la voie y est DÉCLARÉE. La ligne d'ici
 *   est la PREUVE que la route est passée, avec ce qu'elle seule vérifie (le
 *   téléphone par OTP, l'acceptation des CGU, et pour une organisation le
 *   domaine d'adresse, l'unicité, l'organisation créée). Même pièce : on
 *   remonte de l'une à l'autre.
 *
 * ═══ LA LIGNE SUIT L'ISSUE RÉELLE ══════════════════════════════════════════
 *   Réussie : le compte existe, finalisé. Échouée : la route a NETTOYÉ le compte
 *   (public.users puis auth.users, `atomicCleanup`) — la ligne `compte_cree`
 *   reste vraie (le compte a existé), celle-ci dit qu'il n'existe plus et
 *   pourquoi (un CODE, jamais un message). Un échec AVANT la création du compte
 *   (validation, OTP, adresse prise) n'écrit rien : aucun état n'a changé, et la
 *   route rend un code stable à l'appelant.
 *
 * ═══ AUCUNE DONNÉE PERSONNELLE ══════════════════════════════════════════════
 *   Ni téléphone, ni adresse, ni nom. Le type de compte, la version des CGU, un
 *   code de cause.
 */

type TypeExpert = 'expert_freelance' | 'expert_cdi'

/**
 * L'EXPERT INSCRIT — freelance ou CDI, par `register-expert` : le compte créé
 * par le trigger est finalisé (téléphone vérifié, CGU acceptées).
 */
export async function expertInscrit(
  admin: SupabaseClient,
  journal: ContexteJournal,
  args:
    | { userId: string; typeDeCompte: TypeExpert; issue: 'reussi'; cguVersion: string }
    | { userId: string; typeDeCompte: TypeExpert; issue: 'echoue'; cause: string },
): Promise<void> {
  if (args.issue === 'reussi') {
    await journaliserDans(admin, journal, {
      type: 'expert_inscrit',
      statut: 'reussi',
      sujet: { type: 'users', id: args.userId },
      detail: { type_de_compte: args.typeDeCompte, cgu_version: args.cguVersion },
    })
    return
  }
  await journaliserDans(admin, journal, {
    type: 'expert_inscrit',
    statut: 'echoue',
    sujet: { type: 'users', id: args.userId },
    detail: { type_de_compte: args.typeDeCompte, cause: args.cause, compte_nettoye: true },
  })
}

/**
 * L'ORGANISATION PRÉINSCRITE — client, cabinet ou ESN, par `register-org` : le
 * compte créé par le trigger est finalisé (téléphone, CGU) ET son organisation
 * naît avec son administrateur (`creer_organisation_avec_admin`). Réussie : le
 * sujet est l'organisation. Échouée : le sujet est le compte — l'organisation,
 * si elle était née, a été retirée avec lui.
 */
export async function organisationPreinscrite(
  admin: SupabaseClient,
  journal: ContexteJournal,
  args:
    | { issue: 'reussi'; organizationId: string; orgType: 'client' | 'cabinet' | 'esn'; domainePublic: boolean }
    | { issue: 'echoue'; userId: string; orgType: 'client' | 'cabinet' | 'esn'; cause: string; organisationNettoyee: boolean },
): Promise<void> {
  if (args.issue === 'reussi') {
    await journaliserDans(admin, journal, {
      type: 'organisation_preinscrite',
      statut: 'reussi',
      sujet: { type: 'organizations', id: args.organizationId },
      detail: { org_type: args.orgType, domaine_public: args.domainePublic },
    })
    return
  }
  await journaliserDans(admin, journal, {
    type: 'organisation_preinscrite',
    statut: 'echoue',
    sujet: { type: 'users', id: args.userId },
    detail: { org_type: args.orgType, cause: args.cause, compte_nettoye: true, organisation_nettoyee: args.organisationNettoyee },
  })
}
