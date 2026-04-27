'use client'

import { useTranslations } from 'next-intl'
import { useDomain } from '@/context/DomainContext'

type PlatformLinkKey = 'post_offer' | 'company' | 'freelance' | 'permanent' | 'pricing'
type CompanyLinkKey = 'about' | 'blog' | 'contact' | 'partners'
type LegalLinkKey = 'privacy' | 'terms' | 'imprint'

const PLATFORM_LINKS: PlatformLinkKey[] = ['post_offer', 'company', 'freelance', 'permanent', 'pricing']
const COMPANY_LINKS: CompanyLinkKey[] = ['about', 'blog', 'contact', 'partners']
const LEGAL_LINKS: LegalLinkKey[] = ['privacy', 'terms', 'imprint']

export default function Footer() {
  const domain = useDomain()
  const t = useTranslations('footer')
  const year = new Date().getFullYear()

  return (
    <footer style={{ background: 'linear-gradient(160deg, #e0f2fe, #bae6fd 40%, #93c5fd 80%, #a5b4fc)' }}>
      <div style={{ padding: '32px 32px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 24, marginBottom: 24 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ width: 26, height: 26, borderRadius: 7, background: domain.primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {domain.logoUrl ? (
                  <img src={domain.logoUrl} alt={domain.name} width={16} height={16} />
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2L12 22M2 12L22 12M5 5L19 19M19 5L5 19" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
                  </svg>
                )}
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{domain.name}</span>
            </div>
            <p style={{ fontSize: 11, color: '#1e3a5f', lineHeight: 1.6, maxWidth: 200 }}>
              {t('tagline', { ecosystem: domain.ecosystemName })}
            </p>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', marginBottom: 10 }}>{t('col_platform')}</div>
            {PLATFORM_LINKS.map(k => (
              <div key={k} style={{ fontSize: 11, color: '#1e3a5f', marginBottom: 6, cursor: 'pointer' }}>
                {t(`links.${k}`)}
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', marginBottom: 10 }}>{t('col_domains')}</div>
            {domain.tags.slice(0, 4).map(l => (
              <div key={l} style={{ fontSize: 11, color: '#1e3a5f', marginBottom: 6, cursor: 'pointer' }}>{l}</div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', marginBottom: 10 }}>{t('col_company')}</div>
            {COMPANY_LINKS.map(k => (
              <div key={k} style={{ fontSize: 11, color: '#1e3a5f', marginBottom: 6, cursor: 'pointer' }}>
                {t(`links.${k}`)}
              </div>
            ))}
          </div>
        </div>
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.5)', paddingTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: '#1e3a5f' }}>
            {t('copyright', { year, name: domain.name })}
          </span>
          <div style={{ display: 'flex', gap: 14 }}>
            {LEGAL_LINKS.map(k => (
              <span key={k} style={{ fontSize: 10, color: '#1e3a5f', cursor: 'pointer' }}>
                {t(`legal.${k}`)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}
