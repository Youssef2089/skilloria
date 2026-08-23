'use client'

import { useMemo } from 'react'
import { useLiveResource } from '@/hooks/useLiveResource'
import type { CandidatureCastingData } from '@/components/dashboard/CandidatureCastingCard'
import type { CandidaturesAggregate } from '@/lib/candidatures/aggregate'

/**
 * useExpertApplications — candidatures de l'expert courant, pour SON ACCUEIL.
 *
 * SOURCE UNIQUE des deux tableaux de bord experts (freelance ET CDI). Remplace
 * le `useMemo` inline de dashboard/freelance/page.tsx et le hook
 * lib/hooks/useCdiApplications.ts, qui calculaient la même chose deux fois.
 * La parité n'est plus surveillée, elle est STRUCTURELLE : un seul calcul,
 * deux consommateurs.
 *
 * IL REND DES NOMBRES, PAS DES LIBELLÉS.
 *   Les deux accueils ont des espaces de noms i18n différents
 *   (`dashboard_freelance.stats.*` et `dashboard_cdi.kpis.*`). Ce hook n'en
 *   impose aucun : chaque côté garde ses clés et étiquette les nombres
 *   lui-même. Ne pas « unifier » cela — le vocabulaire diffère légitimement
 *   entre une mission freelance et un poste CDI.
 *
 * BUCKET ACTIF UNIQUEMENT — et demandé au SERVEUR (`?filter=active`).
 *   L'accueil doit dire où l'expert en est MAINTENANT. Contrairement à la page
 *   Candidatures, il n'a pas d'onglets Actives/Archivées : une candidature sur
 *   annonce expirée n'y appelle aucune action et ne doit donc pas gonfler un
 *   chiffre. C'est déjà la règle de l'accueil ENTREPRISE.
 *   Conséquence voulue : le client ne filtre RIEN. La liste servie EST celle
 *   qu'il affiche, et `stats` décrit exactement cette liste — un compteur ne
 *   peut plus contredire la rangée qu'il surplombe.
 *
 *   La distinction avec la page Candidatures (qui lit `stats.all`) est
 *   documentée là où les deux portées sont calculées : app/api/me/candidatures.
 *
 * holdNewItems=false : un changement d'état (échange ouvert, refus, expiration)
 * doit apparaître sans clic, comme sur /candidatures.
 */

/** Item servi à la rangée casting. Étend la forme attendue par la carte, donc
 *  compatible PAR CONSTRUCTION — pas de mapping à maintenir des deux côtés. */
export type ExpertApplicationItem = CandidatureCastingData & {
  publication_id: string
  ai_match_score: number | null
  conversation_id: string | null
  created_at: string
}

export type UseExpertApplicationsState = {
  loading: boolean
  /**
   * Agrégat du bucket ACTIF, calculé par le SERVEUR sur le même tableau que la
   * liste ci-dessous. `null` tant que rien n'est chargé — les accueils
   * affichent alors leur placeholder, jamais un 0 inventé.
   */
  stats: CandidaturesAggregate | null
  /** Candidatures ACTIVES. Servies filtrées : aucun tri ni filtre client. */
  items: ExpertApplicationItem[]
}

type ApiPayload = {
  candidatures: ExpertApplicationItem[]
  stats?: { all: CandidaturesAggregate; active: CandidaturesAggregate }
}

export function useExpertApplications(options?: { enabled?: boolean }): UseExpertApplicationsState {
  const enabled = options?.enabled ?? true

  const live = useLiveResource<ApiPayload, ExpertApplicationItem>({
    url: enabled ? '/api/me/candidatures?filter=active' : null,
    itemsOf: (d) => d.candidatures ?? [],
    identityOf: (c) => c.id,
    // `lifecycle.reason` dans la version : une candidature dont la fenêtre
    // vient d'expirer QUITTE le bucket actif — la liste doit le refléter sans
    // intervention.
    versionOf: (c) => `${c.status}|${c.lifecycle?.reason ?? ''}|${c.conversation_id ?? ''}`,
    enabled,
    holdNewItems: false,
  })

  return useMemo<UseExpertApplicationsState>(() => ({
    loading: live.state.kind === 'loading',
    stats: live.data?.stats?.active ?? null,
    items: live.data?.candidatures ?? [],
  }), [live.data, live.state.kind])
}
