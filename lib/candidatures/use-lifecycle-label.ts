'use client'

import { useCallback } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { StatusPillKind } from '@/components/ui/StatusPill'
import type { CandidatureLifecycle, CandidatureLifecycleReason } from '@/lib/candidatures/lifecycle'

/**
 * lib/candidatures/use-lifecycle-label.ts — SEUL point de rendu du libellé
 * d'état d'une candidature.
 *
 * Le serveur dérive `{ bucket, reason, until }` (lib/candidatures/lifecycle.ts).
 * Le client ne fait QUE traduire la raison : il ne recalcule rien, ne teste
 * aucune date, ne lit plus `candidature.status` pour décider d'un mot. Tout
 * site de rendu qui affichait `t('status.<status>')` passe par ici.
 *
 * Deux points de vue, un seul fait : `viewpoint` sélectionne le vocabulaire
 * (l'expert lit « Mission remportée », l'org lit « Candidat retenu ») mais la
 * RAISON servie est la même des deux côtés — pas d'asymétrie possible.
 */

export type LifecycleViewpoint = 'expert' | 'org'

/** Type de publication, pour les raisons dont le mot dépend (mission/offre). */
export type LifecyclePublicationType = 'mission' | 'offre' | string | null | undefined

/** Raisons dont le libellé se décline selon le type de publication. */
const TYPED_REASONS = new Set<CandidatureLifecycleReason>(['selected'])

export function useCandidatureLifecycleLabel(viewpoint: LifecycleViewpoint) {
  const t = useTranslations(`candidature_lifecycle.${viewpoint}`)
  const locale = useLocale()

  return useCallback(
    (lifecycle: CandidatureLifecycle | null | undefined, pubType?: LifecyclePublicationType): string => {
      if (!lifecycle) return ''
      const { reason, until } = lifecycle
      const key = TYPED_REASONS.has(reason)
        ? `${reason}_${pubType === 'offre' ? 'offre' : 'mission'}`
        : reason
      const date = until
        ? new Date(until).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
        : ''
      try {
        return t(key as 'selected_mission', { date })
      } catch {
        return reason
      }
    },
    [t, locale],
  )
}

/**
 * Teinte de la pastille, DÉRIVÉE DE LA RAISON (plus du statut brut).
 * C'est ce qui empêche un « Échange ouvert » vert de survivre à sa fenêtre :
 * la raison bascule sur 'exchange_expired', la couleur suit.
 */
export function lifecycleToPillKind(reason: CandidatureLifecycleReason): StatusPillKind {
  switch (reason) {
    case 'selected':
      return 'won'
    case 'exchange_open':
      return 'open'
    case 'awaiting_review':
      return 'wait'
    case 'rejected':
      return 'refused'
    // Fins de fenêtre et retraits : ni succès ni refus — neutre, jamais vert.
    case 'exchange_expired':
    case 'publication_expired':
    case 'publication_closed':
    case 'withdrawn':
    case 'archived':
      return 'neutral'
    default:
      return 'neutral'
  }
}
