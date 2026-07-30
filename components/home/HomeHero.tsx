'use client'

import { useTranslations } from 'next-intl'
import { useDomain } from '@/context/DomainContext'
import { useRouter } from '@/i18n/navigation'
import { theme } from './theme'
import DemoStage from './demo/DemoStage'
import type { HomeAudience } from './audience'

/** Rôle passé au parcours d'inscription selon l'onglet actif. */
const SIGNUP_ROLE: Record<HomeAudience, string> = {
  expert: 'freelance',
  company: 'entreprise',
}

const PROOFS = ['proof_1', 'proof_2', 'proof_3'] as const

export default function HomeHero({ audience }: { audience: HomeAudience }) {
  const domain = useDomain()
  const router = useRouter()
  const t = useTranslations('homepage.hero')

  return (
    <section className="skh-hero" style={{ background: theme.cream }}>
      <div className="skh-hero-copy">
        <h1 className="skh-h1">{t(`${audience}.title`, { ecosystem: domain.ecosystemName })}</h1>
        <p className="skh-lead">{t(`${audience}.subtitle`)}</p>

        <div>
          <button
            type="button"
            className="skh-cta"
            onClick={() =>
              router.push({ pathname: '/inscription', query: { role: SIGNUP_ROLE[audience] } })
            }
          >
            {t(`${audience}.cta`)}
            <span aria-hidden="true">→</span>
          </button>
        </div>

        <p className="skh-proof">
          {PROOFS.map((proof, index) => (
            <span key={proof}>
              {index > 0 ? <span aria-hidden="true" style={{ margin: '0 8px', color: theme.border }}>·</span> : null}
              {t(`${audience}.${proof}`)}
            </span>
          ))}
        </p>
      </div>

      <div style={{ minWidth: 0 }}>
        <DemoStage audience={audience} />
      </div>
    </section>
  )
}
