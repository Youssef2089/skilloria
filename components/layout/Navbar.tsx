'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'

type MenuKey = 'company' | 'freelance' | 'permanent' | 'pricing'

export default function Navbar() {
  const router = useRouter()
  const domain = useDomain()
  const t = useTranslations('navbar')

  const menuItems: Array<{ key: MenuKey; dropdown: boolean }> = [
    { key: 'company', dropdown: true },
    { key: 'freelance', dropdown: true },
    { key: 'permanent', dropdown: false },
    { key: 'pricing', dropdown: false },
  ]

  return (
    <nav style={{
      background: '#fff',
      borderBottom: '1px solid #e5e5e5',
      padding: '0 32px',
      display: 'flex',
      alignItems: 'center',
      height: '48px',
      position: 'relative',
      zIndex: 10,
    }}>
      <div
        onClick={() => router.push('/')}
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 28, flexShrink: 0, cursor: 'pointer' }}
      >
        <div style={{ width: 32, height: 32, borderRadius: 8, background: domain.primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {domain.logoUrl ? (
            <img src={domain.logoUrl} alt={domain.name} width={20} height={20} />
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L12 22M2 12L22 12M5 5L19 19M19 5L5 19" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          )}
        </div>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.3px', whiteSpace: 'nowrap' }}>
          {domain.name}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
        {menuItems.map((item) => (
          <div key={item.key} style={{
            padding: '0 12px', height: 48,
            fontSize: 12, fontWeight: 500, color: '#1a1a1a',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            whiteSpace: 'nowrap',
          }}>
            {t(`menu.${item.key}`)}
            {item.dropdown && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto', flexShrink: 0 }}>
        <button
          onClick={() => router.push('/inscription')}
          style={{
            fontSize: 12, fontWeight: 700, color: '#fff',
            background: domain.primaryColor, border: 'none',
            borderRadius: 100, padding: '7px 16px',
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          {t('cta_signup')}
        </button>

        <button
          onClick={() => router.push('/connexion')}
          style={{
            fontSize: 12, fontWeight: 600, color: domain.primaryColor,
            background: 'none', border: 'none',
            cursor: 'pointer', textDecoration: 'underline',
            textUnderlineOffset: 3, whiteSpace: 'nowrap',
          }}
        >
          {t('cta_signin')}
        </button>
      </div>
    </nav>
  )
}
