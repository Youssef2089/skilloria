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
      bg: 'var(--sk-accent-soft)',
      title: t('roles.entreprise.title'),
      subtitle: t('roles.entreprise.subtitle'),
    },
    {
      id: 'expert',
      href: '/inscription/expert',
      icon: '💼',
      bg: 'var(--sk-accent-soft)',
      title: t('roles.expert.title'),
    },
    {
      id: 'cdi',
      href: '/inscription/cdi',
      icon: '🎓',
      bg: 'var(--sk-success-soft)',
      title: t('roles.cdi.title'),
    },
  ]

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--sk-surface-2)',
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
          <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--sk-text)' }}>{domain.name}</span>
        </div>
        <LanguageSwitcher />
      </div>

      {/* Titre */}
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ display: 'inline-block', background: domain.primaryColor, color: 'var(--sk-surface)', fontSize: 16, fontWeight: 700, padding: '7px 20px', borderRadius: 100, marginBottom: 14, letterSpacing: '.05em' }}>
          {t('welcome_badge')}
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--sk-text)', lineHeight: 1.2, marginBottom: 8 }}>
          {t('title')}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--sk-muted)' }}>
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
              background: 'var(--sk-surface)', border: '2px solid var(--sk-border)',
              borderRadius: 20, padding: '32px 24px',
              textAlign: 'center', cursor: 'pointer',
              flex: 1, minWidth: 180, maxWidth: 220,
              transition: 'all .2s',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget
              el.style.borderColor = domain.primaryColor
              el.style.transform = 'translateY(-4px)'
              el.style.boxShadow = `0 12px 32px color-mix(in srgb, ${domain.primaryColor} 15%, transparent)`
            }}
            onMouseLeave={e => {
              const el = e.currentTarget
              el.style.borderColor = 'var(--sk-border)'
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
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--sk-text)', marginBottom: role.subtitle ? 6 : 0 }}>
              {role.title}
            </div>
            {role.subtitle && (
              <div style={{ fontSize: 12, color: 'var(--sk-muted)', lineHeight: 1.5 }}>
                {role.subtitle}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Déjà un compte */}
      <p style={{ fontSize: 13, color: 'var(--sk-muted)' }}>
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
