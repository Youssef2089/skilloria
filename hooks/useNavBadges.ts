'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * useNavBadges — compteurs pour les badges rouges de la nav (Lot bascule
 * "badges par item consulté").
 *
 * Mécanique unifiée "items NON consultés" :
 *   - missions             : count(matches WHERE status ∈ pending|notified)
 *                            → l'ouverture du détail flippe vers 'viewed'
 *                              (cf. /api/me/missions/[id]) → décrément.
 *   - candidatures_expert  : count(candidatures NOT EXISTS candidature_views
 *                            for current user with viewed_at >= updated_at)
 *                            → l'ouverture du master-detail POST view → -1.
 *   - candidatures_org     : idem côté org. La carte org auto-mark via
 *                            bouton "Marquer comme vue" OU via une action
 *                            métier (unlock/reject/select).
 *   - annonces_org         : alias V1 de candidatures_org (cf. /api/me/badges).
 *
 * Exceptions (modèles déjà par-item, intacts) :
 *   - messages_unread : /api/me/conversations.unread_count (par conv).
 *   - cloche          : /api/me/notifications.unread_count (par notif).
 *
 * Polling 30s + revalidation sur 'skilloria:notif-bump' (cloche, toggle DND,
 * useMarkCandidatureViewed, route /view). Cleanup propre au démontage.
 *
 * Surface : ce hook fournit la valeur pour les badges nav UNIQUEMENT. Le
 * badge de la cloche est géré par <NotificationBell> (unread notifications).
 */

const POLL_MS = 30_000

export type NavBadges = {
  messages_unread: number | null
  missions_unread: number | null
  /** A3 : candidatures DÉPOSÉES par l'expert (côté candidat) UNIQUEMENT.
   *  Alimente l'entrée « Candidatures ». Ne mélange plus les reçues. */
  candidatures_unread: number | null
  /** A3 : candidatures REÇUES sur les pubs de l'org (côté donneur d'ordre :
   *  entreprise OU expert publiant). Alimente l'entrée « Candidatures » de
   *  l'entreprise ET l'entrée « Sous-traitance » de l'expert. */
  candidatures_org_unread: number | null
  /** Alias historique de candidatures_org (badge "Mes annonces" home org). */
  annonces_unread: number | null
}

const INITIAL: NavBadges = {
  messages_unread: null,
  missions_unread: null,
  candidatures_unread: null,
  candidatures_org_unread: null,
  annonces_unread: null,
}

type BadgesPayload = {
  badges?: {
    missions?: number
    candidatures_expert?: number
    candidatures_org?: number
    annonces_org?: number
  }
}

export function useNavBadges(): NavBadges {
  const secureFetch = useSecureFetch()
  const [badges, setBadges] = useState<NavBadges>(INITIAL)

  const load = useCallback(async () => {
    try {
      const [convsRes, badgesRes] = await Promise.all([
        secureFetch('/api/me/conversations', { method: 'GET' }),
        secureFetch('/api/me/badges', { method: 'GET' }),
      ])
      let messages = 0
      if (convsRes.ok) {
        const p = (await convsRes.json()) as { conversations?: Array<{ unread_count?: number }> }
        messages = (p.conversations ?? []).reduce((acc, c) => acc + (c.unread_count ?? 0), 0)
      }
      let missions = 0, candidaturesExpert = 0, candidaturesOrg = 0, annonces = 0
      if (badgesRes.ok) {
        const p = (await badgesRes.json()) as BadgesPayload
        const b = p.badges ?? {}
        missions = b.missions ?? 0
        // A3 : on NE somme PLUS expert + org. Un expert PUBLIANT (org perso
        // collaboration) a les DEUX non-nulles — les mélanger afficherait les
        // reçues sur l'entrée « Candidatures » (déposées). On les expose
        // séparément et chaque entrée de nav consomme sa source.
        candidaturesExpert = b.candidatures_expert ?? 0
        candidaturesOrg = b.candidatures_org ?? 0
        annonces = b.annonces_org ?? 0
      }
      setBadges({
        messages_unread: messages,
        missions_unread: missions,
        candidatures_unread: candidaturesExpert,
        candidatures_org_unread: candidaturesOrg,
        annonces_unread: annonces,
      })
    } catch (err) {
      console.error('[useNavBadges] load threw', err)
    }
  }, [secureFetch])

  useEffect(() => {
    void load()
    const intervalId = window.setInterval(() => { void load() }, POLL_MS)
    const onFocus = () => { void load() }
    const onNotifBump = () => { void load() }
    window.addEventListener('focus', onFocus)
    window.addEventListener('skilloria:notif-bump', onNotifBump)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('skilloria:notif-bump', onNotifBump)
    }
  }, [load])

  return badges
}
