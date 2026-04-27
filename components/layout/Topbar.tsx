'use client'

import { useDomain } from '@/context/DomainContext'
import LanguageSwitcher from '@/components/LanguageSwitcher'

export default function Topbar() {
  const domain = useDomain()

  return (
    <div style={{
      background: '#f8f8f8',
      padding: '6px 40px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      flexWrap: 'wrap',
      borderBottom: '1px solid #eee',
      fontSize: '12px',
    }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        color: '#555',
      }}>
        <div style={{ width: 7, height: 7, background: '#22c55e', borderRadius: '50%' }} />
        {domain.name} — {domain.tagline}
      </div>
      <LanguageSwitcher />
    </div>
  )
}
