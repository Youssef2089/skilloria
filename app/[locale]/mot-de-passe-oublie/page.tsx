'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { useDomain } from '@/context/DomainContext'
import LanguageSwitcher from '@/components/LanguageSwitcher'

/**
 * /[locale]/mot-de-passe-oublie — demande d'un lien de réinitialisation.
 *
 * Page d'AUTH (carte centrée, même style que connexion/page.tsx — PAS la règle
 * pleine largeur dashboard).
 *
 * Flow IMPLICIT (cf. audit) : `resetPasswordForEmail` envoie un email dont le
 * lien ramène sur /[locale]/nouveau-mot-de-passe avec un hash
 * `#access_token=…&type=recovery` auto-parsé par le SDK. Le redirectTo est
 * construit côté client via `window.location.origin` (même mécanisme que le
 * `emailRedirectTo` du signup → staging/prod/localhost automatiques).
 *
 * Anti-énumération : on n'expose JAMAIS si l'email existe. `resetPasswordForEmail`
 * ne renvoie pas d'erreur sur email inconnu ; on affiche un message neutre dans
 * tous les cas de succès.
 */
export default function MotDePasseOubliePage() {
  const router = useRouter()
  const locale = useLocale()
  const domain = useDomain()
  const t = useTranslations('forgot_password')
  const tLogin = useTranslations('login')

  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (!email.trim()) {
      setError(t('errors.missing_email'))
      return
    }
    setLoading(true)
    setError('')

    const redirectTo = `${window.location.origin}/${locale}/nouveau-mot-de-passe`
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo,
    })

    // Anti-énumération : on n'affiche PAS si l'email existe. On ne montre une
    // erreur que pour une vraie panne technique (réseau / 5xx), pas pour un
    // "email inconnu" (que Supabase ne signale de toute façon pas).
    if (resetError) {
      setError(t('errors.generic'))
      setLoading(false)
      return
    }

    setSent(true)
    setLoading(false)
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
        {!sent ? (
          <>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', marginBottom: 6 }}>
              {t('title')}
            </h1>
            <p style={{ fontSize: 14, color: '#64748b', marginBottom: 28 }}>
              {t('subtitle')}
            </p>

            {/* Email */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                {tLogin('email_label')}
              </label>
              <input
                type="email"
                placeholder={tLogin('email_placeholder')}
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !loading) void handleSubmit() }}
                style={{
                  width: '100%', padding: '10px 14px',
                  border: '1.5px solid #e2e8f0', borderRadius: 10,
                  fontSize: 14, color: '#0f172a', outline: 'none',
                }}
              />
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
          </>
        ) : (
          <>
            {/* Écran neutre post-envoi (anti-énumération) */}
            <div style={{ width: 56, height: 56, margin: '0 auto 20px', borderRadius: '50%', background: '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M4 6l8 6 8-6M4 6h16v12H4V6z" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', marginBottom: 8, textAlign: 'center' }}>
              {t('sent_title')}
            </h1>
            <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24, textAlign: 'center', lineHeight: 1.6 }}>
              {t('sent_message')}
            </p>
          </>
        )}

        {/* Retour connexion (toujours visible) */}
        <p style={{ textAlign: 'center', fontSize: 13, marginTop: sent ? 0 : 4 }}>
          <span
            onClick={() => router.push('/connexion')}
            style={{ color: domain.primaryColor, fontWeight: 600, cursor: 'pointer' }}
          >
            {t('back_to_login')}
          </span>
        </p>
      </div>
    </div>
  )
}
