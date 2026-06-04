'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * useNavBadges — compteurs de non-lus pour la nav (Point 5 finitions UX +
 * SC5 Lot UX Finitions 2 : missions_unread).
 *
 *   - messages_unread : somme des unread_count par conversation (côté user
 *     courant). Source : /api/me/conversations, qui pour chaque conv compte
 *     les messages WHERE sender_id != me AND read_at IS NULL (cf. route.ts).
 *     Quand l'expert OUVRE une conv, /api/conversations/[id]/messages flippe
 *     read_at sur tous les messages REÇUS → l'unread tombe à 0 (sémantique
 *     correcte, pas un bug si le badge n'apparaît pas alors que des messages
 *     existent : il faut qu'au moins un soit non-lu).
 *
 *   - candidatures_unread : notifications NON LUES dont type ∈ {
 *       'new_candidature_received' (org : nouvelle candidature),
 *       'candidature_unlocked'     (expert : votre candidature acceptée)
 *     }
 *
 *   - missions_unread (expert only) : COUNT(matches.status='notified') du
 *     profile courant. Option A SC5 — pas de nouvelle colonne, on réutilise
 *     l'état "notified" existant. Auto-vidant : ouverture du feed missions →
 *     POST /api/me/missions/mark-viewed → tous notified → viewed → 0.
 *     Côté org, l'endpoint /api/me/missions/summary renvoie 0 (pas de profile
 *     expert) → badge inerte sans casser.
 *
 * Polling 30s, écoute 'skilloria:notif-bump' (émis par NotificationBell quand
 * unread_count global augmente) pour refresh immédiat. Cleanup propre au démontage.
 *
 * Retourne null pour chaque compteur tant que le 1er fetch n'a pas répondu —
 * permet à l'UI d'afficher un état "vide" plutôt qu'un 0 qui clignote à 0→N.
 */

const POLL_MS = 30_000

const APPLICATION_NOTIF_TYPES = ['new_candidature_received', 'candidature_unlocked'] as const

export type NavBadges = {
  messages_unread: number | null
  candidatures_unread: number | null
  missions_unread: number | null
}

export function useNavBadges(): NavBadges {
  const secureFetch = useSecureFetch()
  const [badges, setBadges] = useState<NavBadges>({
    messages_unread: null,
    candidatures_unread: null,
    missions_unread: null,
  })

  const load = useCallback(async () => {
    try {
      const [convsRes, notifsRes, missionsRes] = await Promise.all([
        secureFetch('/api/me/conversations', { method: 'GET' }),
        secureFetch('/api/me/notifications', { method: 'GET' }),
        secureFetch('/api/me/missions/summary', { method: 'GET' }),
      ])
      let messages = 0
      if (convsRes.ok) {
        const p = (await convsRes.json()) as { conversations?: Array<{ unread_count?: number }> }
        messages = (p.conversations ?? []).reduce((acc, c) => acc + (c.unread_count ?? 0), 0)
      }
      let candidatures = 0
      if (notifsRes.ok) {
        const p = (await notifsRes.json()) as { notifications?: Array<{ type: string; read_at: string | null }> }
        candidatures = (p.notifications ?? []).filter(
          (n) => n.read_at === null && (APPLICATION_NOTIF_TYPES as readonly string[]).includes(n.type),
        ).length
      }
      let missions = 0
      if (missionsRes.ok) {
        const p = (await missionsRes.json()) as { notified_count?: number }
        missions = p.notified_count ?? 0
      }
      setBadges({ messages_unread: messages, candidatures_unread: candidatures, missions_unread: missions })
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
