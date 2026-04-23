'use client'

import { useEffect, useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { useDomain } from '@/context/DomainContext'

export default function DashboardFreelance() {
  const router = useRouter()
  const domain = useDomain()
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const getUser = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/connexion')
        return
      }
      const { data } = await supabase
        .from('users')
        .select('*, domains(slug, name)')
        .eq('id', session.user.id)
        .single()
      setUser(data)
      setLoading(false)
    }
    getUser()
  }, [])

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', fontSize: 16, color: '#6b7280' }}>
      Chargement...
    </div>
  )

  const initials = user?.email?.substring(0, 2).toUpperCase() || '??'
  const isVerified = user?.is_verified === true
  const username = user?.email?.split('@')[0] || ''

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
        {isVerified ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#dcfce7', border: '1px solid #bbf7d0', padding: '7px 16px', borderRadius: 20 }}>
            <div className="pulse-dot" style={{ background: '#22c55e' }}></div>
            <span style={{ fontSize: 13, fontWeight: 500, color: '#15803d', whiteSpace: 'nowrap' }}>Disponible</span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fef9c3', border: '1px solid #fde68a', padding: '7px 16px', borderRadius: 20 }}>
            <div className="pulse-dot" style={{ background: '#eab308' }}></div>
            <span style={{ fontSize: 13, fontWeight: 500, color: '#92400e', whiteSpace: 'nowrap' }}>En attente de vérification</span>
          </div>
        )}
      </div>

      <div className="dashboard-layout" style={{ display: 'flex', minHeight: 'calc(100vh - 58px)' }}>

        {/* Sidebar */}
        <div className="dashboard-sidebar" style={{ width: 248, background: '#fff', borderRight: '1px solid #e5e7eb', padding: '22px 0', flexDirection: 'column', flexShrink: 0 }}>

          <div style={{ padding: '0 20px 20px', marginBottom: 14, borderBottom: '1px solid #e5e7eb', textAlign: 'center' }}>
            <div style={{ position: 'relative', display: 'inline-block', marginBottom: 14 }}>
              <div className="avatar" style={{ background: `linear-gradient(135deg, ${domain.primaryColor}44, ${domain.secondaryColor}44)`, color: domain.primaryColor }}>
                {initials}
              </div>
              <div className="pulse-dot" style={{ position: 'absolute', bottom: 3, right: 3, width: 14, height: 14, background: isVerified ? '#22c55e' : '#eab308', border: '2px solid #fff' }}></div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginBottom: 5 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>{username}</div>
              {isVerified && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" fill={domain.primaryColor}/>
                  <path d="M8 12l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>Freelance · {domain.ecosystemName}</div>
            <div style={{ fontSize: 12, color: domain.primaryColor, marginTop: 8, cursor: 'pointer' }}>
              {isVerified ? 'Modifier ma photo →' : 'Ajouter une photo →'}
            </div>
          </div>

          <div style={{ fontSize: 11, color: '#9ca3af', padding: '8px 20px 6px', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600 }}>Principal</div>
          <div className="nav-item-active">Tableau de bord</div>
          {[
            { label: 'Mon profil', locked: false },
            { label: 'Missions', locked: !isVerified },
            { label: 'Candidatures', locked: !isVerified },
            { label: 'Messages', locked: false },
          ].map((item, i) => (
            <div key={item.label} className="nav-item" style={{ animationDelay: `${(i + 1) * 0.05}s`, color: item.locked ? '#d1d5db' : '#4b5563', cursor: item.locked ? 'not-allowed' : 'pointer' }}>
              {item.label}
              {item.locked && <span style={{ fontSize: 12 }}>🔒</span>}
            </div>
          ))}

          <div style={{ fontSize: 11, color: '#9ca3af', padding: '16px 20px 6px', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600 }}>Publier</div>
          <div className="nav-item" style={{ color: isVerified ? domain.primaryColor : '#d1d5db', cursor: isVerified ? 'pointer' : 'not-allowed', animationDelay: '0.3s' }}>
            Lancer une alerte dispo {!isVerified && <span style={{ fontSize: 12 }}>🔒</span>}
          </div>
          <div className="nav-item" style={{ color: isVerified ? domain.primaryColor : '#d1d5db', cursor: isVerified ? 'pointer' : 'not-allowed', animationDelay: '0.35s' }}>
            Besoin / Sous-traitance {!isVerified && <span style={{ fontSize: 12 }}>🔒</span>}
          </div>

          <div style={{ fontSize: 11, color: '#9ca3af', padding: '16px 20px 6px', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600 }}>Compte</div>
          <div className="nav-item" style={{ animationDelay: '0.4s' }}>Paiements</div>
          <div className="nav-item" style={{ animationDelay: '0.45s' }}>Paramètres</div>

          <div style={{ marginTop: 'auto', padding: '16px 8px 0', borderTop: '1px solid #e5e7eb' }}>
            <div className="nav-item" style={{ color: '#ef4444' }} onClick={async () => { await supabase.auth.signOut(); router.push('/') }}>
              Déconnexion
            </div>
          </div>
        </div>

        {/* Main */}
        <div className="dashboard-main" style={{ flex: 1, padding: 30, overflow: 'hidden' }}>

          {/* Titre + Score IA */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 26, animation: 'fadeInUp 0.4s ease' }}>
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 700, color: '#111827', marginBottom: 8 }}>Bonjour 👋</h1>
              {isVerified && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, animation: 'fadeIn 0.6s ease 0.3s both' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" fill={domain.primaryColor}/>
                    <path d="M8 12l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span style={{ fontSize: 13, color: domain.primaryColor, fontWeight: 500 }}>Profil Vérifié</span>
                </div>
              )}
            </div>
            <div className="score-box">
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Score IA</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: domain.primaryColor }}>—</div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>à compléter</div>
            </div>
          </div>

          {/* Bannière vérification */}
          {!isVerified && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: 20, marginBottom: 20, animation: 'fadeInUp 0.4s ease' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div style={{ fontSize: 22, flexShrink: 0 }}>⏳</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#92400e', marginBottom: 6 }}>Profil en attente de vérification</div>
                  <div style={{ fontSize: 13, color: '#92400e', opacity: .8, lineHeight: 1.7, marginBottom: 12 }}>
                    Notre IA analyse votre profil. Une fois validé, vous obtiendrez le badge <strong>Profil Vérifié</strong> et pourrez apparaître dans le matching et publier.
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {[
                      { label: 'Compte créé', done: true },
                      { label: 'Analyse IA', active: true },
                      { label: 'Badge Vérifié', done: false },
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
                Compléter mon profil →
              </button>
            </div>
          )}

          {/* 4 stats */}
          <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 22 }}>
            {[
              { label: 'Missions dispo', value: isVerified ? '0' : '—', delay: '0.1s' },
              { label: 'Candidatures', value: isVerified ? '0' : '—', delay: '0.15s' },
              { label: 'Messages', value: '0', delay: '0.2s' },
            ].map((stat) => (
              <div key={stat.label} className="stat-card" style={{ background: '#f3f4f6', animationDelay: stat.delay }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>{stat.label}</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: isVerified ? '#111827' : '#d1d5db', animation: `countUp 0.5s ease ${stat.delay} both` }}>{stat.value}</div>
              </div>
            ))}
            <div className="stat-card" style={{ background: '#fff', border: `1px solid ${domain.primaryColor}55`, animationDelay: '0.25s' }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>Mon TJM</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: domain.primaryColor }}>— €</div>
              <div style={{ fontSize: 12, color: domain.primaryColor, cursor: 'pointer', marginTop: 6 }}>Définir →</div>
            </div>
          </div>

          {/* Complétion profil */}
          <div className="main-card" style={{ borderColor: `${domain.primaryColor}55`, animationDelay: '0.3s' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>Profil complété à 0%</div>
              <span className="voir-tout" style={{ color: domain.primaryColor }}>Compléter →</span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ background: `linear-gradient(90deg, ${domain.primaryColor}, ${domain.secondaryColor})`, width: '0%' }}></div>
            </div>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 10, lineHeight: 1.6 }}>Un profil complet génère 5x plus de propositions de missions.</div>
          </div>

          {/* Missions recommandées */}
          <div className="main-card" style={{ opacity: isVerified ? 1 : 0.6, animationDelay: '0.35s' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>Missions recommandées</span>
                <span style={{ background: '#ede9fe', color: '#6d28d9', fontSize: 12, fontWeight: 500, padding: '4px 12px', borderRadius: 20 }}>IA</span>
              </div>
              {!isVerified
                ? <span style={{ background: '#f3f4f6', color: '#9ca3af', fontSize: 12, padding: '4px 10px', borderRadius: 20 }}>🔒 Non vérifié</span>
                : <span className="voir-tout" style={{ color: domain.primaryColor }}>Voir tout →</span>
              }
            </div>
            <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 22, textAlign: 'center', fontSize: 14, color: '#9ca3af', lineHeight: 1.8 }}>
              {isVerified ? `Complétez votre profil pour que notre IA vous propose des missions adaptées à votre expertise ${domain.ecosystemName}.` : 'Disponible après validation de votre profil.'}
            </div>
          </div>

          {/* Collaboration experts */}
          <div className="main-card" style={{ opacity: isVerified ? 1 : 0.6, marginBottom: 0, animationDelay: '0.4s' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>Collaboration experts</span>
                <span style={{ background: '#dcfce7', color: '#15803d', fontSize: 12, fontWeight: 500, padding: '4px 12px', borderRadius: 20 }}>Nouveau</span>
              </div>
              {!isVerified
                ? <span style={{ background: '#f3f4f6', color: '#9ca3af', fontSize: 12, padding: '4px 10px', borderRadius: 20 }}>🔒 Non vérifié</span>
                : <span className="voir-tout" style={{ color: domain.primaryColor }}>Voir tout →</span>
              }
            </div>
            <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 22, textAlign: 'center', fontSize: 14, color: '#9ca3af', lineHeight: 1.8 }}>
              {isVerified ? "Aucune opportunité de collaboration disponible pour l'instant." : 'Disponible après validation de votre profil.'}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}