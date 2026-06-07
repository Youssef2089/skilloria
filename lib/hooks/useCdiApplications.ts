'use client'

import { useMemo } from 'react'
import { useLiveResource } from '@/hooks/useLiveResource'

/**
 * useCdiApplications — candidatures de l'expert CDI courant.
 *
 * Lot polish UX : refacto sur useLiveResource (SWR + diff). Plus de
 * setState({loading:true}) à chaque poll → fin du flicker home CDI.
 * Statistiques dérivées via useMemo : pas de nouvelle référence si data
 * inchangée. holdNewItems=false (les status changes doivent apparaître
 * direct, comme côté freelance/candidatures).
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
  /** Lot bascule badges par item : true si déjà consultée par cet user. */
  viewed_by_me: boolean
}

export type UseCdiApplicationsState = {
  loading: boolean
  count: number
  postulees: number
  en_discussion: number
  /** Lot état 'selected' : candidat retenu par l'org ("Poste décroché" pour CDI). */
  retenues: number
  refusees: number
  items: ApplicationItem[]
}

type ApiCandidature = {
  id: string
  publication_id: string
  publication: { id: string; type: string; title: string; status: string } | null
  status: string
  ai_match_score: number | null
  conversation_id: string | null
  created_at: string
  viewed_by_me?: boolean
}

export function useCdiApplications(): UseCdiApplicationsState {
  const live = useLiveResource<{ candidatures: ApiCandidature[] }, ApiCandidature>({
    url: '/api/me/candidatures',
    itemsOf: (d) => d.candidatures ?? [],
    identityOf: (c) => c.id,
    versionOf: (c) => `${c.status}|${c.conversation_id ?? ''}`,
    holdNewItems: false,
  })

  return useMemo<UseCdiApplicationsState>(() => {
    const all = live.data?.candidatures ?? []
    // Lot état 'selected' :
    //   en_discussion = UNLOCKED uniquement (parité freelance).
    //   retenues      = SELECTED uniquement.
    //   refusees      = REJECTED.
    let postulees = 0, enDiscussion = 0, retenues = 0, refusees = 0
    for (const c of all) {
      postulees++
      if (c.status === 'unlocked') enDiscussion++
      else if (c.status === 'selected') retenues++
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
      viewed_by_me: c.viewed_by_me === true,
    }))
    return {
      loading: live.state.kind === 'loading',
      count: items.length,
      postulees,
      en_discussion: enDiscussion,
      retenues,
      refusees,
      items,
    }
  }, [live.data, live.state.kind])
}
