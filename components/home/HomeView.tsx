'use client'

import { useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useDomain } from '@/context/DomainContext'
import { accentStrong, accentTint } from '@/lib/domain-config'
import Topbar from '@/components/layout/Topbar'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import { homeStyles } from './homeStyles'
import { AUDIENCES, DEFAULT_AUDIENCE, type HomeAudience } from './audience'
import HomeHero from './HomeHero'
import HomeFeatures from './HomeFeatures'
import HomeSteps from './HomeSteps'
import HomeEcosystem from './HomeEcosystem'
import type { EcosystemBranch } from '@/lib/home-ecosystem'

/**
 * Page d'accueil publique.
 *
 * C'est ici qu'est injectée la feuille de style de la vitrine : Topbar, Navbar et
 * Footer s'appuient sur ses classes `skh-*` et ne sont rendus que par ce composant.
 *
 * L'onglet actif pilote le héros, les fonctionnalités, les étapes ET la
 * démonstration animée. Le panneau porte `key={audience}` : basculer démonte
 * réellement la démo précédente (nettoyage des timers) avant de monter l'autre.
 */
export default function HomeView({ ecosystem }: { ecosystem: EcosystemBranch[] }) {
  const domain = useDomain()
  const t = useTranslations('homepage')
  const [audience, setAudience] = useState<HomeAudience>(DEFAULT_AUDIENCE)
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const styles = useMemo(() => {
    const accent = domain.accentColor
    return homeStyles(accent, accentTint(accent), accentStrong(accent))
  }, [domain.accentColor])

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: AUDIENCES.length - 1,
    }
    const target = moves[event.key]
    if (target === undefined) return
    event.preventDefault()
    const next = AUDIENCES[(target + AUDIENCES.length) % AUDIENCES.length]
    setAudience(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <>
      <style>{styles}</style>

      <Topbar />
      <Navbar />

      <main className="skh-home">
        <div className="skh-tabs" role="tablist" aria-label={t('tabs.aria_label')}>
          {AUDIENCES.map((value, index) => (
            <button
              key={value}
              type="button"
              role="tab"
              id={`skh-tab-${value}`}
              className="skh-tab"
              aria-selected={audience === value}
              aria-controls={`skh-panel-${value}`}
              tabIndex={audience === value ? 0 : -1}
              ref={node => {
                tabRefs.current[value] = node
              }}
              onClick={() => setAudience(value)}
              onKeyDown={event => onTabKeyDown(event, index)}
            >
              {t(`tabs.${value}`)}
            </button>
          ))}
        </div>

        <div
          key={audience}
          id={`skh-panel-${audience}`}
          role="tabpanel"
          aria-labelledby={`skh-tab-${audience}`}
          className="skh-swap"
        >
          <HomeHero audience={audience} />
          <HomeFeatures audience={audience} />
          <HomeSteps audience={audience} />
        </div>

        <HomeEcosystem branches={ecosystem} />
      </main>

      <Footer />
    </>
  )
}
