'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { useDomain } from '@/context/DomainContext'
import LanguageSwitcher from '@/components/LanguageSwitcher'

type RoleKey = 'expert' | 'cdi'

type FieldDef = {
  id: string
  label: string
  type: string
  placeholder: string
}

export default function InscriptionRolePage() {
  const router = useRouter()
  const params = useParams()
  const domain = useDomain()
  const locale = useLocale()
  const t = useTranslations('signup_form')
  const role = params.role as string

  const isKnownRole = (r: string): r is RoleKey =>
    r === 'expert' || r === 'cdi'

  const [form, setForm] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cgu, setCgu] = useState(false)

  // Redirection des URLs invalides (ex: /inscription/cabinet, /inscription/entreprise)
  // déplacée dans useEffect pour ne pas appeler router.push() pendant le render
  // (évite le warning React "Cannot update a component while rendering").
  useEffect(() => {
    if (!isKnownRole(role)) {
      router.push('/inscription')
    }
  }, [role, router])

  if (!isKnownRole(role)) {
    return null
  }

  const config: Record<RoleKey, {
    title: string
    icon: string
    color: string
    fields: FieldDef[]
  }> = {
    expert: {
      title: t('roles.expert.form_title'),
      icon: '💼',
      color: '#ede9fe',
      fields: [
        { id: 'firstname', label: t('fields.firstname_label'), type: 'text', placeholder: t('fields.firstname_placeholder') },
        { id: 'lastname', label: t('fields.lastname_label'), type: 'text', placeholder: t('fields.lastname_placeholder') },
        { id: 'email', label: t('roles.expert.email_label'), type: 'email', placeholder: t('roles.expert.email_placeholder') },
        { id: 'specialty', label: t('roles.expert.specialty_label', { ecosystem: domain.ecosystemName }), type: 'text', placeholder: t('roles.expert.specialty_placeholder') },
        { id: 'password', label: t('fields.password_label'), type: 'password', placeholder: t('fields.password_placeholder') },
      ],
    },
    cdi: {
      title: t('roles.cdi.form_title'),
      icon: '🎓',
      color: '#dcfce7',
      fields: [
        { id: 'firstname', label: t('fields.firstname_label'), type: 'text', placeholder: t('fields.firstname_placeholder') },
        { id: 'lastname', label: t('fields.lastname_label'), type: 'text', placeholder: t('fields.lastname_placeholder') },
        { id: 'email', label: t('roles.cdi.email_label'), type: 'email', placeholder: t('roles.cdi.email_placeholder') },
        { id: 'specialty', label: t('roles.cdi.specialty_label', { ecosystem: domain.ecosystemName }), type: 'text', placeholder: t('roles.cdi.specialty_placeholder') },
        { id: 'password', label: t('fields.password_label'), type: 'password', placeholder: t('fields.password_placeholder') },
      ],
    },
  }

  const cfg = config[role]

  const handleSubmit = async () => {
    if (!cgu) {
      setError(t('errors.cgu_required'))
      return
    }
    if (!form.email || !form.password) {
      setError(t('errors.missing_fields'))
      return
    }
    if (form.password.length < 8) {
      setError(t('errors.password_too_short'))
      return
    }

    setLoading(true)
    setError('')

    const { error: authError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        // Renvoie l'user sur /auth/callback après confirm email pour
        // qu'il atterrisse directement sur son dashboard (B3.3.fix2)
        // au lieu de la home publique avec un token en hash URL.
        emailRedirectTo: `${window.location.origin}/${locale}/auth/callback`,
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
                {t('change_profile')}
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
            {t.rich('cgu', {
              terms: (chunks) => <span style={{ color: domain.primaryColor, cursor: 'pointer' }}>{chunks}</span>,
              privacy: (chunks) => <span style={{ color: domain.primaryColor, cursor: 'pointer' }}>{chunks}</span>,
            })}
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
          {loading ? t('submitting') : t('submit')}
        </button>

        {/* Déjà un compte */}
        <p style={{ textAlign: 'center', fontSize: 13, color: '#64748b', marginTop: 20 }}>
          {t('already_account')}{' '}
          <span onClick={() => router.push('/connexion')} style={{ color: domain.primaryColor, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>
            {t('sign_in')}
          </span>
        </p>

      </div>
    </div>
  )
}
