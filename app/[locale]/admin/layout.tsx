'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter, usePathname } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { useDomain } from '@/context/DomainContext'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import SessionHeartbeat from '@/components/SessionHeartbeat'

/**
 * Layout du back-office /admin (B5c).
 *
 * Garde admin côté CLIENT :
 *   1. supabase.auth.getSession() → session ? sinon redirect /connexion
 *   2. SELECT users.user_type WHERE id = session.user.id
 *      → si != 'admin' → redirect / (RLS autorise l'user à lire sa propre row)
 *
 * Défense en profondeur : les routes API /api/admin/* refont la vérif côté
 * serveur via requireAdmin (lib/admin-guard). Donc même si le check client
 * était bypassé (devtools, etc.), aucune action admin ne serait possible.
 *
 * Sidebar extensible : section "Validation" avec Organisations (actif) et
 * Experts (désactivé, badge "bientôt").
 */

type GuardState =
  | { kind: 'loading' }
  | { kind: 'ok' }
  | { kind: 'redirect_login' }
  | { kind: 'redirect_home' }
  | { kind: 'error' }

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('admin_back_office')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const pathname = usePathname()
  const domain = useDomain()

  const [state, setState] = useState<GuardState>({ kind: 'loading' })

  const checkAdmin = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.user) {
      setState({ kind: 'redirect_login' })
      return
    }
    const { data: row, error } = await supabase
      .from('users')
      .select('user_type')
      .eq('id', session.user.id)
      .maybeSingle()
    if (error) {
      console.error('[admin/layout] user_type lookup failed', error.message)
      setState({ kind: 'error' })
      return
    }
    if (!row || row.user_type !== 'admin') {
      setState({ kind: 'redirect_home' })
      return
    }
    setState({ kind: 'ok' })
  }, [])

  useEffect(() => {
    void checkAdmin()
  }, [checkAdmin])

  // Redirects via useEffect (jamais pendant render, leçon B3.1)
  useEffect(() => {
    if (state.kind === 'redirect_login') router.replace('/connexion')
    else if (state.kind === 'redirect_home') router.replace('/')
  }, [state.kind, router])

  if (state.kind === 'loading' || state.kind === 'redirect_login' || state.kind === 'redirect_home') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Inter, system-ui, sans-serif',
          color: '#64748b',
          fontSize: 14,
        }}
      >
        {t('loading')}
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          <p style={{ fontSize: 14, color: '#b91c1c', marginBottom: 12 }}>
            {t('errors.generic')}
          </p>
          <button
            type="button"
            onClick={() => router.replace('/')}
            style={{
              padding: '10px 18px',
              background: '#00B9FF',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {tCommon('user_fallback')}
          </button>
        </div>
      </div>
    )
  }

  // state.kind === 'ok'
  const isOrgsActive = pathname.startsWith('/admin/organisations') || pathname === '/admin'

  return (
    <>
      <SessionHeartbeat />
      <div
      className="admin-layout"
      style={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: '220px 1fr',
        background: 'var(--color-background-secondary, #f8fafc)',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <style>{`
        @media (max-width: 767px) {
          .admin-layout { grid-template-columns: 1fr !important; }
          .admin-sidebar {
            border-right: none !important;
            border-bottom: 0.5px solid var(--color-border-tertiary, #e5e7eb) !important;
          }
          .admin-main { padding: 20px !important; }
        }
      `}</style>

      <aside
        className="admin-sidebar"
        style={{
          background: '#fff',
          borderRight: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
          padding: '24px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 6px 18px',
            borderBottom: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
            marginBottom: 12,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: domain.primaryColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2L12 22M2 12L22 12M5 5L19 19M19 5L5 19"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--color-text-primary, #0f172a)',
              lineHeight: 1.3,
            }}
          >
            {t('sidebar.title')}
          </span>
        </div>

        {/* Section Validation */}
        <div
          style={{
            fontSize: 10,
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '.08em',
            color: 'var(--color-text-tertiary, #94a3b8)',
            padding: '6px 12px',
          }}
        >
          {t('sidebar.section_validation')}
        </div>

        <Link
          href="/admin/organisations"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 12px',
            fontSize: 13,
            fontWeight: isOrgsActive ? 500 : 400,
            color: isOrgsActive
              ? 'var(--color-text-primary, #0f172a)'
              : 'var(--color-text-secondary, #64748b)',
            background: isOrgsActive
              ? 'var(--color-background-secondary, #f1f5f9)'
              : 'transparent',
            borderRadius: 8,
            textDecoration: 'none',
            transition: 'background .15s, color .15s',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="3" width="16" height="18" rx="1" />
            <path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01" />
            <path d="M10 21v-4h4v4" />
          </svg>
          {t('sidebar.nav_organisations')}
        </Link>

        {/* Experts désactivé */}
        <div
          aria-disabled
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '9px 12px',
            fontSize: 13,
            color: 'var(--color-text-tertiary, #94a3b8)',
            borderRadius: 8,
            cursor: 'not-allowed',
            userSelect: 'none',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" />
            </svg>
            {t('sidebar.nav_experts')}
          </span>
          <span
            style={{
              fontSize: 9,
              fontWeight: 500,
              padding: '2px 7px',
              background: 'var(--color-background-secondary, #f1f5f9)',
              color: 'var(--color-text-tertiary, #94a3b8)',
              borderRadius: 10,
              textTransform: 'uppercase',
              letterSpacing: '.05em',
            }}
          >
            {t('sidebar.nav_experts_soon')}
          </span>
        </div>

        {/* Switcher locale en bas */}
        <div style={{ marginTop: 'auto', paddingTop: 14 }}>
          <LanguageSwitcher />
        </div>
      </aside>

      <main className="admin-main" style={{ padding: '32px 40px', minWidth: 0 }}>
        {children}
      </main>
      </div>
    </>
  )
}
