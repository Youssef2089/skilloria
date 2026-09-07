'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useMarkCandidatureViewed } from '@/lib/candidature-view-client'
import { useDemanderPitch } from '@/lib/candidature-pitch-client'
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
  /** Base d'URL messagerie propagée à la carte (org vs sous-traitance expert). */
  messagesBasePath?: string
  /** Comportement sur candidat masqué : 'unlock' (org) | 'wall' (sous-traitance). */
  conversionMode?: 'unlock' | 'wall'
}

export default function CastingCarousel({ items, publicationType, pubSkillsRequired, onMutated, messagesBasePath, conversionMode }: Props) {
  const t = useTranslations('candidatures.casting')
  const tCard = useTranslations('candidatures.card')
  const markViewed = useMarkCandidatureViewed()
  // Le pitch est rédigé quand une carte passe SOUS LE PROJECTEUR, jamais
  // d'avance : un appel par candidat réellement ouvert.
  const demanderPitch = useDemanderPitch()
  const [pitchs, setPitchs] = useState<Record<string, string>>({})

  return (
    <SpotlightCarousel<CandidatureData>
      items={items}
      getKey={(c) => c.id}
      onCenterChange={(c) => {
        void markViewed(c.id)
        // Déjà porté par le DTO (rédigé au dépôt) : rien à demander.
        if (c.ai_pitch) return
        void demanderPitch(c.id).then((pitch) => {
          if (pitch) setPitchs((p) => (p[c.id] === pitch ? p : { ...p, [c.id]: pitch }))
        })
      }}
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
          // Le pitch rédigé à l'ouverture prend le relais quand le DTO n'en
          // portait pas : la carte n'a pas à savoir lequel des deux chemins
          // l'a produit.
          candidature={pitchs[c.id] ? { ...c, ai_pitch: pitchs[c.id] } : c}
          publicationType={publicationType}
          pubSkillsRequired={pubSkillsRequired}
          onMutated={onMutated}
          interactive={isCenter}
          messagesBasePath={messagesBasePath}
          conversionMode={conversionMode}
        />
      )}
    />
  )
}
