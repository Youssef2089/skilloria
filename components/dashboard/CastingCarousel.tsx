'use client'

import { useTranslations } from 'next-intl'
import { useMarkCandidatureViewed } from '@/lib/candidature-view-client'
import type { CandidatureData } from '@/components/dashboard/CandidatureCard'
import SpotlightCandidateCard from '@/components/dashboard/SpotlightCandidateCard'
import SpotlightCarousel from '@/components/dashboard/SpotlightCarousel'

/**
 * CastingCarousel — vue casting « sous projecteur » côté ORG (candidatures).
 *
 * Depuis le lot « shell partagé », ce composant n'est plus qu'un ADAPTATEUR
 * fin au-dessus de <SpotlightCarousel> (shell agnostique) : il fournit la
 * carte candidat (SpotlightCandidateCard), les libellés org
 * (namespace candidatures.casting) et le marquage « vu » spécifique candidat.
 *
 * Comportement et libellés INCHANGÉS (refactor pur) :
 *   - voisins masqués via la DisclosurePolicy portée par SpotlightCandidateCard,
 *   - auto-mark viewed quand un candidat devient le centre (POST .../view →
 *     skilloria:notif-bump → badge -1),
 *   - compteur "X / N", flèches, clavier, pastilles.
 *
 * `items` DOIT déjà être trié serveur par ai_match_score DESC (cf. DTO org).
 */

type Props = {
  items: CandidatureData[]
  publicationType: 'mission' | 'offre' | string
  pubSkillsRequired: string[]
  onMutated: () => void
}

export default function CastingCarousel({ items, publicationType, pubSkillsRequired, onMutated }: Props) {
  const t = useTranslations('candidatures.casting')
  const tCard = useTranslations('candidatures.card')
  const markViewed = useMarkCandidatureViewed()

  return (
    <SpotlightCarousel<CandidatureData>
      items={items}
      getKey={(c) => c.id}
      onCenterChange={(c) => { void markViewed(c.id) }}
      labels={{
        formatCounter: (current, total) => t('counter', { current, total }),
        prevAria: t('prev_aria'),
        nextAria: t('next_aria'),
        paginationAria: t('pagination_aria'),
        gotoAria: (index) => t('goto_aria', { index }),
        empty: t('empty'),
        footnote: tCard('ai_score_tooltip'),
      }}
      renderItem={(c, { isCenter }) => (
        <SpotlightCandidateCard
          candidature={c}
          publicationType={publicationType}
          pubSkillsRequired={pubSkillsRequired}
          onMutated={onMutated}
          interactive={isCenter}
        />
      )}
    />
  )
}
