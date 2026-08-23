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
    .select('id, verification_status, availability_status, cdi_status')
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
      }
    | null

  if (!row) {
    return {
      ok: true,
      context: { profile: null, isApproved: false, isDnd: false, isOpen: false },
    }
  }

  const isApproved = row.verification_status === 'approved'
  const isDnd = row.availability_status === 'do_not_disturb' || row.cdi_status === 'employed'

  return {
    ok: true,
    context: {
      profile: { id: row.id, verification_status: row.verification_status },
      isApproved,
      isDnd,
      isOpen: isApproved && !isDnd,
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
  },
) {
  return supabaseAdmin
    .from('matches')
    .select(opts.select, { count: opts.count, head: opts.head })
    .eq('profile_id', profileId)
    .neq('status', 'dismissed')
    .eq('publications.status', 'published')
    .or(activePublishedOrClause(opts.now ?? new Date()), { referencedTable: 'publications' })
}
