'use client'

import { useTranslations } from 'next-intl'
import { theme } from './theme'
import type { HomeAudience } from './audience'

/**
 * Le parcours expert compte quatre étapes, le parcours entreprise cinq : la liste
 * est portée par l'audience, pas par une constante partagée.
 */
const STEPS: Record<HomeAudience, string[]> = {
  expert: ['cv', 'verified', 'opportunities', 'exchange'],
  company: ['publish', 'search', 'apply', 'choose', 'exchange'],
}

export default function HomeSteps({ audience }: { audience: HomeAudience }) {
  const t = useTranslations('homepage.steps')
  const steps = STEPS[audience]

  return (
    <section id="etapes" style={{ background: theme.beige, borderTop: `1px solid ${theme.border}` }}>
      <h2 className="skh-h2">{t(`${audience}.title`)}</h2>

      <ol className="skh-steps-grid" style={{ listStyle: 'none', padding: 0 }}>
        {steps.map((step, index) => (
          <li key={step} className="skh-step-item">
            <p className="skh-step-num">{String(index + 1).padStart(2, '0')}</p>
            <h3 className="skh-step-title">{t(`${audience}.items.${step}.title`)}</h3>
            <p className="skh-step-text">{t(`${audience}.items.${step}.description`)}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
