'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { useDomain } from '@/context/DomainContext'
import { useSecureLogout } from '@/lib/secure-fetch'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import TJMQuickEditModal from '@/components/TJMQuickEditModal'
import AvatarUploadModal from '@/components/AvatarUploadModal'

type ProfileData = { tjm_min: number | null; tjm_max: number | null; photo_url: string | null }

export default function DashboardFreelance() {
  const t = useTranslations('dashboard_freelance')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const domain = useDomain()
  const secureLogout = useSecureLogout()
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tjmModalOpen, setTjmModalOpen] = useState(false)
  const [avatarModalOpen, setAvatarModalOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    const getUser = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/connexion')
        return
      }
      const [{ data: userData }, { data: profileData }] = await Promise.all([
        supabase
          .from('users')
          .select('*, domains(slug, name)')
          .eq('id', session.user.id)
          .single(),
        supabase
          .from('profiles')
          .select('tjm_min, tjm_max, photo_url')
          .eq('user_id', session.user.id)
          .maybeSingle(),
      ])
      setUser(userData)
      setProfile(profileData ?? { tjm_min: null, tjm_max: null, photo_url: null })
      setLoading(false)
    }
    getUser()
  }, [])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(id)
  }, [toast])

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', fontSize: 16, color: '#6b7280' }}>
      {t('loading')}
    </div>
  )

  const isVerified = user?.is_verified === true
  const firstName = (user?.first_name ?? '').trim()
  const lastName = (user?.last_name ?? '').trim()
  const fullName = `${firstName} ${lastName}`.trim() || tCommon('user_fallback')
  const initials =
    ((firstName[0] ?? '') + (lastName[0] ?? '')).toUpperCase() ||
    fullName.substring(0, 2).toUpperCase() ||
    '??'

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', fontFamily: 'Inter, sans-serif' }}>

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.95); }
        }
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-16px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes countUp {
          from { opacity: 0; transform: scale(0.7); }
          to { opacity: 1; transform: scale(1); }
        }
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
          transition: background 0.18s, transform 0.18s;
          animation: slideInLeft 0.35s ease both;
        }
        .nav-item:hover { background: #f9fafb; transform: translateX(4px); }
        .nav-item-active {
          padding: 11px 16px;
          font-size: 14px;
          color: #111827;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-radius: 8px;
          margin: 2px 8px;
          background: #f3f4f6;
          font-weight: 500;
          animation: slideInLeft 0.35s ease both;
        }
        .stat-card {
          border-radius: 12px;
          padding: 20px 22px;
          transition: transform 0.22s, box-shadow 0.22s;
          animation: fadeInUp 0.5s ease both;
          cursor: default;
        }
        .stat-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 8px 24px rgba(0,0,0,0.09);
        }
        .main-card {
          background: #fff;
          border-radius: 14px;
          border: 1px solid #e5e7eb;
          padding: 22px 26px;
          margin-bottom: 18px;
          animation: fadeInUp 0.5s ease both;
          transition: box-shadow 0.2s;
        }
        .main-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
        .voir-tout {
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: transform 0.18s, opacity 0.18s;
          display: inline-block;
          text-decoration: none;
        }
        .voir-tout:hover { transform: translateX(4px); opacity: 0.75; }
        .pulse-dot {
          width: 8px; height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
          animation: pulse 2s ease-in-out infinite;
        }
        .avatar {
          width: 76px; height: 76px;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 26px; font-weight: 600;
          margin: 0 auto;
          transition: transform 0.3s;
          animation: fadeIn 0.5s ease;
        }
        .avatar:hover { transform: scale(1.06); }
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
        .progress-bar { height: 7px; background: #f3f4f6; border-radius: 10px; overflow: hidden; }
        .progress-fill {
          height: 100%;
          border-radius: 10px;
          transition: width 1.2s ease;
        }
        @media (max-width: 767px) {
          .dashboard-layout { flex-direction: column !important; }
          .dashboard-sidebar { display: none !important; }
          .dashboard-main { padding: 20px !important; }
          .stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (min-width: 768px) {
          .dashboard-layout { flex-direction: row !important; }
          .dashboard-sidebar { display: flex !important; }
        }
      `}</style>

      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0 28px', height: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between', animation: 'fadeIn 0.3s ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: domain.primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {domain.logoUrl ? (
              <img src={domain.logoUrl} alt={domain.name} width={18} height={18} />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2L12 22M2 12L22 12M5 5L19 19M19 5L5 19" stroke="white" strokeWidth="2.5" strokeLinecap="round"/></svg>
            )}
          </div>
          <span style={{ fontSize: 17, fontWeight: 700, color: '#111827' }}>{domain.name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <LanguageSwitcher />
          {isVerified ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#dcfce7', border: '1px solid #bbf7d0', padding: '7px 16px', borderRadius: 20 }}>
              <div className="pulse-dot" style={{ background: '#22c55e' }}></div>
              <span style={{ fontSize: 13, fontWeight: 500, color: '#15803d', whiteSpace: 'nowrap' }}>{t('topbar.available')}</span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fef9c3', border: '1px solid #fde68a', padding: '7px 16px', borderRadius: 20 }}>
              <div className="pulse-dot" style={{ background: '#eab308' }}></div>
              <span style={{ fontSize: 13, fontWeight: 500, color: '#92400e', whiteSpace: 'nowrap' }}>{t('topbar.pending')}</span>
            </div>
          )}
        </div>
      </div>

      <div className="dashboard-layout" style={{ display: 'flex', minHeight: 'calc(100vh - 58px)' }}>

        {/* Sidebar */}
        <div className="dashboard-sidebar" style={{ width: 248, background: '#fff', borderRight: '1px solid #e5e7eb', padding: '22px 0', flexDirection: 'column', flexShrink: 0 }}>

          <div style={{ padding: '0 20px 20px', marginBottom: 14, borderBottom: '1px solid #e5e7eb', textAlign: 'center' }}>
            <div style={{ position: 'relative', display: 'inline-block', marginBottom: 14 }}>
              {profile?.photo_url ? (
                <img
                  src={profile.photo_url}
                  alt={fullName}
                  className="avatar"
                  style={{ objectFit: 'cover' }}
                />
              ) : (
                <div className="avatar" style={{ background: `linear-gradient(135deg, ${domain.primaryColor}44, ${domain.secondaryColor}44)`, color: domain.primaryColor }}>
                  {initials}
                </div>
              )}
              <div className="pulse-dot" style={{ position: 'absolute', bottom: 3, right: 3, width: 14, height: 14, background: isVerified ? '#22c55e' : '#eab308', border: '2px solid #fff' }}></div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginBottom: 5 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>{fullName}</div>
              {isVerified && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" fill={domain.primaryColor}/>
                  <path d="M8 12l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>{t('sidebar.role_freelance')} · {domain.ecosystemName}</div>
            <button
              type="button"
              onClick={() => setAvatarModalOpen(true)}
              style={{ background: 'transparent', border: 'none', padding: 0, fontSize: 12, color: domain.primaryColor, cursor: 'pointer', marginTop: 8, fontFamily: 'inherit', fontWeight: 500 }}
            >
              {profile?.photo_url ? t('sidebar.edit_photo') : t('sidebar.add_photo')}
            </button>
          </div>

          <div style={{ fontSize: 11, color: '#9ca3af', padding: '8px 20px 6px', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600 }}>{t('sidebar.sections.main')}</div>
          <div className="nav-item-active">{t('sidebar.nav.dashboard')}</div>
          {[
            { label: t('sidebar.nav.profile'), locked: false, href: '/dashboard/freelance/mon-profil' },
            { label: t('sidebar.nav.missions'), locked: false, href: '/dashboard/freelance/missions' },
            { label: t('sidebar.nav.applications'), locked: !isVerified, href: null },
            { label: t('sidebar.nav.messages'), locked: false, href: null },
          ].map((item, i) => {
            const sharedStyle: React.CSSProperties = {
              animationDelay: `${(i + 1) * 0.05}s`,
              color: item.locked ? '#d1d5db' : '#4b5563',
              cursor: item.locked ? 'not-allowed' : 'pointer',
              textDecoration: 'none',
            }
            if (item.href && !item.locked) {
              return (
                <Link key={item.label} href={item.href} className="nav-item" style={sharedStyle}>
                  {item.label}
                </Link>
              )
            }
            return (
              <div key={item.label} className="nav-item" style={sharedStyle}>
                {item.label}
                {item.locked && <span style={{ fontSize: 12 }}>🔒</span>}
              </div>
            )
          })}

          <div style={{ fontSize: 11, color: '#9ca3af', padding: '16px 20px 6px', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600 }}>{t('sidebar.sections.publish')}</div>
          <div className="nav-item" style={{ color: isVerified ? domain.primaryColor : '#d1d5db', cursor: isVerified ? 'pointer' : 'not-allowed', animationDelay: '0.3s' }}>
            {t('sidebar.nav.availability_alert')} {!isVerified && <span style={{ fontSize: 12 }}>🔒</span>}
          </div>
          <div className="nav-item" style={{ color: isVerified ? domain.primaryColor : '#d1d5db', cursor: isVerified ? 'pointer' : 'not-allowed', animationDelay: '0.35s' }}>
            {t('sidebar.nav.subcontracting')} {!isVerified && <span style={{ fontSize: 12 }}>🔒</span>}
          </div>

          <div style={{ fontSize: 11, color: '#9ca3af', padding: '16px 20px 6px', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600 }}>{t('sidebar.sections.account')}</div>
          <div className="nav-item" style={{ animationDelay: '0.4s' }}>{t('sidebar.nav.payments')}</div>
          <div className="nav-item" style={{ animationDelay: '0.45s' }}>{t('sidebar.nav.settings')}</div>

          <div style={{ marginTop: 'auto', padding: '16px 8px 0', borderTop: '1px solid #e5e7eb' }}>
            <div className="nav-item" style={{ color: '#ef4444' }} onClick={() => void secureLogout({ redirectTo: '/' })}>
              {t('sidebar.nav.logout')}
            </div>
          </div>
        </div>

        {/* Main */}
        <div className="dashboard-main" style={{ flex: 1, padding: 30, overflow: 'hidden' }}>

          {/* Titre + Score IA */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 26, animation: 'fadeInUp 0.4s ease' }}>
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 700, color: '#111827', marginBottom: 8 }}>{t('greeting')}</h1>
              {isVerified && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, animation: 'fadeIn 0.6s ease 0.3s both' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" fill={domain.primaryColor}/>
                    <path d="M8 12l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span style={{ fontSize: 13, color: domain.primaryColor, fontWeight: 500 }}>{t('verified_badge')}</span>
                </div>
              )}
            </div>
            <div className="score-box">
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>{t('ai_score.label')}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: domain.primaryColor }}>—</div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>{t('ai_score.empty')}</div>
            </div>
          </div>

          {/* Bannière vérification */}
          {!isVerified && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: 20, marginBottom: 20, animation: 'fadeInUp 0.4s ease' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div style={{ fontSize: 22, flexShrink: 0 }}>⏳</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#92400e', marginBottom: 6 }}>{t('verification_banner.title')}</div>
                  <div style={{ fontSize: 13, color: '#92400e', opacity: .8, lineHeight: 1.7, marginBottom: 12 }}>
                    {t.rich('verification_banner.description', {
                      strong: chunks => <strong>{chunks}</strong>,
                    })}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {[
                      { label: t('verification_banner.steps.account_created'), done: true },
                      { label: t('verification_banner.steps.ai_analysis'), active: true },
                      { label: t('verification_banner.steps.verified_badge'), done: false },
                    ].map((step, i) => (
                      <div key={step.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {i > 0 && <span style={{ color: '#d1d5db', fontSize: 13 }}>→</span>}
                        <span style={{ fontSize: 13, color: step.active ? domain.primaryColor : step.done ? '#92400e' : '#9ca3af', fontWeight: step.active ? 500 : 400 }}>
                          {step.done ? '✓ ' : step.active ? '⏳ ' : ''}{step.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <button onClick={() => router.push('/dashboard/freelance/profil')} style={{ marginTop: 14, fontSize: 13, fontWeight: 600, padding: '9px 16px', borderRadius: 8, background: '#fff', border: '1px solid #fde68a', color: '#92400e', cursor: 'pointer', width: '100%' }}>
                {t('verification_banner.cta')}
              </button>
            </div>
          )}

          {/* 4 stats */}
          <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 22 }}>
            {[
              { label: t('stats.available_missions'), value: isVerified ? '0' : '—', delay: '0.1s' },
              { label: t('stats.applications'), value: isVerified ? '0' : '—', delay: '0.15s' },
              { label: t('stats.messages'), value: '0', delay: '0.2s' },
            ].map((stat) => (
              <div key={stat.label} className="stat-card" style={{ background: '#f3f4f6', animationDelay: stat.delay }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>{stat.label}</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: isVerified ? '#111827' : '#d1d5db', animation: `countUp 0.5s ease ${stat.delay} both` }}>{stat.value}</div>
              </div>
            ))}
            <div className="stat-card" style={{ background: '#fff', border: `1px solid ${domain.primaryColor}55`, animationDelay: '0.25s' }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>{t('stats.daily_rate')}</div>
              <div style={{ fontSize: profile?.tjm_min != null && profile?.tjm_max != null ? 18 : 24, fontWeight: 700, color: domain.primaryColor }}>
                {profile?.tjm_min != null && profile?.tjm_max != null
                  ? t('stats.daily_rate_range', { min: profile.tjm_min, max: profile.tjm_max })
                  : '— €'}
              </div>
              <button
                type="button"
                onClick={() => setTjmModalOpen(true)}
                style={{ background: 'transparent', border: 'none', padding: 0, fontSize: 12, color: domain.primaryColor, cursor: 'pointer', marginTop: 6, fontFamily: 'inherit', fontWeight: 500 }}
              >
                {t('stats.daily_rate_set')}
              </button>
            </div>
          </div>

          {/* Complétion profil */}
          <div className="main-card" style={{ borderColor: `${domain.primaryColor}55`, animationDelay: '0.3s' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>{t('completion.title', { percent: 0 })}</div>
              <Link href="/dashboard/freelance/profil/valider" className="voir-tout" style={{ color: domain.primaryColor }}>{t('completion.cta')}</Link>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ background: `linear-gradient(90deg, ${domain.primaryColor}, ${domain.secondaryColor})`, width: '0%' }}></div>
            </div>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 10, lineHeight: 1.6 }}>{t('completion.hint')}</div>
          </div>

          {/* Missions recommandées */}
          <div className="main-card" style={{ opacity: isVerified ? 1 : 0.6, animationDelay: '0.35s' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>{t('cards.recommended_missions.title')}</span>
                <span style={{ background: '#ede9fe', color: '#6d28d9', fontSize: 12, fontWeight: 500, padding: '4px 12px', borderRadius: 20 }}>{t('cards.recommended_missions.ai_badge')}</span>
              </div>
              {!isVerified
                ? <span style={{ background: '#f3f4f6', color: '#9ca3af', fontSize: 12, padding: '4px 10px', borderRadius: 20 }}>{t('cards.locked_chip')}</span>
                : <span className="voir-tout" style={{ color: domain.primaryColor }}>{t('cards.see_all')}</span>
              }
            </div>
            <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 22, textAlign: 'center', fontSize: 14, color: '#9ca3af', lineHeight: 1.8 }}>
              {isVerified
                ? t('cards.recommended_missions.empty_verified', { ecosystem: domain.ecosystemName })
                : t('cards.empty_unverified')}
            </div>
          </div>

          {/* Collaboration experts */}
          <div className="main-card" style={{ opacity: isVerified ? 1 : 0.6, marginBottom: 0, animationDelay: '0.4s' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>{t('cards.expert_collaboration.title')}</span>
                <span style={{ background: '#dcfce7', color: '#15803d', fontSize: 12, fontWeight: 500, padding: '4px 12px', borderRadius: 20 }}>{t('cards.expert_collaboration.new_badge')}</span>
              </div>
              {!isVerified
                ? <span style={{ background: '#f3f4f6', color: '#9ca3af', fontSize: 12, padding: '4px 10px', borderRadius: 20 }}>{t('cards.locked_chip')}</span>
                : <span className="voir-tout" style={{ color: domain.primaryColor }}>{t('cards.see_all')}</span>
              }
            </div>
            <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 22, textAlign: 'center', fontSize: 14, color: '#9ca3af', lineHeight: 1.8 }}>
              {isVerified ? t('cards.expert_collaboration.empty_verified') : t('cards.empty_unverified')}
            </div>
          </div>

        </div>
      </div>

      <TJMQuickEditModal
        open={tjmModalOpen}
        initialMin={profile?.tjm_min ?? null}
        initialMax={profile?.tjm_max ?? null}
        onClose={() => setTjmModalOpen(false)}
        onSaved={(newMin, newMax) => {
          setProfile(prev => ({
            ...(prev ?? { tjm_min: null, tjm_max: null, photo_url: null }),
            tjm_min: newMin,
            tjm_max: newMax,
          }))
          setToast(t('tjm_modal.success'))
        }}
      />

      <AvatarUploadModal
        open={avatarModalOpen}
        currentPhotoUrl={profile?.photo_url ?? null}
        onClose={() => setAvatarModalOpen(false)}
        onSaved={newUrl => {
          setProfile(prev => ({
            ...(prev ?? { tjm_min: null, tjm_max: null, photo_url: null }),
            photo_url: newUrl,
          }))
          setToast(t('avatar_modal.success'))
        }}
      />

      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: 76,
            right: 24,
            zIndex: 1001,
            background: '#dcfce7',
            border: '1px solid #bbf7d0',
            color: '#15803d',
            padding: '12px 18px',
            borderRadius: 12,
            fontSize: 14,
            fontWeight: 600,
            boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
            animation: 'fadeInUp 0.3s ease',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>✓</span>
          <span>{toast}</span>
        </div>
      )}
    </div>
  )
}
