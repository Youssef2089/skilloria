'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * useCdiApplications — candidatures de l'expert CDI courant.
 *
 * Lot UX Finitions 2 (SC2) : refacto pour parité avec freelance.
 *  - Avant : lisait directement table `applications` (table LEGACY drop au
 *    core_loop B6). Le fetch retournait toujours 0/[] silencieusement.
 *  - Après : appelle /api/me/candidatures (route serveur partagée freelance/
 *    CDI ; aucune discrimination par type côté backend). Retourne les buckets
 *    postulees / en_discussion / refusees pour les KPI home CDI.
 *
 * Polling 30s + revalidate-on-focus + écoute 'skilloria:notif-bump' (cohérent
 * avec le pattern des autres dashboards). Cleanup propre.
 */

export type ApplicationItem = {
  id: string
  created_at: string | null
  status: string | null
  publication_id: string | null
  publication_title: string | null
  publication_type: string | null
  ai_match_score: number | null
  conversation_id: string | null
}

export type UseCdiApplicationsState = {
  loading: boolean
  count: number
  postulees: number
  en_discussion: number
  refusees: number
  items: ApplicationItem[]
}

const initialState: UseCdiApplicationsState = {
  loading: true,
  count: 0,
  postulees: 0,
  en_discussion: 0,
  refusees: 0,
  items: [],
}

type ApiResp = {
  candidatures?: Array<{
    id: string
    publication_id: string
    publication: { id: string; type: string; title: string; status: string } | null
    status: string
    ai_match_score: number | null
    conversation_id: string | null
    created_at: string
  }>
}

export function useCdiApplications(): UseCdiApplicationsState {
  const [state, setState] = useState<UseCdiApplicationsState>(initialState)
  const secureFetch = useSecureFetch()

  const load = useCallback(async () => {
    try {
      const res = await secureFetch('/api/me/candidatures', { method: 'GET' })
      if (!res.ok) {
        setState({ ...initialState, loading: false })
        return
      }
      const payload = (await res.json()) as ApiResp
      const all = payload.candidatures ?? []
      let postulees = 0, enDiscussion = 0, refusees = 0
      for (const c of all) {
        postulees++
        if (c.status === 'unlocked' || c.status === 'in_review' || c.status === 'shortlisted') enDiscussion++
        else if (c.status === 'rejected') refusees++
      }
      const items: ApplicationItem[] = all.map((c) => ({
        id: c.id,
        created_at: c.created_at,
        status: c.status,
        publication_id: c.publication_id,
        publication_title: c.publication?.title ?? null,
        publication_type: c.publication?.type ?? null,
        ai_match_score: c.ai_match_score,
        conversation_id: c.conversation_id,
      }))
      setState({
        loading: false,
        count: items.length,
        postulees,
        en_discussion: enDiscussion,
        refusees,
        items,
      })
    } catch {
      setState({ ...initialState, loading: false })
    }
  }, [secureFetch])

  useEffect(() => {
    void load()
    const intervalId = window.setInterval(() => { void load() }, 30_000)
    const onFocus = () => { void load() }
    const onBump = () => { void load() }
    window.addEventListener('focus', onFocus)
    window.addEventListener('skilloria:notif-bump', onBump)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('skilloria:notif-bump', onBump)
    }
  }, [load])

  return state
}
