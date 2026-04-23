 'use client'

import { useRouter } from '@/i18n/navigation'

export default function ConfirmationPage() {
  const router = useRouter()

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f8fafc',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      fontFamily: 'Inter, sans-serif',
    }}>

      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 40 }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: '#0ea5e9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L12 22M2 12L22 12M5 5L19 19M19 5L5 19" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>
        <span style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>Skilloria 365</span>
      </div>

      {/* Card */}
      <div style={{
        background: '#fff',
        borderRadius: 24,
        border: '1px solid #e2e8f0',
        padding: '48px 40px',
        width: '100%',
        maxWidth: 480,
        boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
        textAlign: 'center',
      }}>

        {/* Icône succès */}
        <div style={{
          width: 72, height: 72,
          borderRadius: '50%',
          background: '#dcfce7',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 24px',
        }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
            <path d="M5 13l4 4L19 7" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', marginBottom: 12 }}>
          Compte créé avec succès !
        </h1>

        <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.7, marginBottom: 32 }}>
          Un email de confirmation a été envoyé à votre adresse.<br/>
          Cliquez sur le lien dans l'email pour activer votre compte et accéder à la plateforme.
        </p>

        {/* Info */}
        <div style={{
          background: '#f0f9ff',
          border: '1px solid #bae6fd',
          borderRadius: 12,
          padding: '14px 18px',
          marginBottom: 32,
          fontSize: 13,
          color: '#0369a1',
          textAlign: 'left',
          lineHeight: 1.6,
        }}>
          💡 Pensez à vérifier votre dossier <strong>spam</strong> si vous ne recevez pas l'email dans les 2 minutes.
        </div>

        {/* Bouton retour */}
        <button
          onClick={() => router.push('/')}
          style={{
            width: '100%',
            padding: 13,
            background: '#0ea5e9',
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Retour à l'accueil
        </button>

        <p style={{ fontSize: 13, color: '#64748b', marginTop: 16 }}>
          Déjà confirmé ?{' '}
          <span
            onClick={() => router.push('/connexion')}
            style={{ color: '#0ea5e9', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}
          >
            Se connecter
          </span>
        </p>

      </div>
    </div>
  )
}
