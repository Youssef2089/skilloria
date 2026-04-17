'use client'

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useDomain } from '@/context/DomainContext'

const config: Record<string, {
  title: string
  icon: string
  color: string
  fields: { id: string; label: string; type: string; placeholder: string }[]
}> = {
  entreprise: {
    title: 'Créer un compte Entreprise',
    icon: '🏢',
    color: '#dbeafe',
    fields: [
      { id: 'company', label: 'Raison sociale', type: 'text', placeholder: 'Nom de votre entreprise' },
      { id: 'firstname', label: 'Prénom', type: 'text', placeholder: 'Votre prénom' },
      { id: 'lastname', label: 'Nom', type: 'text', placeholder: 'Votre nom' },
      { id: 'email', label: 'Email professionnel', type: 'email', placeholder: 'vous@entreprise.com' },
      { id: 'password', label: 'Mot de passe', type: 'password', placeholder: 'Minimum 8 caractères' },
    ],
  },
  expert: {
    title: 'Créer un profil Expert',
    icon: '💼',
    color: '#ede9fe',
    fields: [
      { id: 'firstname', label: 'Prénom', type: 'text', placeholder: 'Votre prénom' },
      { id: 'lastname', label: 'Nom', type: 'text', placeholder: 'Votre nom' },
      { id: 'email', label: 'Email', type: 'email', placeholder: 'vous@email.com' },
      { id: 'specialty', label: 'Spécialité Microsoft principale', type: 'text', placeholder: 'Ex: Dynamics 365, Azure, Power BI...' },
      { id: 'password', label: 'Mot de passe', type: 'password', placeholder: 'Minimum 8 caractères' },
    ],
  },
  cdi: {
    title: 'Créer un profil CDI',
    icon: '🎓',
    color: '#dcfce7',
    fields: [
      { id: 'firstname', label: 'Prénom', type: 'text', placeholder: 'Votre prénom' },
      { id: 'lastname', label: 'Nom', type: 'text', placeholder: 'Votre nom' },
      { id: 'email', label: 'Email', type: 'email', placeholder: 'vous@email.com' },
      { id: 'specialty', label: 'Domaine Microsoft recherché', type: 'text', placeholder: 'Ex: Dynamics 365, Azure...' },
      { id: 'password', label: 'Mot de passe', type: 'password', placeholder: 'Minimum 8 caractères' },
    ],
  },
  cabinet: {
    title: 'Créer un compte Cabinet / ESN',
    icon: '🤝',
    color: '#fef9c3',
    fields: [
      { id: 'company', label: 'Nom du cabinet / ESN', type: 'text', placeholder: 'Nom de votre structure' },
      { id: 'firstname', label: 'Prénom', type: 'text', placeholder: 'Votre prénom' },
      { id: 'lastname', label: 'Nom', type: 'text', placeholder: 'Votre nom' },
      { id: 'email', label: 'Email professionnel', type: 'email', placeholder: 'vous@cabinet.com' },
      { id: 'password', label: 'Mot de passe', type: 'password', placeholder: 'Minimum 8 caractères' },
    ],
  },
}

export default function InscriptionRolePage() {
  const router = useRouter()
  const params = useParams()
  const domain = useDomain()
  const role = params.role as string
  const cfg = config[role]
  const [form, setForm] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cgu, setCgu] = useState(false)

  if (!cfg) {
    router.push('/inscription')
    return null
  }

  const handleSubmit = async () => {
    if (!cgu) {
      setError('Veuillez accepter les conditions d\'utilisation.')
      return
    }
    if (!form.email || !form.password) {
      setError('Email et mot de passe sont obligatoires.')
      return
    }
    if (form.password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères.')
      return
    }

    setLoading(true)
    setError('')

    const { error: authError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: {
          firstname: form.firstname || '',
          lastname: form.lastname || '',
          company: form.company || '',
          specialty: form.specialty || '',
          role: role,
          domain_slug: domain.subdomain,
        }
      }
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    setLoading(false)
    router.push('/inscription/confirmation')
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#f8fafc',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'flex-start',
      padding: '24px', fontFamily: 'Inter, sans-serif',
    }}>

      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 32 }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: domain.primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L12 22M2 12L22 12M5 5L19 19M19 5L5 19" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>
        <span style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{domain.name}</span>
      </div>

      {/* Card */}
      <div style={{
        background: '#fff', borderRadius: 24,
        border: '1px solid #e2e8f0', padding: '40px',
        width: '100%', maxWidth: 480,
        boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
      }}>

        {/* En-tête */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: cfg.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>
            {cfg.icon}
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{cfg.title}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              <span onClick={() => router.push('/inscription')} style={{ color: domain.primaryColor, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                ← Changer de profil
              </span>
            </div>
          </div>
        </div>

        {/* Champs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {cfg.fields.map((field) => (
            <div key={field.id}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                {field.label}
              </label>
              <input
                type={field.type}
                placeholder={field.placeholder}
                value={form[field.id] || ''}
                onChange={e => setForm({ ...form, [field.id]: e.target.value })}
                style={{
                  width: '100%', padding: '10px 14px',
                  border: '1.5px solid #e2e8f0', borderRadius: 10,
                  fontSize: 14, color: '#0f172a', outline: 'none',
                }}
              />
            </div>
          ))}
        </div>

        {/* CGU */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, margin: '20px 0' }}>
          <input
            type="checkbox"
            id="cgu"
            checked={cgu}
            onChange={e => setCgu(e.target.checked)}
            style={{ marginTop: 2, flexShrink: 0 }}
          />
          <label htmlFor="cgu" style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
            J'accepte les <span style={{ color: domain.primaryColor, cursor: 'pointer' }}>conditions d'utilisation</span> et la <span style={{ color: domain.primaryColor, cursor: 'pointer' }}>politique de confidentialité</span>
          </label>
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
          }}
        >
          {loading ? 'Création en cours...' : 'Créer mon compte →'}
        </button>

        {/* Déjà un compte */}
        <p style={{ textAlign: 'center', fontSize: 13, color: '#64748b', marginTop: 20 }}>
          Déjà un compte ?{' '}
          <span onClick={() => router.push('/connexion')} style={{ color: domain.primaryColor, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>
            Se connecter
          </span>
        </p>

      </div>
    </div>
  )
}