'use client'

import { useTranslations } from 'next-intl'
import { useDomain } from '@/context/DomainContext'
import { theme } from './theme'
import HomeIcon, { type HomeIconName } from './HomeIcon'
import type { HomeAudience } from './audience'

/** Ordre d'affichage et icône de chaque bloc, par audience. */
const FEATURES: Record<HomeAudience, Array<{ key: string; icon: HomeIconName }>> = {
  expert: [
    { key: 'availability', icon: 'bell' },
    { key: 'collaboration', icon: 'users' },
    { key: 'matching', icon: 'target' },
    { key: 'freelance_cdi', icon: 'switch' },
    { key: 'cv_profile', icon: 'document' },
  ],
  company: [
    { key: 'verified', icon: 'verified' },
    { key: 'matching', icon: 'target' },
    { key: 'zero_commission', icon: 'nocommission' },
    { key: 'availability_alerts', icon: 'bell' },
    { key: 'team', icon: 'users' },
  ],
}

export default function HomeFeatures({ audience }: { audience: HomeAudience }) {
  const domain = useDomain()
  const t = useTranslations('homepage.features')

  return (
    <section id="fonctionnalites" style={{ background: theme.white, borderTop: `1px solid ${theme.border}` }}>
      <p className="skh-eyebrow">{t('eyebrow')}</p>
      <h2 className="skh-h2">{t(`${audience}.title`)}</h2>
      <p className="skh-sub">{t(`${audience}.subtitle`)}</p>

      <div className="skh-grid">
        {FEATURES[audience].map(feature => (
          <article key={feature.key} className="skh-cell">
            <span className="skh-cell-icon">
              <HomeIcon name={feature.icon} color={domain.accentColor} />
            </span>
            <h3 className="skh-cell-title">{t(`${audience}.items.${feature.key}.title`)}</h3>
            <p className="skh-cell-text">{t(`${audience}.items.${feature.key}.description`)}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
