'use client'

import { useCallback, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import type { CandidatureFacet } from '@/lib/candidatures/facets'
import type { LifecycleViewpoint } from '@/lib/candidatures/use-lifecycle-label'

/**
 * lib/candidatures/use-facet-label.ts — SEUL point de rendu du vocabulaire
 * des facettes de candidature.
 *
 * Strictement le même schéma que `use-lifecycle-label` : le serveur dérive la
 * facette (lib/candidatures/facets.ts), le client se contente de la traduire,
 * et `viewpoint` choisit le vocabulaire. L'organisation lit « À consulter » là
 * où l'expert lit « En attente » — même fait, deux points de vue. Un libellé
 * unique aurait forcément trahi l'un des deux.
 *
 * Aucune règle ici : ce module ne sait pas ce qu'est un bucket, ne compte rien
 * et ne décide d'aucun filtrage.
 */
export function useCandidatureFacetLabels(viewpoint: LifecycleViewpoint) {
  const t = useTranslations('candidature_lifecycle.facets')
  const tVoice = useTranslations(`candidature_lifecycle.facets.${viewpoint}`)

  const label = useCallback(
    (facet: CandidatureFacet): string => tVoice(`${facet}.label` as 'selected.label'),
    [tVoice],
  )
  const emptyBody = useCallback(
    (facet: CandidatureFacet): string => tVoice(`${facet}.empty` as 'selected.empty'),
    [tVoice],
  )
  /** Titre d'état vide : nomme la facette, pour que « rien » soit situé. */
  const emptyTitle = useCallback(
    (facet: CandidatureFacet): string => t('empty_title', { facet: label(facet) }),
    [t, label],
  )
  const allLabel = t('all')

  return useMemo(
    () => ({ label, emptyBody, emptyTitle, allLabel }),
    [label, emptyBody, emptyTitle, allLabel],
  )
}
