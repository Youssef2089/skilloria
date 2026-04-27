'use client'

import { useTranslations } from 'next-intl'
import { useDomain } from '@/context/DomainContext'

export default function AdSection() {
  const domain = useDomain()
  const t = useTranslations('homepage.ad')

  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      justifyContent: 'space-between',
      padding: '16px 32px',
      borderBottom: '1px solid #f0f0f0',
      background: '#fff',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{
          fontSize: 10, color: '#94a3b8',
          border: '1px solid #e2e8f0',
          padding: '2px 8px', borderRadius: 4,
          whiteSpace: 'nowrap',
        }}>{t('sponsored_label')}</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{t('title')}</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            {t('description', { ecosystem: domain.ecosystemName })}
          </div>
        </div>
      </div>
      <button style={{
        background: '#0ea5e9', color: '#fff',
        border: 'none', borderRadius: 100,
        padding: '9px 18px', fontSize: 12,
        fontWeight: 700, cursor: 'pointer',
        whiteSpace: 'nowrap', marginLeft: 16,
      }}>{t('cta')}</button>
    </div>
  )
}
