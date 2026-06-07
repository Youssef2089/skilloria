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
  candidatures_unread: number | null
  /** Côté org : badge "Mes annonces" — compte des nouvelles candidatures
   *  reçues sur les pubs de l'org depuis la dernière visite de la home org.
   *  Retourne 0 côté expert (l'API ne calcule cette section que pour les
   *  membres d'org). Non-câblé sur la sidebar expert (pas de badgeSource
   *  correspondant), exposé ici pour consommation future si besoin. */
  annonces_unread: number | null
}

const INITIAL: NavBadges = {
  messages_unread: null,
  missions_unread: null,
  candidatures_unread: null,
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
      let missions = 0, candidatures = 0, annonces = 0
      if (badgesRes.ok) {
        const p = (await badgesRes.json()) as BadgesPayload
        const b = p.badges ?? {}
        missions = b.missions ?? 0
        // candidatures_unread = somme expert + org (chaque user n'a qu'UN
        // des deux côtés non-nul : un expert n'a pas d'org, un membre d'org
        // n'a pas de profile vérifié — l'API renvoie 0 pour l'autre côté).
        candidatures = (b.candidatures_expert ?? 0) + (b.candidatures_org ?? 0)
        annonces = b.annonces_org ?? 0
      }
      setBadges({
        messages_unread: messages,
        missions_unread: missions,
        candidatures_unread: candidatures,
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
