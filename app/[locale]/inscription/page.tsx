'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import LanguageSwitcher from '@/components/LanguageSwitcher'

export default function InscriptionPage() {
  const router = useRouter()
  const domain = useDomain()
  const t = useTranslations('signup')

  const roles: Array<{
    id: string
    href: string
    icon: string
    bg: string
    title: string
    subtitle?: string
  }> = [
    {
      id: 'entreprise',
      href: '/inscription/organisation',
      icon: '🏢',
      bg: '#dbeafe',
      title: t('roles.entreprise.title'),
      subtitle: t('roles.entreprise.subtitle'),
    },
    {
      id: 'expert',
      href: '/inscription/expert',
      icon: '💼',
      bg: '#ede9fe',
      title: t('roles.expert.title'),
    },
    {
      id: 'cdi',
      href: '/inscription/cdi',
      icon: '🎓',
      bg: '#dcfce7',
      title: t('roles.cdi.title'),
    },
  ]

  return (
    <div style={{
      minHeight: '100vh', background: '#f8fafc',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'flex-start',
      padding: '24px 24px 48px', fontFamily: 'Inter, sans-serif',
    }}>

      {/* Logo + LanguageSwitcher */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: domain.primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L12 22M2 12L22 12M5 5L19 19M19 5L5 19" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <span style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{domain.name}</span>
        </div>
        <LanguageSwitcher />
      </div>

      {/* Titre */}
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ display: 'inline-block', background: domain.primaryColor, color: '#fff', fontSize: 16, fontWeight: 700, padding: '7px 20px', borderRadius: 100, marginBottom: 14, letterSpacing: '.05em' }}>
          {t('welcome_badge')}
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', lineHeight: 1.2, marginBottom: 8 }}>
          {t('title')}
        </h1>
        <p style={{ fontSize: 14, color: '#64748b' }}>
          {t('subtitle')}
        </p>
      </div>

      {/* Cards */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 32 }}>
        {roles.map((role) => (
          <div
            key={role.id}
            onClick={() => router.push(role.href)}
            style={{
              background: '#fff', border: '2px solid #e2e8f0',
              borderRadius: 20, padding: '32px 24px',
              textAlign: 'center', cursor: 'pointer',
              flex: 1, minWidth: 180, maxWidth: 220,
              transition: 'all .2s',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget
              el.style.borderColor = domain.primaryColor
              el.style.transform = 'translateY(-4px)'
              el.style.boxShadow = `0 12px 32px ${domain.primaryColor}26`
            }}
            onMouseLeave={e => {
              const el = e.currentTarget
              el.style.borderColor = '#e2e8f0'
              el.style.transform = 'translateY(0)'
              el.style.boxShadow = 'none'
            }}
          >
            <div style={{
              width: 80, height: 80, borderRadius: '50%',
              background: role.bg, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px', fontSize: 36,
            }}>
              {role.icon}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: role.subtitle ? 6 : 0 }}>
              {role.title}
            </div>
            {role.subtitle && (
              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
                {role.subtitle}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Déjà un compte */}
      <p style={{ fontSize: 13, color: '#64748b' }}>
        {t('already_account')}{' '}
        <span
          onClick={() => router.push('/connexion')}
          style={{ color: domain.primaryColor, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}
        >
          {t('sign_in')}
        </span>
      </p>

    </div>
  )
}
