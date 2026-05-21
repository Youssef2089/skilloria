'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { useDomain } from '@/context/DomainContext'
import { dashboardUrlForUserType, FALLBACK_DASHBOARD_URL } from '@/lib/auth-routing'
import { initSession } from '@/lib/secure-fetch'
import LanguageSwitcher from '@/components/LanguageSwitcher'

/**
 * Page de callback après clic sur le lien de confirmation email Supabase.
 *
 * Fonctionnement :
 *   1. Le SDK Supabase (createClient avec detectSessionInUrl=true par défaut)
 *      parse automatiquement le hash `#access_token=...&type=signup` au mount
 *      et pose la session dans le storage local.
 *   2. `auth.getSession()` retourne donc la session immédiatement.
 *   3. On lit `users.user_type` puis on redirige via le helper auth-routing.
 *
 * Cas edge :
 *   - L'user est déjà connecté (clic sur lien après être passé sur /connexion) :
 *     `getSession()` retourne directement la session existante → redirect direct.
 *   - Aucune session (lien expiré, token invalide) : on affiche un état d'erreur
 *     avec 2 actions de récupération.
 */
export default function AuthCallbackPage() {
  const router = useRouter()
  const domain = useDomain()
  const t = useTranslations('inscription_org.callback')

  const [redirectUrl, setRedirectUrl] = useState<string | null>(null)
  const [hasError, setHasError] = useState(false)

  // 1. Récupère la session + user_type, calcule l'URL cible.
  useEffect(() => {
    let cancelled = false

    async function run() {
      try {
        const { data: sessionData, error: sessionErr } = await supabase.auth.getSession()
        if (cancelled) return

        if (sessionErr || !sessionData.session?.user) {
          setHasError(true)
          return
        }

        const userId = sessionData.session.user.id
        const accessToken = sessionData.session.access_token

        // Session unique (11F) : on pose le token+cookie AVANT le redirect.
        // Best-effort, ne bloque pas le flow d'arrivée sur le dashboard.
        await initSession({ accessToken, subdomain: domain.subdomain })

        const { data: userRow, error: userErr } = await supabase
          .from('users')
          .select('user_type')
          .eq('id', userId)
          .maybeSingle()

        if (cancelled) return

        if (userErr) {
          console.error('[auth/callback] users lookup failed', userErr.message)
        }

        const target = dashboardUrlForUserType(
          (userRow?.user_type as string | null | undefined) ?? null,
        )
        setRedirectUrl(target ?? FALLBACK_DASHBOARD_URL)
      } catch (err) {
        console.error('[auth/callback] unexpected error', err)
        if (!cancelled) setHasError(true)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [])

  // 2. Effectue la redirection (séparé pour ne pas appeler router.push pendant
  //    le render — leçon B3.1).
  useEffect(() => {
    if (redirectUrl) {
      router.replace(redirectUrl)
    }
  }, [redirectUrl, router])

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      {/* Logo + LanguageSwitcher */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginBottom: 40,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 9,
              background: domain.primaryColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2L12 22M2 12L22 12M5 5L19 19M19 5L5 19"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <span style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>
            {domain.name}
          </span>
        </div>
        <LanguageSwitcher />
      </div>

      <div
        style={{
          background: '#fff',
          borderRadius: 24,
          border: '1px solid #e2e8f0',
          padding: '48px 40px',
          width: '100%',
          maxWidth: 440,
          boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
          textAlign: 'center',
        }}
      >
        {!hasError ? (
          <>
            {/* Spinner */}
            <div
              aria-label="loading"
              style={{
                width: 56,
                height: 56,
                margin: '0 auto 24px',
                borderRadius: '50%',
                border: `4px solid ${domain.primaryColor}33`,
                borderTopColor: domain.primaryColor,
                animation: 'auth-callback-spin 0.9s linear infinite',
              }}
            />
            <h1
              style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}
            >
              {t('verifying_title')}
            </h1>
            <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6 }}>
              {t('verifying_subtitle')}
            </p>
            <style>{`
              @keyframes auth-callback-spin {
                to { transform: rotate(360deg); }
              }
            `}</style>
          </>
        ) : (
          <>
            {/* Icône erreur */}
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                background: '#fef2f2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px',
              }}
            >
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 8v5M12 16h.01M3 12a9 9 0 1018 0 9 9 0 00-18 0z"
                  stroke="#dc2626"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h1
              style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}
            >
              {t('error_title')}
            </h1>
            <p
              style={{
                fontSize: 14,
                color: '#64748b',
                lineHeight: 1.6,
                marginBottom: 28,
              }}
            >
              {t('error_subtitle')}
            </p>

            <button
              onClick={() => router.push('/inscription')}
              style={{
                width: '100%',
                padding: 13,
                background: domain.primaryColor,
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
                marginBottom: 12,
                fontFamily: 'inherit',
              }}
            >
              {t('back_to_signup')}
            </button>
            <button
              onClick={() => router.push('/connexion')}
              style={{
                width: '100%',
                padding: 13,
                background: 'transparent',
                color: domain.primaryColor,
                border: `1px solid ${domain.primaryColor}`,
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {t('back_to_signin')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
