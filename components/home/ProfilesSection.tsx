'use client'

import { useTranslations } from 'next-intl'
import { useDomain } from '@/context/DomainContext'

const palette = [
  { bg: '#dbeafe', color: '#1d4ed8' },
  { bg: '#dcfce7', color: '#15803d' },
  { bg: '#fef9c3', color: '#a16207' },
  { bg: '#ede9fe', color: '#6d28d9' },
  { bg: '#ffedd5', color: '#c2410c' },
  { bg: '#fce7f3', color: '#9d174d' },
  { bg: '#ecfeff', color: '#0e7490' },
  { bg: '#f0fdf4', color: '#166534' },
  { bg: '#fdf4ff', color: '#7e22ce' },
  { bg: '#f5f3ff', color: '#5b21b6' },
]

export default function ProfilesSection() {
  const domain = useDomain()
  const t = useTranslations('homepage.profiles')

  return (
    <div style={{ borderBottom: '1px solid #f0f0f0', padding: '12px 32px', background: '#fff' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 8, maxWidth: 700, marginLeft: 'auto', marginRight: 'auto' }}>
        {domain.featuredProducts.map((d, i) => {
          const { bg, color } = palette[i % palette.length]
          return (
            <div key={d.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 100, fontSize: 11, fontWeight: 600, background: bg, color }}>
              <span style={{ fontSize: 12 }}>{d.icon}</span> {d.label}
            </div>
          )
        })}
      </div>
      <div style={{ textAlign: 'center' }}>
        <span style={{ fontSize: 11, color: '#0ea5e9', fontWeight: 600, cursor: 'pointer', borderBottom: '1px dashed #7dd3fc' }}>
          {t('more_domains', { ecosystem: domain.ecosystemName })}
        </span>
      </div>
    </div>
  )
}
