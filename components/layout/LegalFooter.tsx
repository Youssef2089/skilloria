'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { LEGAL_FOOTER_LINKS } from '@/lib/legal'

/**
 * Pied de page DISCRET — monté sur les surfaces connectées (dashboards + admin)
 * pour garantir l'accès aux pages légales depuis TOUTES les pages (point B),
 * sans y traîner le Footer marketing (colonnes plateforme/domaines/entreprise).
 *
 * Les 3 liens partagent la SOURCE UNIQUE lib/legal.LEGAL_FOOTER_LINKS et les
 * libellés i18n existants `footer.legal.*` (4 langues). Le <Link> i18n préfixe
 * automatiquement la locale ; les pages cibles sont créées dans un lot ultérieur
 * (404 temporaire assumé).
 */
export default function LegalFooter() {
  const t = useTranslations('footer')
  const domain = useDomain()
  const year = new Date().getFullYear()

  return (
    <footer
      style={{
        borderTop: '1px solid var(--color-border-tertiary, #e5e7eb)',
        padding: '14px 24px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: 11,
        color: 'var(--color-text-tertiary, #94a3b8)',
      }}
    >
      <span>{t('copyright', { year, name: domain.name })}</span>
      <nav style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {LEGAL_FOOTER_LINKS.map(({ key, path }) => (
          <Link
            key={key}
            href={path}
            style={{ color: 'var(--color-text-secondary, #64748b)', textDecoration: 'none' }}
          >
            {t(`legal.${key}`)}
          </Link>
        ))}
      </nav>
    </footer>
  )
}
