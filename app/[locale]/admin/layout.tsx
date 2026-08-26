'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter, usePathname } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { useDomain } from '@/context/DomainContext'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import SessionHeartbeat from '@/components/SessionHeartbeat'
import DeletionGate from '@/components/DeletionGate'
import GlobalBackButton from '@/components/shell/GlobalBackButton'
import LegalFooter from '@/components/layout/LegalFooter'
import { ADMIN_NAV_SECTIONS } from '@/lib/nav-config'

/** Icônes de la sidebar admin, indexées par `iconKey` de ADMIN_NAV_SECTIONS. */
const ADMIN_NAV_ICONS: Record<string, React.ReactNode> = {
  building: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01" />
      <path d="M10 21v-4h4v4" />
    </svg>
  ),
  user: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" />
    </svg>
  ),
  package: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12" />
    </svg>
  ),
  // Collaboration entre experts — deux personnes reliées (sous-traitance).
  collaboration: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="3" />
      <circle cx="17" cy="15" r="3" />
      <path d="M2 20v-1.5A3.5 3.5 0 0 1 5.5 15h2" />
      <path d="M11 8h3a3 3 0 0 1 3 3v1" />
    </svg>
  ),
  // Taxonomie (branches / spécialités) — arborescence à puces.
  taxonomy: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="5" r="2" />
      <circle cx="18" cy="12" r="2" />
      <circle cx="18" cy="19" r="2" />
      <path d="M6 7v9a2 2 0 0 0 2 2h8M8 12h8" />
    </svg>
  ),
}

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
  const tShell = useTranslations('shell')
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

  return (
    <>
      <SessionHeartbeat />
      {/* C3 : couverture de l'admin (hors /dashboard) par le gate de suppression. */}
      <DeletionGate />
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
        {/* Header — cliquable vers l'accueil (convention universelle). */}
        <Link
          href="/"
          aria-label={tShell('brand_home_aria', { name: domain.name })}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 6px 18px',
            borderBottom: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
            marginBottom: 12,
            textDecoration: 'none',
            transition: 'opacity .15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
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
        </Link>

        {/* Nav — rendue depuis ADMIN_NAV_SECTIONS (lib/nav-config), la MEME
            structure dont lib/menu-routes derive les routes de menu. Ajouter une
            entree la-bas suffit : lien + absence de bouton Retour. */}
        {ADMIN_NAV_SECTIONS.map((sec) => (
          <div key={sec.sectionKey}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: '.08em',
                color: 'var(--color-text-tertiary, #94a3b8)',
                padding: '14px 12px 6px',
              }}
            >
              {t(`sidebar.${sec.sectionKey}` as 'sidebar.section_validation')}
            </div>

            {sec.items.map((item) => {
              const active =
                pathname.startsWith(item.href) ||
                (item.extraActivePaths ?? []).includes(pathname)
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 12px',
                    fontSize: 13,
                    fontWeight: active ? 500 : 400,
                    color: active
                      ? 'var(--color-text-primary, #0f172a)'
                      : 'var(--color-text-secondary, #64748b)',
                    background: active
                      ? 'var(--color-background-secondary, #f1f5f9)'
                      : 'transparent',
                    borderRadius: 8,
                    textDecoration: 'none',
                    transition: 'background .15s, color .15s',
                  }}
                >
                  {ADMIN_NAV_ICONS[item.iconKey]}
                  {t(`sidebar.${item.labelKey}` as 'sidebar.nav_organisations')}
                </Link>
              )
            })}
          </div>
        ))}

        {/* Switcher locale en bas */}
        <div style={{ marginTop: 'auto', paddingTop: 14 }}>
          <LanguageSwitcher />
        </div>
      </aside>

      <main className="admin-main" style={{ padding: '24px 26px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <GlobalBackButton />
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
        {/* Point B — accès universel aux pages légales depuis l'admin. */}
        <div style={{ marginTop: 24 }}>
          <LegalFooter />
        </div>
      </main>
      </div>
    </>
  )
}
