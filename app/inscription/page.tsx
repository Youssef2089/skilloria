'use client'

import { useRouter } from 'next/navigation'

const roles = [
  {
    id: 'entreprise',
    icon: '🏢',
    bg: '#dbeafe',
    title: 'Entreprise',
    desc: 'Je cherche un expert\nMicrosoft certifié',
  },
  {
    id: 'expert',
    icon: '💼',
    bg: '#ede9fe',
    title: 'Expert / Freelance',
    desc: 'Je propose mes services\net cherche des missions',
  },
  {
    id: 'cdi',
    icon: '🎓',
    bg: '#dcfce7',
    title: 'CDI',
    desc: 'Je cherche un poste\nen CDI Microsoft',
  },
  {
    id: 'cabinet',
    icon: '🤝',
    bg: '#fef9c3',
    title: 'Cabinet / ESN',
    desc: 'Je recrute pour\nmes clients',
  },
]

export default function InscriptionPage() {
  const router = useRouter()

  return (
    <div style={{
      minHeight: '100vh', background: '#f8fafc',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'flex-start',
      padding: '24px 24px 48px', fontFamily: 'Inter, sans-serif',
    }}>

      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: '#0ea5e9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L12 22M2 12L22 12M5 5L19 19M19 5L5 19" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>
        <span style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>Skilloria 365</span>
      </div>

      {/* Titre */}
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ display: 'inline-block', background: '#0ea5e9', color: '#fff', fontSize: 16, fontWeight: 700, padding: '7px 20px', borderRadius: 100, marginBottom: 14, letterSpacing: '.05em' }}>
          BIENVENUE 👋
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', lineHeight: 1.2, marginBottom: 8 }}>
          Choisissez votre profil
        </h1>
        <p style={{ fontSize: 14, color: '#64748b' }}>
          On personnalise votre expérience.
        </p>
      </div>

      {/* Cards */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 32 }}>
        {roles.map((role) => (
          <div
            key={role.id}
            onClick={() => router.push(`/inscription/${role.id}`)}
            style={{
              background: '#fff', border: '2px solid #e2e8f0',
              borderRadius: 20, padding: '32px 24px',
              textAlign: 'center', cursor: 'pointer',
              flex: 1, minWidth: 180, maxWidth: 220,
              transition: 'all .2s',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget
              el.style.borderColor = '#0ea5e9'
              el.style.transform = 'translateY(-4px)'
              el.style.boxShadow = '0 12px 32px rgba(14,165,233,.15)'
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
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>
              {role.title}
            </div>
            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
              {role.desc}
            </div>
          </div>
        ))}
      </div>

      {/* Déjà un compte */}
      <p style={{ fontSize: 13, color: '#64748b' }}>
        Vous avez déjà un compte ?{' '}
        <span
          onClick={() => router.push('/connexion')}
          style={{ color: '#0ea5e9', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}
        >
          Se connecter
        </span>
      </p>

    </div>
  )
}