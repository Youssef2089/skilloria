'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Plus_Jakarta_Sans } from 'next/font/google'
import { Link, useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { supabase } from '@/lib/supabase'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import {
  useCdiProfile,
  type CdiProfile,
  type CdiStatus,
  type CdiUser,
} from '@/lib/hooks/useCdiProfile'
import { useCdiApplications } from '@/lib/hooks/useCdiApplications'
import CdiStatusToggle from '@/components/cdi/CdiStatusToggle'
import AvatarUploadModal from '@/components/AvatarUploadModal'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
})

const fontJakarta = 'var(--font-jakarta), system-ui, sans-serif'

const STATUS_BADGE_COLORS: Record<CdiStatus, string> = {
  employed: '#94a3b8',
  open_to_work: '#10b981',
  actively_searching: '#f97316',
}

// Champs essentiels pour le calcul de complétion (9 critères)
function calculateCompletion(profile: CdiProfile | null): number {
  if (!profile) return 0
  const fields = [
    !!profile.title?.trim(),
    !!profile.summary?.trim(),
    !!profile.branch_id,
    !!profile.speciality_id,
    (profile.skills?.length ?? 0) >= 3,
    !!profile.cdi_status,
    profile.cdi_salary_min != null,
    profile.cdi_salary_max != null,
    !!profile.cdi_notice_period,
  ]
  const filled = fields.filter(Boolean).length
  return Math.round((filled / fields.length) * 100)
}

function getGreetingName(user: CdiUser | null, fallback: string): string {
  if (!user) return fallback
  const first = user.first_name?.trim()
  if (first) return first
  const full = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()
  return full || fallback
}

function initialsOf(user: CdiUser | null): string {
  if (!user) return '?'
  const fn = (user.first_name ?? '').trim().charAt(0)
  const ln = (user.last_name ?? '').trim().charAt(0)
  return (fn + ln).toUpperCase() || '?'
}

export default function DashboardCDI() {
  const t = useTranslations('dashboard_cdi')
  const tProfile = useTranslations('cdi_profile_view')
  const router = useRouter()
  const domain = useDomain()
  const state = useCdiProfile()
  const { loading, authenticated, forbidden, error, user, profile } = state
  const apps = useCdiApplications()

  const [status, setStatus] = useState<CdiStatus | null>(null)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [avatarModalOpen, setAvatarModalOpen] = useState(false)
  // Mirror local de profile.photo_url pour permettre l'update optimiste
  // post-upload sans refetch (le hook useCdiProfile n'expose pas de setter).
  const [localPhotoUrl, setLocalPhotoUrl] = useState<string | null>(null)

  // Sync local status from server
  useEffect(() => {
    setStatus(profile?.cdi_status ?? null)
  }, [profile?.cdi_status])

  // Sync localPhotoUrl from server profile (et reset si profile change)
  useEffect(() => {
    setLocalPhotoUrl(profile?.photo_url ?? null)
  }, [profile?.photo_url])

  // Redirect non-auth → /connexion
  useEffect(() => {
    if (!loading && !authenticated) {
      router.push('/connexion')
    }
  }, [loading, authenticated, router])

  // Toast auto-dismiss 3s
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(id)
  }, [toast])

  const handleStatusChange = async (next: CdiStatus) => {
    if (!user || !profile || statusUpdating || next === status) return
    const previous = status
    setStatus(next) // optimistic
    setStatusUpdating(true)
    try {
      const { error: upErr } = await supabase
        .from('profiles')
        .update({ cdi_status: next })
        .eq('user_id', user.id)
      if (upErr) {
        setStatus(previous) // rollback
        setToast({ type: 'error', text: t('toast.status_error') })
      } else {
        setToast({ type: 'success', text: t('toast.status_updated') })
      }
    } catch {
      setStatus(previous)
      setToast({ type: 'error', text: t('toast.status_error') })
    } finally {
      setStatusUpdating(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const completionPercent = useMemo(() => calculateCompletion(profile), [profile])

  // ----- LOADING / waiting auth ---------------------------------------------
  if (loading || (!authenticated && !error && !forbidden)) {
    return (
      <div
        className={jakarta.variable}
        style={{
          minHeight: '100vh',
          background: '#f8fafc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <style>{`@keyframes sk-spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              border: `3px solid ${domain.primaryColor}22`,
              borderTopColor: domain.primaryColor,
              margin: '0 auto 12px',
              animation: 'sk-spin 0.9s linear infinite',
            }}
          />
          <div style={{ fontSize: 14, color: '#64748b' }}>{t('loading')}</div>
        </div>
      </div>
    )
  }

  // ----- FORBIDDEN ----------------------------------------------------------
  if (forbidden) {
    return (
      <div
        className={jakarta.variable}
        style={{
          minHeight: '100vh',
          background: '#f8fafc',
          fontFamily: 'Inter, system-ui, sans-serif',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 16,
            padding: 32,
            maxWidth: 440,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden>🔒</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>403</div>
          <button
            type="button"
            onClick={() => router.push('/')}
            style={{
              background: domain.primaryColor,
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              padding: '10px 18px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            ←
          </button>
        </div>
      </div>
    )
  }

  const isVerified = !!user?.is_verified
  const greetingName = getGreetingName(user, tProfile('fallback_user_name'))
  const fullName = (() => {
    if (!user) return tProfile('fallback_user_name')
    const full = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()
    return full || tProfile('fallback_user_name')
  })()
  const initials = initialsOf(user)
  const currentStatus = status
  const statusBadgeColor = currentStatus ? STATUS_BADGE_COLORS[currentStatus] : null

  return (
    <div
      className={jakarta.variable}
      style={{
        minHeight: '100vh',
        background: '#f8fafc',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
        @keyframes slideInLeft { from { opacity: 0; transform: translateX(-12px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes sk-spin { to { transform: rotate(360deg); } }
        .nav-item {
          padding: 11px 16px;
          font-size: 14px;
          color: #4b5563;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-radius: 8px;
          margin: 2px 8px;
          text-decoration: none;
          transition: background 0.18s, transform 0.18s;
          animation: slideInLeft 0.35s ease both;
        }
        .nav-item:hover { background: #f1f5f9; transform: translateX(3px); }
        .nav-item-active {
          background: #f1f5f9;
          font-weight: 600;
          color: #0f172a;
        }
        .nav-item-locked {
          color: #cbd5e1;
          cursor: not-allowed;
        }
        .nav-item-locked:hover { background: transparent; transform: none; }
        .stat-card {
          border-radius: 14px;
          padding: 18px 20px;
          background: #fff;
          border: 1px solid #e2e8f0;
          transition: transform 0.2s, box-shadow 0.2s;
          animation: fadeInUp 0.4s ease both;
        }
        .stat-card:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.06); }
        .main-card {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 22px 24px;
          margin-bottom: 16px;
          animation: fadeInUp 0.45s ease both;
        }
        .pulse-dot {
          width: 8px; height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
          animation: pulse 2s ease-in-out infinite;
        }
        .progress-bar {
          height: 8px;
          background: #f1f5f9;
          border-radius: 999px;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          border-radius: 999px;
          transition: width 1s ease;
        }
        .score-box {
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          padding: 16px 22px;
          text-align: center;
          min-width: 104px;
          animation: fadeIn 0.5s ease 0.1s both;
          transition: box-shadow 0.2s, transform 0.2s;
        }
        .score-box:hover { box-shadow: 0 6px 20px rgba(0,0,0,0.08); transform: translateY(-2px); }
        @media (max-width: 767px) {
          .dashboard-layout { flex-direction: column !important; }
          .dashboard-sidebar { display: none !important; }
          .dashboard-main { padding: 18px !important; }
          .stats-grid { grid-template-columns: 1fr !important; }
          .greeting-row { flex-direction: column !important; align-items: flex-start !important; gap: 10px !important; }
          .score-box { width: 100%; }
          .verif-steps { flex-wrap: wrap !important; }
        }
        @media (min-width: 768px) {
          .stats-grid { grid-template-columns: repeat(3, 1fr) !important; }
        }
      `}</style>

      {/* HEADER */}
      <div
        style={{
          background: '#fff',
          borderBottom: '1px solid #e2e8f0',
          padding: '0 24px',
          height: 58,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          animation: 'fadeIn 0.3s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: domain.primaryColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {domain.logoUrl ? (
              <img src={domain.logoUrl} alt={domain.name} width={18} height={18} />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L12 22M2 12L22 12M5 5L19 19M19 5L5 19" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            )}
          </div>
          <span style={{ fontSize: 17, fontWeight: 700, color: '#0f172a' }}>{domain.name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <LanguageSwitcher />
          {isVerified ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: '#dcfce7',
                border: '1px solid #bbf7d0',
                padding: '5px 12px',
                borderRadius: 999,
              }}
            >
              <div className="pulse-dot" style={{ background: '#22c55e' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#15803d' }}>{t('topbar.verified')}</span>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: '#fef9c3',
                border: '1px solid #fde68a',
                padding: '5px 12px',
                borderRadius: 999,
              }}
            >
              <div className="pulse-dot" style={{ background: '#eab308' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#92400e' }}>{t('topbar.pending')}</span>
            </div>
          )}
        </div>
      </div>

      <div className="dashboard-layout" style={{ display: 'flex', minHeight: 'calc(100vh - 58px)' }}>

        {/* SIDEBAR */}
        <aside
          className="dashboard-sidebar"
          style={{
            width: 248,
            background: '#fff',
            borderRight: '1px solid #e2e8f0',
            padding: '22px 0',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
          }}
        >
          {/* Avatar block */}
          <div style={{ padding: '0 20px 20px', marginBottom: 12, borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>
            <div style={{ position: 'relative', display: 'inline-block', marginBottom: 12 }}>
              {localPhotoUrl ? (
                <img
                  src={localPhotoUrl}
                  alt={greetingName}
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: '50%',
                    objectFit: 'cover',
                    border: `2px solid ${domain.primaryColor}33`,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: '50%',
                    background: `linear-gradient(135deg, ${domain.primaryColor}33, ${domain.secondaryColor}33)`,
                    color: domain.primaryColor,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 24,
                    fontWeight: 700,
                    fontFamily: fontJakarta,
                    margin: '0 auto',
                  }}
                >
                  {initials}
                </div>
              )}
              <div
                className="pulse-dot"
                style={{
                  position: 'absolute',
                  bottom: 2,
                  right: 2,
                  width: 12,
                  height: 12,
                  background: isVerified ? '#22c55e' : '#eab308',
                  border: '2px solid #fff',
                }}
                aria-hidden
              />
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                marginBottom: 4,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', fontFamily: fontJakarta }}>
                {fullName}
              </div>
              {isVerified && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="12" cy="12" r="10" fill={domain.primaryColor} />
                  <path d="M8 12l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <button
              type="button"
              onClick={() => setAvatarModalOpen(true)}
              style={{
                background: 'transparent',
                border: 'none',
                padding: 0,
                marginTop: 8,
                fontSize: 12,
                color: domain.primaryColor,
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontWeight: 500,
              }}
            >
              {localPhotoUrl ? t('sidebar.edit_photo') : t('sidebar.add_photo')}
            </button>
          </div>

          {/* MAIN section */}
          <div
            style={{
              fontSize: 11,
              color: '#94a3b8',
              padding: '6px 20px',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              fontWeight: 700,
            }}
          >
            {t('sidebar.sections.main')}
          </div>
          <div className="nav-item nav-item-active">{t('sidebar.nav.dashboard')}</div>
          <Link
            href="/dashboard/cdi/mon-profil"
            className="nav-item"
            style={{ animationDelay: '0.05s' }}
          >
            {t('sidebar.nav.profile')}
          </Link>
          <div
            className={`nav-item ${isVerified ? '' : 'nav-item-locked'}`}
            style={{ animationDelay: '0.1s' }}
          >
            <span>{t('sidebar.nav.applications')}</span>
            {!isVerified && <span aria-hidden>🔒</span>}
          </div>
          <div
            className={`nav-item ${isVerified ? '' : 'nav-item-locked'}`}
            style={{ animationDelay: '0.15s' }}
          >
            <span>{t('sidebar.nav.alerts')}</span>
            {!isVerified && <span aria-hidden>🔒</span>}
          </div>
          <div
            className={`nav-item ${isVerified ? '' : 'nav-item-locked'}`}
            style={{ animationDelay: '0.2s' }}
          >
            <span>{t('sidebar.nav.messages')}</span>
            {!isVerified && <span aria-hidden>🔒</span>}
          </div>

          {/* ACCOUNT section */}
          <div
            style={{
              fontSize: 11,
              color: '#94a3b8',
              padding: '14px 20px 6px',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              fontWeight: 700,
            }}
          >
            {t('sidebar.sections.account')}
          </div>
          <div className="nav-item" style={{ animationDelay: '0.25s' }}>
            {t('sidebar.nav.settings')}
          </div>

          <div style={{ marginTop: 'auto', padding: '16px 8px 0', borderTop: '1px solid #e2e8f0' }}>
            <button
              type="button"
              onClick={handleLogout}
              className="nav-item"
              style={{
                width: 'calc(100% - 16px)',
                background: 'transparent',
                border: 'none',
                color: '#ef4444',
                fontFamily: 'inherit',
                textAlign: 'left',
              }}
            >
              {t('sidebar.nav.logout')}
            </button>
          </div>
        </aside>

        {/* MAIN */}
        <main className="dashboard-main" style={{ flex: 1, padding: 28, overflow: 'hidden' }}>

          {error && (
            <div
              role="alert"
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 12,
                padding: '12px 16px',
                marginBottom: 16,
                color: '#991b1b',
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              {error}
            </div>
          )}

          {/* SECTION 1 — Hello + verified badge inline + Score IA */}
          <div
            className="greeting-row"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              marginBottom: 22,
              gap: 16,
              animation: 'fadeInUp 0.4s ease',
            }}
          >
            <div>
              <h1
                style={{
                  fontSize: 26,
                  fontWeight: 800,
                  color: '#0f172a',
                  letterSpacing: '-0.4px',
                  fontFamily: fontJakarta,
                  marginBottom: 8,
                }}
              >
                {t('hello', { firstName: greetingName })}
              </h1>

              {/* Verified badge inline (parité freelance) */}
              {isVerified && (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    marginRight: 8,
                    animation: 'fadeIn 0.6s ease 0.3s both',
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <circle cx="12" cy="12" r="10" fill={domain.primaryColor} />
                    <path
                      d="M8 12l3 3 5-5"
                      stroke="white"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span
                    style={{ fontSize: 13, color: domain.primaryColor, fontWeight: 500 }}
                  >
                    {t('verified_badge')}
                  </span>
                </div>
              )}

              {/* Status écoute marché badge (existant) */}
              {currentStatus && statusBadgeColor && (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    background: `${statusBadgeColor}15`,
                    border: `1px solid ${statusBadgeColor}55`,
                    padding: '4px 10px',
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 600,
                    color: statusBadgeColor,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: statusBadgeColor,
                    }}
                    aria-hidden
                  />
                  <span>{tProfile(`status_badges.${currentStatus}`)}</span>
                </div>
              )}
            </div>

            {/* Score IA box (parité freelance) */}
            <div className="score-box">
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
                {t('ai_score.label')}
              </div>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  color: domain.primaryColor,
                  fontFamily: fontJakarta,
                }}
              >
                —
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>
                {t('ai_score.empty')}
              </div>
            </div>
          </div>

          {/* Bandeau de vérification jaune si !isVerified (parité freelance) */}
          {!isVerified && (
            <div
              style={{
                background: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: 12,
                padding: 20,
                marginBottom: 20,
                animation: 'fadeInUp 0.4s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div style={{ fontSize: 22, flexShrink: 0 }} aria-hidden>
                  ⏳
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: '#92400e',
                      marginBottom: 6,
                      fontFamily: fontJakarta,
                    }}
                  >
                    {t('verification_banner.title')}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: '#92400e',
                      opacity: 0.8,
                      lineHeight: 1.7,
                      marginBottom: 12,
                    }}
                  >
                    {t.rich('verification_banner.description', {
                      strong: chunks => <strong>{chunks}</strong>,
                    })}
                  </div>
                  <div
                    className="verif-steps"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    {[
                      {
                        label: t('verification_banner.steps.account_created'),
                        done: true,
                        active: false,
                      },
                      {
                        label: t('verification_banner.steps.ai_analysis'),
                        done: false,
                        active: true,
                      },
                      {
                        label: t('verification_banner.steps.verified_badge'),
                        done: false,
                        active: false,
                      },
                    ].map((step, i) => (
                      <div
                        key={step.label}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                      >
                        {i > 0 && (
                          <span style={{ color: '#d1d5db', fontSize: 13 }}>→</span>
                        )}
                        <span
                          style={{
                            fontSize: 13,
                            color: step.active
                              ? domain.primaryColor
                              : step.done
                                ? '#92400e'
                                : '#9ca3af',
                            fontWeight: step.active ? 500 : 400,
                          }}
                        >
                          {step.done ? '✓ ' : step.active ? '⏳ ' : '🔒 '}
                          {step.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => router.push('/dashboard/cdi/profil/valider')}
                style={{
                  marginTop: 14,
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '9px 16px',
                  borderRadius: 8,
                  background: '#fff',
                  border: '1px solid #fde68a',
                  color: '#92400e',
                  cursor: 'pointer',
                  width: '100%',
                  fontFamily: 'inherit',
                }}
              >
                {t('verification_banner.cta')}
              </button>
            </div>
          )}

          {/* SECTION 2 — Hero "Statut écoute marché" */}
          <div className="main-card" style={{ animationDelay: '0.05s' }}>
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: '#0f172a',
                  letterSpacing: '-0.2px',
                  fontFamily: fontJakarta,
                  marginBottom: 6,
                }}
              >
                {t('market_status_card.title')}
              </div>
              <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.55 }}>
                {t('market_status_card.description')}
              </div>
            </div>
            <CdiStatusToggle
              value={currentStatus}
              onChange={handleStatusChange}
              disabled={statusUpdating || !profile}
            />
          </div>

          {/* SECTION 3 — KPIs */}
          <div
            className="stats-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 14,
              marginBottom: 16,
            }}
          >
            <KpiCard
              label={t('kpis.profile_views')}
              value={isVerified ? '0' : '—'}
              delay="0.1s"
              isPlaceholder={!isVerified}
            />
            <KpiCard
              label={t('kpis.recruiter_contacts')}
              value={isVerified ? '0' : '—'}
              delay="0.15s"
              isPlaceholder={!isVerified}
            />
            <KpiCard
              label={t('kpis.applications_sent')}
              value={apps.loading ? '…' : String(apps.count)}
              delay="0.2s"
              accentColor={domain.primaryColor}
            />
          </div>

          {/* SECTION 6 — Profil X% complet */}
          <div className="main-card" style={{ animationDelay: '0.25s', borderColor: `${domain.primaryColor}55` }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: '#0f172a',
                  fontFamily: fontJakarta,
                }}
              >
                {t('profile_completion.title', { percent: completionPercent })}
              </div>
              <Link
                href="/dashboard/cdi/mon-profil"
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: domain.primaryColor,
                  textDecoration: 'none',
                }}
              >
                {t('profile_completion.cta')}
              </Link>
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  background: `linear-gradient(90deg, ${domain.primaryColor}, ${domain.secondaryColor})`,
                  width: `${completionPercent}%`,
                }}
              />
            </div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 10, lineHeight: 1.55 }}>
              {t('profile_completion.hint')}
            </div>
          </div>

          {/* SECTION 4 — Mes candidatures */}
          <div className="main-card" style={{ animationDelay: '0.3s' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 14,
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: '#0f172a',
                  letterSpacing: '-0.2px',
                  fontFamily: fontJakarta,
                }}
              >
                {t('applications_section.title')}
              </div>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: domain.primaryColor,
                  cursor: 'not-allowed',
                  opacity: 0.6,
                }}
                title="V1 — placeholder"
              >
                {t('applications_section.view_opportunities_cta')}
              </span>
            </div>
            {apps.loading ? (
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: 20,
                  textAlign: 'center',
                  fontSize: 14,
                  color: '#94a3b8',
                }}
              >
                {t('loading')}
              </div>
            ) : apps.count === 0 ? (
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px dashed #cbd5e1',
                  borderRadius: 10,
                  padding: 22,
                  textAlign: 'center',
                  fontSize: 14,
                  color: '#64748b',
                  lineHeight: 1.6,
                }}
              >
                {t('applications_section.empty_state')}
              </div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {apps.items.slice(0, 5).map(item => (
                  <li
                    key={item.id}
                    style={{
                      border: '1px solid #f1f5f9',
                      borderRadius: 10,
                      padding: '10px 14px',
                      background: '#fafafa',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <div style={{ fontSize: 13, color: '#475569' }}>
                      {item.created_at?.substring(0, 10) ?? '—'}
                    </div>
                    {item.status && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: domain.primaryColor,
                          background: `${domain.primaryColor}14`,
                          padding: '3px 10px',
                          borderRadius: 999,
                        }}
                      >
                        {item.status}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* SECTION 5 — Suggestions */}
          <div className="main-card" style={{ animationDelay: '0.35s', marginBottom: 0 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: '#0f172a',
                letterSpacing: '-0.2px',
                fontFamily: fontJakarta,
                marginBottom: 14,
              }}
            >
              {t('suggestions_section.title')}
            </div>
            <div
              style={{
                background: '#f8fafc',
                border: '1px dashed #cbd5e1',
                borderRadius: 10,
                padding: 22,
                textAlign: 'center',
                fontSize: 14,
                color: '#64748b',
                lineHeight: 1.6,
              }}
            >
              {t('suggestions_section.coming_soon')}
            </div>
          </div>
        </main>
      </div>

      {/* Avatar upload modal — réutilise le composant freelance.
          NOTE: AvatarUploadModal utilise en interne useTranslations
          ('dashboard_freelance.avatar_modal') — cross-namespace accepté
          pour V1. À factoriser au merge V1+V3 (namespace en prop). */}
      <AvatarUploadModal
        open={avatarModalOpen}
        currentPhotoUrl={localPhotoUrl}
        onClose={() => setAvatarModalOpen(false)}
        onSaved={newUrl => {
          setLocalPhotoUrl(newUrl)
          setToast({ type: 'success', text: t('toast.photo_updated') })
        }}
      />

      {/* TOAST top-right */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: 76,
            right: 24,
            zIndex: 1001,
            background: toast.type === 'success' ? '#dcfce7' : '#fef2f2',
            border: `1px solid ${toast.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
            color: toast.type === 'success' ? '#15803d' : '#991b1b',
            padding: '12px 18px',
            borderRadius: 12,
            fontSize: 14,
            fontWeight: 600,
            boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            animation: 'fadeInUp 0.3s ease',
          }}
        >
          <span aria-hidden>{toast.type === 'success' ? '✓' : '⚠'}</span>
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  )
}

// =========================================================================
// KPI Card
// =========================================================================
function KpiCard({
  label,
  value,
  delay,
  isPlaceholder = false,
  accentColor,
}: {
  label: string
  value: string
  delay: string
  isPlaceholder?: boolean
  accentColor?: string
}) {
  return (
    <div className="stat-card" style={{ animationDelay: delay }}>
      <div
        style={{
          fontSize: 12,
          color: '#64748b',
          fontWeight: 600,
          marginBottom: 8,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 800,
          color: isPlaceholder ? '#cbd5e1' : (accentColor ?? '#0f172a'),
          fontFamily: fontJakarta,
          letterSpacing: '-0.5px',
        }}
      >
        {value}
      </div>
    </div>
  )
}
