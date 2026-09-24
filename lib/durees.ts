import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * LES TROIS DURÉES DU CONTRAT DE LA PLACE — lues en base, jamais supposées.
 *
 * ═══ POURQUOI IL N'Y A AUCUNE VALEUR PAR DÉFAUT DANS CE FICHIER ═════════════
 *   Les deux durées vivaient en constantes (`PUBLICATION_TTL_DAYS = 30`,
 *   `CONVERSATION_TTL_DAYS = 15`). Les rendre réglables en laissant un défaut
 *   dans le code n'aurait rien réglé : on aurait eu DEUX sources — celle de la
 *   base, et celle qui prend la main le jour où la lecture échoue, c'est-à-dire
 *   exactement le jour où l'on comprend le moins ce qui se passe.
 *
 *   Le projet a déjà tranché ce cas, et dans ce sens : `matching_settings`
 *   absents ⇒ le moteur REFUSE et le dit, sans repli codé en dur. Même règle
 *   ici.
 *
 *   Conséquence assumée : une lecture en échec fait répondre la route, avec une
 *   raison nommable, au lieu de servir une durée inventée. Le risque réel est
 *   faible — cette lecture touche la même base que les autres requêtes de la
 *   route, qui échoueraient de toute façon — et le risque inverse est pire :
 *   une place qui applique 30 jours pendant qu'on croit en avoir réglé 20.
 *
 * ═══ LA LECTURE EST FAITE PAR LES ROUTES ════════════════════════════════════
 *   Aucune mémoïsation, aucun cache de module. Une durée mise en cache
 *   continuerait d'appliquer l'ancienne valeur après un réglage — sur un
 *   serveur, pendant un temps que personne ne saurait nommer. C'est une lecture
 *   d'une ligne par clé primaire ; le même raisonnement que `chargerTarif`
 *   (lib/ai-budget.ts) et `lib/ai-quotas.ts`.
 *
 * ═══ L'ASYMÉTRIE, QU'IL FAUT CONNAÎTRE AVANT DE RÉGLER ══════════════════════
 *   `vieAnnonceJours`      — RÉTROACTIVE. `publications.expires_at` n'est jamais
 *                            écrit : l'activité se calcule `published_at + durée`
 *                            à CHAQUE lecture. La baisser expire immédiatement
 *                            des annonces déjà en ligne.
 *   `fenetreEchangeJours`  — NON rétroactive. `conversations.expires_at` est
 *                            écrit au déblocage ; les conversations ouvertes
 *                            gardent leur date.
 *   `invitationJours`      — NON rétroactive, pour la même raison :
 *                            `organization_invitations.expires_at` est écrit à
 *                            la création et réécrit au renvoi.
 *
 *   **Une seule des trois rétroagit, et c'est celle qui retire quelque chose.**
 *   Ce n'est pas un choix d'implémentation qu'on pourrait revoir : c'est ce que
 *   veut dire « une date écrite » contre « une règle appliquée à la lecture ».
 */

export type Durees = {
  /** Vie d'une annonce publiée, en jours. Changement RÉTROACTIF. */
  vieAnnonceJours: number
  /** Fenêtre d'échange ouverte au déblocage, en jours. Changement NON rétroactif. */
  fenetreEchangeJours: number
  /**
   * Validité d'une invitation d'organisation, en jours. Changement NON
   * rétroactif : `organization_invitations.expires_at` est ÉCRIT à la création
   * et RÉÉCRIT au renvoi. Elle vivait EN DUR, et dans DEUX fichiers.
   */
  invitationJours: number
}

export type LectureDurees =
  | { ok: true; durees: Durees }
  | { ok: false; raison: string }

/** Le code que les routes rendent quand la lecture échoue. Un seul, nommable. */
export const DUREES_ILLISIBLES_CODE = 'durees_illisibles'

/**
 * Lit les deux durées. Ne lève jamais ; rend une raison plutôt qu'une valeur.
 *
 * Les bornes (1–365) sont portées par la base. On les revérifie ici parce
 * qu'une ligne écrite avant la contrainte, ou par un chemin qu'on n'a pas
 * prévu, rendrait `NaN` ou `0` — et une durée nulle ferait expirer toute la
 * place à la seconde où elle est lue. Mieux vaut refuser bruyamment.
 */
export async function chargerDurees(supabaseAdmin: SupabaseClient): Promise<LectureDurees> {
  try {
    const { data, error } = await supabaseAdmin
      .from('duree_reglages')
      .select('vie_annonce_jours, fenetre_echange_jours, invitation_jours')
      .eq('ligne_unique', true)
      .maybeSingle()

    if (error) {
      console.error('[durees] lecture en échec', { message: error.message })
      return { ok: false, raison: `durées de la place illisibles (${error.message})` }
    }
    if (!data) {
      return { ok: false, raison: 'aucune ligne de réglage des durées en base' }
    }

    const r = data as unknown as {
      vie_annonce_jours: unknown
      fenetre_echange_jours: unknown
      invitation_jours: unknown
    }
    const vie = Number(r.vie_annonce_jours)
    const fenetre = Number(r.fenetre_echange_jours)
    const invitation = Number(r.invitation_jours)

    if (!estDureeAcceptable(vie) || !estDureeAcceptable(fenetre) || !estDureeAcceptable(invitation)) {
      console.error('[durees] valeurs hors bornes', { vie, fenetre, invitation })
      return {
        ok: false,
        raison: `durées hors bornes (vie ${String(r.vie_annonce_jours)}, fenêtre ${String(r.fenetre_echange_jours)}, invitation ${String(r.invitation_jours)})`,
      }
    }
    return {
      ok: true,
      durees: { vieAnnonceJours: vie, fenetreEchangeJours: fenetre, invitationJours: invitation },
    }
  } catch (err) {
    console.error('[durees] lecture en échec (exception)', {
      cause: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, raison: 'durées de la place illisibles' }
  }
}

/** Les mêmes bornes que la base — un entier entre 1 et 365. */
export function estDureeAcceptable(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 365
}

/**
 * LA CONSERVATION DES ADRESSES IP — une durée LÉGALE, pas une promesse de la
 * place. Elle vit dans la même ligne que les trois durées du contrat, mais
 * elle n'en est pas une : son unité est le MOIS, ses bornes 1–60, et aucune
 * des routes qui lisent les trois autres n'a besoin d'elle — seuls l'écran
 * d'administration et la tâche `ip_retention_purge` (en SQL, qui lit la
 * colonne directement) la lisent. Un lecteur à part, même règle : AUCUN
 * défaut dans le code. Sans réglage, la route refuse et le dit.
 */
export type LectureConservationIp =
  | { ok: true; conservationIpMois: number }
  | { ok: false; raison: string }

export async function chargerConservationIp(supabaseAdmin: SupabaseClient): Promise<LectureConservationIp> {
  try {
    const { data, error } = await supabaseAdmin
      .from('duree_reglages')
      .select('conservation_ip_mois')
      .eq('ligne_unique', true)
      .maybeSingle()
    if (error) {
      console.error('[durees] conservation IP illisible', { message: error.message })
      return { ok: false, raison: `conservation des adresses IP illisible (${error.message})` }
    }
    if (!data) return { ok: false, raison: 'aucune ligne de réglage des durées en base' }
    const mois = Number((data as { conservation_ip_mois: unknown }).conservation_ip_mois)
    if (!estConservationIpAcceptable(mois)) {
      console.error('[durees] conservation IP hors bornes', { mois })
      return { ok: false, raison: `conservation des adresses IP hors bornes (${String(mois)})` }
    }
    return { ok: true, conservationIpMois: mois }
  } catch (err) {
    console.error('[durees] conservation IP illisible (exception)', {
      cause: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, raison: 'conservation des adresses IP illisible' }
  }
}

/** Les mêmes bornes que la base — un entier entre 1 et 60 mois. */
export function estConservationIpAcceptable(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 60
}
