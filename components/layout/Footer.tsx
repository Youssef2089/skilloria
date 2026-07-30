'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { theme } from '@/components/home/theme'

/**
 * Pied de page de la vitrine.
 * Rendu exclusivement par <HomeView>, qui injecte les classes `skh-*`.
 *
 * Resserré à ce qui existe réellement : plus de colonne « Domaines » dupliquant
 * la section du même nom, plus d'entrées À propos / Blog / Partenaires / Tarifs
 * qui ne pointaient nulle part. Chaque libellé restant est un vrai lien.
 */
const LEGAL_LINKS = [
  { key: 'imprint', href: '/mentions-legales' },
  { key: 'privacy', href: '/politique-de-confidentialite' },
  { key: 'terms', href: '/cgu' },
] as const

const CONTACT_EMAIL = 'contact@skilloria.io'

export default function Footer() {
  const domain = useDomain()
  const t = useTranslations('footer')
  const year = new Date().getFullYear()

  return (
    <footer className="skh-footer">
      <div className="skh-footer-grid">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
            <span style={{
              width: 28, height: 28, borderRadius: 8, background: domain.primaryColor,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              {domain.logoUrl ? (
                <img src={domain.logoUrl} alt="" width={16} height={16} />
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 2L12 22M2 12L22 12M5 5L19 19M19 5L5 19" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
                </svg>
              )}
            </span>
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em' }}>{domain.name}</span>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.65, color: theme.onInkMuted, margin: 0, maxWidth: '32ch' }}>
            {t('tagline', { ecosystem: domain.ecosystemName })}
          </p>
        </div>

        <div>
          <h2>{t('col_platform')}</h2>
          <Link className="skh-footer-link" href={{ pathname: '/inscription', query: { role: 'freelance' } }}>
            {t('links.create_expert_profile')}
          </Link>
          <Link className="skh-footer-link" href={{ pathname: '/inscription', query: { role: 'entreprise' } }}>
            {t('links.post_offer')}
          </Link>
        </div>

        <div>
          <h2>{t('col_legal')}</h2>
          {LEGAL_LINKS.map(link => (
            <Link key={link.key} className="skh-footer-link" href={link.href}>
              {t(`legal.${link.key}`)}
            </Link>
          ))}
          <a className="skh-footer-link" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
        </div>
      </div>

      <div className="skh-footer-bottom">{t('copyright', { year, name: domain.name })}</div>
    </footer>
  )
}
