'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useDomain } from '@/context/DomainContext'
import { accentTint } from '@/lib/domain-config'
import { mountDemo } from './engine'
import {
  companyScenario,
  expertScenario,
  type CompanyDemoLabels,
  type ExpertDemoLabels,
} from './scenarios'

export type DemoAudience = 'expert' | 'company'

/**
 * Monte la démonstration correspondant à l'onglet actif.
 *
 * Le composant est monté avec `key={audience}` par l'appelant : basculer d'onglet
 * démonte réellement la démo précédente, ce qui déclenche le nettoyage du moteur
 * (aucun timer ne survit) avant que la suivante ne démarre.
 *
 * Toutes les chaînes sont résolues ICI, avant le code impératif — les données
 * fictives des produits viennent de la configuration de domaine, jamais du code.
 */
export default function DemoStage({ audience }: { audience: DemoAudience }) {
  const domain = useDomain()
  const t = useTranslations('homepage.demo')
  const containerRef = useRef<HTMLDivElement>(null)
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const root = containerRef.current
    if (!root || reducedMotion === null) return

    const accent = domain.accentColor
    const accentSoft = accentTint(accent)

    // Produits affichés dans les données fictives : issus du domaine courant, avec
    // repli sur le nom de l'écosystème. Aucun nom de produit n'est écrit en dur.
    const products = domain.featuredProducts.map(p => p.label).filter(Boolean)
    const product = (index: number) => products[index] ?? domain.ecosystemName

    if (audience === 'company') {
      const person = (key: 'p1' | 'p2' | 'p3', productIndex: number) => ({
        initials: t(`company.people.${key}.initials`),
        name: t(`company.people.${key}.name`),
        specShort: t(`company.people.${key}.spec_short`, { product: product(productIndex) }),
        specLong: t(`company.people.${key}.spec_long`, { product: product(productIndex) }),
        tjm: t(`company.people.${key}.tjm`),
        availability: t(`company.people.${key}.availability`),
        score: t(`company.people.${key}.score`),
        verified: key === 'p1',
      })

      const labels: CompanyDemoLabels = {
        recruiter: {
          initials: t('company.recruiter.initials'),
          name: t('company.recruiter.name'),
          postingLine: t('company.recruiter.posting_line'),
          selectingLine: t('company.recruiter.selecting_line'),
        },
        mission: {
          titleLabel: t('company.mission.title_label'),
          titleValue: t('company.mission.title_value', { product: product(0) }),
          tjmLabel: t('company.mission.tjm_label'),
          tjmValue: t('company.mission.tjm_value'),
          durationLabel: t('company.mission.duration_label'),
          durationValue: t('company.mission.duration_value'),
          durationShort: t('company.mission.duration_short'),
          descriptionLabel: t('company.mission.description_label'),
          descriptionValue: t('company.mission.description_value', { product: product(0) }),
          publishButton: t('company.mission.publish_button'),
        },
        tags: [product(0), product(1), t('company.tag_remote')],
        matching: {
          title: t('company.matching.title'),
          status: t('company.matching.status'),
          criteria: t('company.matching.criteria'),
          notifiedBadge: t('company.matching.notified_badge'),
        },
        candidates: [person('p1', 0), person('p2', 1), person('p3', 2)],
        candidatesTitle: t('company.candidates_title'),
        matchLabel: t('company.match_label'),
        selectionConfirmed: t('company.selection_confirmed', { name: t('company.people.p1.name') }),
        chat: {
          title: t('company.chat.title'),
          onlineLabel: t('company.chat.online_label'),
          sharedMissionLabel: t('company.chat.shared_mission_label'),
          scoreLabel: t('company.chat.score_label', { score: t('company.people.p1.score') }),
          messageFromCompany: t('company.chat.message_from_company', { name: t('company.people.p1.first_name') }),
          messageFromExpert: t('company.chat.message_from_expert'),
        },
      }

      return mountDemo(root, {
        steps: ['s1', 's2', 's3', 's4', 's5'].map(s => t(`company.steps.${s}`)),
        progressLabel: t('company.progress_label'),
        accent,
        accentSoft,
        reduced: reducedMotion,
        scenario: companyScenario(labels),
      })
    }

    const labels: ExpertDemoLabels = {
      profile: {
        initials: t('expert.profile.initials'),
        name: t('expert.profile.name'),
        headline: t('expert.profile.headline', { product: product(0) }),
        checkingLabel: t('expert.profile.checking_label'),
        verifiedBadge: t('expert.profile.verified_badge'),
        skills: [product(0), product(1), product(2)],
        availabilityLabel: t('expert.profile.availability_label'),
      },
      mission: {
        detectedLabel: t('expert.mission.detected_label'),
        title: t('expert.mission.title', { product: product(0) }),
        company: t('expert.mission.company'),
        score: t('expert.mission.score'),
        scoreLabel: t('expert.mission.score_label'),
        tjmLabel: t('expert.mission.tjm_label'),
        tjmValue: t('expert.mission.tjm_value'),
        locationLabel: t('expert.mission.location_label'),
        locationValue: t('expert.mission.location_value'),
        matchExplanation: t('expert.mission.match_explanation', { product: product(0) }),
        applyButton: t('expert.mission.apply_button'),
      },
      apply: {
        sendingLabel: t('expert.apply.sending_label'),
        sentTitle: t('expert.apply.sent_title'),
        sentBody: t('expert.apply.sent_body'),
        anonymityNote: t('expert.apply.anonymity_note'),
      },
      chat: {
        title: t('expert.chat.title'),
        recruiterInitials: t('expert.chat.recruiter_initials'),
        recruiterName: t('expert.chat.recruiter_name'),
        recruiterRole: t('expert.chat.recruiter_role'),
        onlineLabel: t('expert.chat.online_label'),
        message: t('expert.chat.message'),
        internalNote: t('expert.chat.internal_note'),
        replyPlaceholder: t('expert.chat.reply_placeholder'),
      },
    }

    return mountDemo(root, {
      steps: ['s1', 's2', 's3', 's4'].map(s => t(`expert.steps.${s}`)),
      progressLabel: t('expert.progress_label'),
      accent,
      accentSoft,
      reduced: reducedMotion,
      scenario: expertScenario(labels),
    })
  }, [audience, domain, reducedMotion, t])

  return (
    <div role="img" aria-label={t(`${audience}.aria_label`)}>
      <div ref={containerRef} aria-hidden="true" />
    </div>
  )
}
