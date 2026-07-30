'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { theme } from '@/components/home/theme'

/**
 * Navigation de la vitrine.
 * Rendue exclusivement par <HomeView>, qui injecte les classes `skh-*`.
 *
 * Les anciens menus déroulants (Entreprise, Freelance, CDI, Tarifs) n'ouvraient
 * rien : c'étaient quatre liens morts. Ils sont remplacés par des ancres vers les
 * sections réellement présentes sur la page.
 *
 * Le logo conserve `domain.primaryColor` : c'est la marque du domaine, elle ne
 * suit pas l'accent de la page.
 */
const SECTION_LINKS = ['fonctionnalites', 'etapes', 'domaines'] as const

export default function Navbar() {
  const router = useRouter()
  const domain = useDomain()
  const t = useTranslations('navbar')

  return (
    <nav className="skh-nav">
      <button
        type="button"
        onClick={() => router.push('/')}
        aria-label={t('home_aria', { name: domain.name })}
        style={{
          display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0,
          background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit',
        }}
      >
        <span style={{
          width: 30, height: 30, borderRadius: 8, background: domain.primaryColor,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          {domain.logoUrl ? (
            <img src={domain.logoUrl} alt="" width={18} height={18} />
          ) : (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 2L12 22M2 12L22 12M5 5L19 19M19 5L5 19" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          )}
        </span>
        <span style={{ fontSize: 16, fontWeight: 700, color: theme.ink, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>
          {domain.name}
        </span>
      </button>

      <div className="skh-nav-links">
        {SECTION_LINKS.map(section => (
          <a key={section} className="skh-nav-link" href={`#${section}`}>
            {t(`menu.${section}`)}
          </a>
        ))}
      </div>

      <div className="skh-nav-actions">
        <button type="button" className="skh-nav-signin" onClick={() => router.push('/connexion')}>
          {t('cta_signin')}
        </button>
        <button type="button" className="skh-nav-cta" onClick={() => router.push('/inscription')}>
          {t('cta_signup')}
        </button>
      </div>
    </nav>
  )
}
