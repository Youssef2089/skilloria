// lib/missions/feed.ts
//
// DÉFINITION UNIQUE de « opportunité visible pour cet expert ».
//
// Symétrique de lib/publications/expiry.ts (règle 30 j) et de
// lib/candidatures/lifecycle.ts (état de vie) : une règle de lecture, un seul
// module, aucune réécriture chez l'appelant.
//
// POURQUOI CE MODULE
//   Le feed (/api/me/missions) appliquait cinq filtres d'éligibilité ; le badge
//   nav (/api/me/badges) lisait la table `matches` toute seule. Résultat vécu :
//   « Missions 1 » dans la sidebar et « Aucune opportunité » sur la page — un
//   match sur une annonce expirée, clôturée, ou un expert en « Ne pas déranger »
//   gonflaient un compteur qui ne pouvait rien afficher. Pire : le badge était
//   IMPURGEABLE, le flip pending→viewed n'ayant lieu qu'à l'ouverture d'un
//   détail que la même expiration renvoyait en 404.
//
//   Le badge doit être un SOUS-ENSEMBLE de la liste PAR CONSTRUCTION, pas par
//   vigilance : les deux lectures passent désormais par les mêmes fonctions.
//   Le seul filtre propre au badge est « non consulté »
//   (status ∈ pending|notified) — tout le reste vient d'ici.
//
// LECTURE PURE
//   Aucune écriture, aucun batch, aucune migration : l'expiration est calculée
//   à la lecture via activePublishedOrClause(). Le nettoyage des matches morts
//   reste le travail de lib/matching/reconcile.ts — on ne le déplace pas ici.
//
// DÉRIVATION SERVEUR (point 20)
//   Le client ne reçoit que des items et des nombres. Il ne rejoue aucune règle.

import type { SupabaseClient } from '@supabase/supabase-js'
import { activePublishedOrClause } from '@/lib/publications/expiry'
// L'ÉTAT DE LA DERNIÈRE RECHERCHE — module PUR, sans import, exécuté tel quel
// par `diag-relance-rejouee` (§E.33). Le redéfinir ici en ferait un second
// lecteur du même fait, et le plafond de tentatives existerait deux fois.
import { etatDerniereRecherche } from '@/lib/matching/run-abouti'
// LA RÈGLE D'ÉLIGIBILITÉ, ÉCRITE UNE FOIS (§D.20).
import { COLONNES_PROFIL, CONDITIONS_ELIGIBILITE, enIndisponibilite, type RaisonIneligible } from '@/lib/matching/eligibilite'

/**
 * Plafond du feed expert. Le badge s'y borne aussi : il ne doit jamais annoncer
 * plus d'items que la page ne peut en afficher.
 */
export const EXPERT_FEED_LIMIT = 200

/** Profil expert minimal requis par les deux lectures. */
export type ExpertFeedProfile = {
  id: string
  verification_status: string | null
}

/**
 * Contexte d'éligibilité de l'expert courant. UN SEUL endroit lit
 * `availability_status` / `cdi_status` — la parité freelance / CDI se joue ici
 * et nulle part ailleurs.
 */
export type ExpertFeedContext = {
  /** `null` si l'user n'a pas de profil expert (ex. membre d'org pur). */
  profile: ExpertFeedProfile | null
  /** verification_status === 'approved'. */
  isApproved: boolean
  /**
   * Barrière « Ne pas déranger », non contournable :
   *   freelance → availability_status = 'do_not_disturb'
   *   CDI       → cdi_status          = 'employed'
   * NULL = disponible (défaut produit).
   */
  isDnd: boolean
  /**
   * `true` ⇔ le feed peut renvoyer au moins un item. C'est LA condition que le
   * badge doit respecter pour ne pas compter dans le vide.
   */
  isOpen: boolean
  /**
   * L'état de la DERNIÈRE recherche, ou `null` si elle a abouti.
   *
   * ⚠️ IL EST ICI ET PAS DANS LA ROUTE, parce que le badge de navigation lit
   *    le MÊME contexte : une route qui le chargerait pour son compte
   *    produirait un second lecteur, et les deux divergeraient (§E.20).
   */
  derniereRecherche: { etat: 'echec'; raison: string; abandonnee: boolean } | null
  /**
   * APPROUVÉ, MAIS HORS DU MOTEUR — la raison NOMMÉE (audit du 30/09/2026, m) : un profil masqué ou
   * un CV dont la ré-analyse a échoué ne reçoit rien, et l'écran « missions » disait « aucune
   * opportunité — vous serez notifié ». `null` quand rien ne l'écarte. La raison vient de la règle
   * partagée (§D.20), jamais d'une expression locale.
   */
  horsDuMoteur: RaisonIneligible | null
  // « UNE NOTIFICATION PARTIRA-T-ELLE ? » (M12) a quitté ce contexte avec `notify_enabled` (lot alertes) : une annonce
  // qui s'affiche prévient TOUJOURS l'expert, dans la cloche. « Vous serez notifié » est donc vrai sans condition —
  // l'e-mail, lui, suit la préférence de l'expert, qu'il règle lui-même.
}



export type ExpertFeedContextResult =
  | { ok: true; context: ExpertFeedContext }
  | { ok: false; message: string }

/**
 * Charge le contexte d'éligibilité de l'expert courant.
 *
 * Erreur de requête → `{ ok: false }` : l'appelant décide (le feed renvoie 500,
 * le badge reste silencieux à 0). On ne fabrique jamais un contexte par défaut
 * sur une lecture ratée — ce serait inventer une éligibilité.
 */
export async function loadExpertFeedContext(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<ExpertFeedContextResult> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select(
      // ⚠️ LES COLONNES D'ÉLIGIBILITÉ SONT DÉRIVÉES DE LA RÈGLE, pas listées :
      //    une condition ajoutée demain charge sa colonne ici toute seule. Un
      //    test sur une colonne non chargée lit `undefined` et conclut (§E.1).
      `id, domain_id, ${COLONNES_PROFIL.join(', ')}, ` +
        // L'ÉTAT DE LA DERNIÈRE RECHERCHE. Sans lui, un flux vide se lit
        // « aucune mission » alors que rien n'a été cherché (§E.27).
        'matching_relance_echec_code, matching_relance_due_at, matching_relance_tentatives',
    )
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    return { ok: false, message: error.message }
  }

  const row = data as
    | {
        id: string
        verification_status: string | null
        availability_status: string | null
        cdi_status: string | null
        matching_relance_echec_code: string | null
        matching_relance_due_at: string | null
        matching_relance_tentatives: number | null
      }
    | null

  if (!row) {
    return {
      ok: true,
      context: {
        profile: null,
        isApproved: false,
        isDnd: false,
        isOpen: false,
        derniereRecherche: null,
        horsDuMoteur: null,
      },
    }
  }

  const isApproved = row.verification_status === 'approved'
  // ⚠️ CE FICHIER ÉTAIT LE TROISIÈME ÉCRIVAIN DE LA RÈGLE, et son commentaire
  //    disait « UN SEUL endroit lit `availability_status` / `cdi_status` ».
  //    Il était vrai du flux, faux du produit : le moteur en avait une autre.
  //    La question est désormais posée à la règle partagée (§D.20), qui la
  //    dérive de ses propres conditions de disponibilité — ajouter un public
  //    demain l'ajoute ici sans toucher à ce fichier.
  const isDnd = enIndisponibilite(row as unknown as Record<string, unknown>)

  // Les conditions du PROFIL que la règle partagée juge pour tout public — la première qui manque.
  // (L'approbation et la disponibilité ont déjà leur propre état : isApproved, isDnd.)
  const ligne = row as unknown as Record<string, unknown>
  const horsDuMoteur =
    CONDITIONS_ELIGIBILITE.find(
      (c) =>
        c.portee === 'toujours' &&
        c.filtre.cible === 'profil' &&
        c.raison !== 'profil_non_approuve' &&
        !(c.remplie as (l: Record<string, unknown>) => boolean)(ligne),
    )?.raison ?? null

  return {
    ok: true,
    context: {
      profile: { id: row.id, verification_status: row.verification_status },
      isApproved,
      isDnd,
      isOpen: isApproved && !isDnd,
      derniereRecherche: etatDerniereRecherche(row),
      horsDuMoteur: isApproved ? horsDuMoteur : null,
    },
  }
}

/**
 * SELECT des matches du feed expert. Les marqueurs `!inner` ne sont PAS
 * négociables : ce sont eux qui rendent effectifs `.eq('publications.status')`
 * et la clause d'expiration sur la ressource imbriquée. Ils vivent donc ici, et
 * l'appelant ne fournit que les colonnes dont il a besoin.
 *
 * Défauts = strict minimum (comptage). Le feed passe ses colonnes de synthèse.
 */
export function buildExpertMissionsSelect(opts?: {
  matchColumns?: string
  publicationColumns?: string
  /** Ressources imbriquées SOUS publications (branches, specialities…). */
  publicationEmbeds?: string
  organizationColumns?: string
}): string {
  const matchColumns = opts?.matchColumns ?? 'id'
  const publicationColumns = opts?.publicationColumns ?? 'id'
  const publicationEmbeds = opts?.publicationEmbeds ? `, ${opts.publicationEmbeds}` : ''
  const organizationColumns = opts?.organizationColumns ?? 'id'
  return (
    `${matchColumns}, ` +
    `publications!inner(${publicationColumns}${publicationEmbeds}, ` +
    `organizations!inner(${organizationColumns}))`
  )
}

/**
 * Requête des matches ÉLIGIBLES de l'expert. Porte l'intégralité des règles
 * d'éligibilité côté publication :
 *   - match non décliné par l'expert       (.neq status dismissed)
 *   - mission NON postulée par l'expert    (.eq mission_postulee false — lot alertes)
 *   - publication publiée                  (.eq publications.status)
 *   - publication NON expirée              (activePublishedOrClause — règle 30 j
 *                                           JAMAIS redéfinie ici)
 *   - organisation existante               (organizations!inner du SELECT)
 *
 * `.in('status', ['pending','notified'])` reste au choix de l'appelant : c'est
 * le seul axe qui distingue « nouveau » d'« éligible ».
 */
export function expertMissionsQuery(
  supabaseAdmin: SupabaseClient,
  profileId: string,
  opts: {
    select: string
    count?: 'exact' | 'planned' | 'estimated'
    head?: boolean
    now?: Date
    /** Vie d'une annonce, en jours — EXIGÉE, aucun défaut (cf. lib/durees.ts). */
    vieAnnonceJours: number
  },
) {
  return supabaseAdmin
    .from('matches')
    .select(opts.select, { count: opts.count, head: opts.head })
    .eq('profile_id', profileId)
    .neq('status', 'dismissed')
    // UNE MISSION POSTULÉE SORT DES RECOMMANDATIONS (lot alertes, freelance et CDI, accueil et « Missions ») : elle
    // vit désormais dans le suivi des candidatures. La réconciliation GARDE le match d'une candidature (acte engagé,
    // lib/matching/reconcile.ts) — c'est donc ICI, à la lecture, qu'il quitte le flux, et le compteur avec lui (même
    // fonction). `mission_postulee(matches)` est un champ CALCULÉ en base (migration `mission_postulee`) : une sonde
    // sur l'index unique (publication, profil) des candidatures, sans liste d'identifiants dans l'adresse.
    .eq('mission_postulee', false)
    .eq('publications.status', 'published')
    .or(
      activePublishedOrClause({ vieAnnonceJours: opts.vieAnnonceJours, now: opts.now }),
      { referencedTable: 'publications' },
    )
}
