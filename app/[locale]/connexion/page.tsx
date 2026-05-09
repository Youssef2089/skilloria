'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { useDomain } from '@/context/DomainContext'
import { dashboardUrlForUserType } from '@/lib/auth-routing'
import LanguageSwitcher from '@/components/LanguageSwitcher'

export default function ConnexionPage() {
  const router = useRouter()
  const domain = useDomain()
  const t = useTranslations('login')
  const [form, setForm] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (!form.email || !form.password) {
      setError(t('errors.missing_fields'))
      return
    }

    setLoading(true)
    setError('')

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email: form.email,
      password: form.password,
    })

    if (authError) {
      setError(t('errors.invalid_credentials'))
      setLoading(false)
      return
    }

    // Récupérer le profil utilisateur (user_type = expert_freelance/expert_cdi/client/cabinet)
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('user_type, domain_id, domains(slug)')
      .eq('id', data.user.id)
      .single()

    if (userError || !userData) {
      setError(t('errors.profile_not_found'))
      setLoading(false)
      return
    }

    const userType = userData.user_type as string

    // Vérification du domaine — uniquement pour les experts (freelance + CDI)
    if (userType === 'expert_freelance' || userType === 'expert_cdi') {
      const userDomainSlug = (userData.domains as any)?.slug
      if (userDomainSlug && userDomainSlug !== domain.subdomain) {
        await supabase.auth.signOut()
        setError(t('errors.wrong_domain', { subdomain: userDomainSlug }))
        setLoading(false)
        return
      }
    }

    // Redirection selon le type d'utilisateur — mapping mutualisé
    // dans lib/auth-routing.ts, partagé avec /auth/callback (B3.3.fix2).
    router.push(dashboardUrlForUserType(userType))
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#f8fafc',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'flex-start',
      padding: '24px', fontFamily: 'Inter, sans-serif',
    }}>

      {/* Logo + LanguageSwitcher */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32, flexWrap: 'wrap', justifyContent: 'center' }}>
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

      {/* Card */}
      <div style={{
        background: '#fff', borderRadius: 24,
        border: '1px solid #e2e8f0', padding: '40px',
        width: '100%', maxWidth: 440,
        boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
      }}>

        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', marginBottom: 6 }}>
          {t('title')}
        </h1>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 28 }}>
          {t('subtitle', { name: domain.name })}
        </p>

        {/* Email */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
            {t('email_label')}
          </label>
          <input
            type="email"
            placeholder={t('email_placeholder')}
            value={form.email}
            onChange={e => setForm({ ...form, email: e.target.value })}
            style={{
              width: '100%', padding: '10px 14px',
              border: '1.5px solid #e2e8f0', borderRadius: 10,
              fontSize: 14, color: '#0f172a', outline: 'none',
            }}
          />
        </div>

        {/* Mot de passe */}
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
            {t('password_label')}
          </label>
          <input
            type="password"
            placeholder={t('password_placeholder')}
            value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
            style={{
              width: '100%', padding: '10px 14px',
              border: '1.5px solid #e2e8f0', borderRadius: 10,
              fontSize: 14, color: '#0f172a', outline: 'none',
            }}
          />
        </div>

        {/* Mot de passe oublié */}
        <div style={{ textAlign: 'right', marginBottom: 24 }}>
          <span
            onClick={() => router.push('/mot-de-passe-oublie')}
            style={{ fontSize: 12, color: domain.primaryColor, fontWeight: 600, cursor: 'pointer' }}
          >
            {t('forgot_password')}
          </span>
        </div>

        {/* Erreur */}
        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#dc2626' }}>
            {error}
          </div>
        )}

        {/* Bouton */}
        <button
          onClick={handleSubmit}
          disabled={loading}
          style={{
            width: '100%', padding: 13,
            background: loading ? '#7dd3fc' : domain.primaryColor,
            color: '#fff', border: 'none',
            borderRadius: 12, fontSize: 15,
            fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
            marginBottom: 20,
          }}
        >
          {loading ? t('submitting') : t('submit')}
        </button>

        {/* Séparateur */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1, height: 1, background: '#e2e8f0' }}></div>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>{t('separator_or')}</span>
          <div style={{ flex: 1, height: 1, background: '#e2e8f0' }}></div>
        </div>

        {/* Créer un compte */}
        <p style={{ textAlign: 'center', fontSize: 13, color: '#64748b' }}>
          {t('no_account')}{' '}
          <span
            onClick={() => router.push('/inscription')}
            style={{ color: domain.primaryColor, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}
          >
            {t('create_account')}
          </span>
        </p>

      </div>
    </div>
  )
}
