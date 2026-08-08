'use client'

import { useMemo } from 'react'
import { useLiveResource } from '@/hooks/useLiveResource'
import type { PublicationSynthesisData } from '@/components/dashboard/PublicationSynthesisLine'
import type { CandidatureLifecycle } from '@/lib/candidatures/lifecycle'

/** Publication enrichie renvoyée par /api/me/candidatures (synthèse parlante). */
type CandidaturePublication = PublicationSynthesisData & { status: string | null; published_at?: string | null }
/** Org de l'annonce (masquée si confidentielle), pour la carte casting home. */
type CandidatureOrg = { name: string | null; logo_url: string | null } | null

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
  /** Refonte casting home (additif) : synthèse + org + compétences. */
  publication: CandidaturePublication | null
  org: CandidatureOrg
  skills_required: string[]
  /** État de vie dérivé serveur — parité stricte avec la home freelance. */
  lifecycle: CandidatureLifecycle | null
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
  /**
   * Sous-ensemble ACTIF de `items` (bucket dérivé serveur). Exposé par le
   * hook plutôt que refiltré à chaque call-site : la rangée casting home ET
   * son garde d'état vide doivent lire EXACTEMENT la même liste, sinon on
   * réaffiche l'empty state par-dessus une rangée non vide (ou l'inverse).
   */
  activeItems: ApplicationItem[]
}

type ApiCandidature = {
  id: string
  publication_id: string
  publication: CandidaturePublication | null
  org?: CandidatureOrg
  skills_required?: string[]
  status: string
  ai_match_score: number | null
  conversation_id: string | null
  created_at: string
  viewed_by_me?: boolean
  lifecycle?: CandidatureLifecycle | null
}

export function useCdiApplications(): UseCdiApplicationsState {
  // `?filter=all` : parité stricte avec la home freelance — les KPI comptent
  // les deux buckets, la rangée casting n'affiche que les actives.
  const live = useLiveResource<{ candidatures: ApiCandidature[] }, ApiCandidature>({
    url: '/api/me/candidatures?filter=all',
    itemsOf: (d) => d.candidatures ?? [],
    identityOf: (c) => c.id,
    versionOf: (c) => `${c.status}|${c.lifecycle?.reason ?? ''}|${c.conversation_id ?? ''}`,
    holdNewItems: false,
  })

  return useMemo<UseCdiApplicationsState>(() => {
    const all = live.data?.candidatures ?? []
    // Lot « libellés d'état réels » : KPI comptés sur les RAISONS DÉRIVÉES,
    // parité stricte avec la home freelance.
    //   en_discussion = fenêtre d'échange ENCORE ouverte.
    //   retenues      = sélection. refusees = refus explicite.
    let postulees = 0, enDiscussion = 0, retenues = 0, refusees = 0
    for (const c of all) {
      postulees++
      const reason = c.lifecycle?.reason
      if (reason === 'exchange_open') enDiscussion++
      else if (reason === 'selected') retenues++
      else if (reason === 'rejected') refusees++
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
      publication: c.publication ?? null,
      org: c.org ?? null,
      skills_required: c.skills_required ?? [],
      lifecycle: c.lifecycle ?? null,
    }))
    return {
      loading: live.state.kind === 'loading',
      count: items.length,
      postulees,
      en_discussion: enDiscussion,
      retenues,
      refusees,
      items,
      activeItems: items.filter((i) => i.lifecycle?.bucket !== 'archived'),
    }
  }, [live.data, live.state.kind])
}
