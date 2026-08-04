'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import PhoneOtpField, { type PhoneOtpLabels } from '@/components/PhoneOtpField'
import { LEGAL_PATHS } from '@/lib/legal'

type RoleKey = 'expert' | 'cdi'

type FieldDef = {
  id: string
  label: string
  type: string
  placeholder: string
}

// D5/D6 : taxonomie structurée (branche → spécialité) + option « Autre ».
type TaxBranch = { id: string; slug: string; name: string }
type TaxSpeciality = { id: string; slug: string; name: string; branch_id: string }
const SPECIALITY_OTHER = '__other__'

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

  // D5/D6 : sélection structurée branche → spécialité (remplace le champ libre
  // « spécialité »), alimentée par /api/taxonomy (domain_id résolu côté serveur
  // depuis x-subdomain). L'option « Autre » ouvre un champ de précision libre.
  const [branches, setBranches] = useState<TaxBranch[]>([])
  const [specialities, setSpecialities] = useState<TaxSpeciality[]>([])
  const [branchId, setBranchId] = useState('')
  const [specialityId, setSpecialityId] = useState('')
  const [specialityOther, setSpecialityOther] = useState('')

  useEffect(() => {
    let active = true
    fetch(`/api/taxonomy?locale=${encodeURIComponent(locale)}`)
      .then(r => (r.ok ? r.json() : { branches: [], specialities: [] }))
      .then((d: { branches?: TaxBranch[]; specialities?: TaxSpeciality[] }) => {
        if (!active) return
        setBranches(d.branches ?? [])
        setSpecialities(d.specialities ?? [])
      })
      .catch(() => {})
    return () => { active = false }
  }, [locale])

  const filteredSpecialities = branchId
    ? specialities.filter(s => s.branch_id === branchId)
    : []

  function onBranchChange(value: string) {
    setBranchId(value)
    setSpecialityId('')
    setSpecialityOther('')
  }

  function onSpecialityChange(value: string) {
    setSpecialityId(value)
    if (value !== SPECIALITY_OTHER) setSpecialityOther('')
  }

  // Téléphone + OTP obligatoire (D1) — le token HMAC prouve la vérification.
  const [phone, setPhone] = useState('+33')
  const [otpToken, setOtpToken] = useState<string | null>(null)
  const phoneVerified = otpToken !== null

  // Libellés OTP tirés du namespace signup_form (copiés d'inscription_org).
  const otpLabels: PhoneOtpLabels = {
    phone_label: t('fields.phone_label'),
    phone_placeholder: t('fields.phone_placeholder'),
    send_sms_button: t('otp.send_sms_button'),
    resend_sms_label: (seconds: number) => t('otp.resend_sms_label', { seconds }),
    code_label: t('otp.code_label'),
    code_invalid: t('otp.code_invalid'),
    phone_verified: t('otp.phone_verified'),
    invalid_phone: t('errors.invalid_phone'),
    rate_limited: t('errors.rate_limited'),
    vonage_error: t('errors.vonage_error'),
  }

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
    // OTP obligatoire (D1) : sans token vérifié, on ne crée pas le compte.
    if (!phoneVerified || !otpToken) {
      setError(t('errors.phone_not_verified'))
      return
    }
    // D5/D6 : spécialité structurée obligatoire (alimente le matching). « Autre »
    // impose une précision libre, sinon la saisie devient un trou noir.
    if (!branchId) {
      setError(t('errors.branch_required'))
      return
    }
    if (!specialityId) {
      setError(t('errors.speciality_required'))
      return
    }
    if (specialityId === SPECIALITY_OTHER && !specialityOther.trim()) {
      setError(t('errors.speciality_other_required'))
      return
    }

    setLoading(true)
    setError('')

    try {
      // URL absolue vers /[locale]/auth/callback (anti-désorientation post-confirm).
      const emailRedirectTo = `${window.location.origin}/${locale}/auth/callback`
      const res = await fetch('/api/auth/public/register-expert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          firstname: form.firstname || '',
          lastname: form.lastname || '',
          email: form.email.trim().toLowerCase(),
          password: form.password,
          // D5/D6 : spécialité structurée + précision libre « Autre ».
          branch_id: branchId,
          speciality_id: specialityId === SPECIALITY_OTHER ? '' : specialityId,
          speciality_other: specialityId === SPECIALITY_OTHER ? specialityOther.trim() : '',
          role, // 'expert' | 'cdi'
          domain_slug: domain.subdomain,
          phone,
          phone_otp_token: otpToken,
          email_redirect_to: emailRedirectTo,
          // Acceptation des CGU — transmise pour preuve serveur (point C). La
          // garde client ci-dessus (`if (!cgu)`) ne suffit pas juridiquement :
          // le serveur re-vérifie et horodate.
          cgu_accepted: cgu,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { code?: string; error?: string }
      if (!res.ok) {
        const c = json.code
        if (c === 'phone_already_used') setError(t('errors.phone_already_used'))
        else if (c === 'cgu_required') setError(t('errors.cgu_required'))
        else if (c === 'email_taken') setError(t('errors.email_taken'))
        else if (c === 'phone_otp_required') {
          // Le jeton HMAC (TTL 15 min) a expiré pendant le remplissage :
          // on réinitialise la vérif et on invite l'utilisateur à recommencer.
          setOtpToken(null)
          setError(t('errors.otp_expired'))
        } else if (c === 'invalid_phone') setError(t('errors.invalid_phone'))
        else if (c === 'invalid_password') setError(t('errors.password_too_short'))
        else if (c === 'invalid_branch' || c === 'invalid_speciality') setError(t('errors.taxonomy_invalid'))
        else setError(t('errors.generic'))
        return
      }
      router.push('/inscription/confirmation')
    } catch {
      setError(t('errors.generic'))
    } finally {
      setLoading(false)
    }
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

          {/* D5/D6 : Branche → Spécialité (cascade) + option « Autre ». Libellés
              génériques (aucun nom d'écosystème en dur). Couvre expert ET cdi. */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
              {t('fields.branch_label')}
            </label>
            <select
              value={branchId}
              onChange={e => onBranchChange(e.target.value)}
              style={{
                width: '100%', padding: '10px 14px',
                border: '1.5px solid #e2e8f0', borderRadius: 10,
                fontSize: 14, color: branchId ? '#0f172a' : '#94a3b8',
                outline: 'none', background: '#fff', cursor: 'pointer',
              }}
            >
              <option value="">{t('fields.branch_placeholder')}</option>
              {branches.map(b => (
                <option key={b.id} value={b.id} style={{ color: '#0f172a' }}>{b.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
              {t('fields.speciality_label')}
            </label>
            <select
              value={specialityId}
              onChange={e => onSpecialityChange(e.target.value)}
              disabled={!branchId}
              style={{
                width: '100%', padding: '10px 14px',
                border: '1.5px solid #e2e8f0', borderRadius: 10,
                fontSize: 14, color: specialityId ? '#0f172a' : '#94a3b8',
                outline: 'none', background: branchId ? '#fff' : '#f1f5f9',
                cursor: branchId ? 'pointer' : 'not-allowed',
              }}
            >
              <option value="">{t('fields.speciality_placeholder')}</option>
              {filteredSpecialities.map(s => (
                <option key={s.id} value={s.id} style={{ color: '#0f172a' }}>{s.name}</option>
              ))}
              {branchId ? (
                <option value={SPECIALITY_OTHER} style={{ color: '#0f172a' }}>{t('fields.speciality_other_option')}</option>
              ) : null}
            </select>
          </div>

          {specialityId === SPECIALITY_OTHER && (
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                {t('fields.speciality_other_label')}
              </label>
              <input
                type="text"
                placeholder={t('fields.speciality_other_placeholder')}
                value={specialityOther}
                onChange={e => setSpecialityOther(e.target.value)}
                maxLength={100}
                style={{
                  width: '100%', padding: '10px 14px',
                  border: '1.5px solid #e2e8f0', borderRadius: 10,
                  fontSize: 14, color: '#0f172a', outline: 'none',
                }}
              />
            </div>
          )}

          {/* Téléphone + OTP obligatoire (D1) — même bloc que l'org. */}
          <PhoneOtpField
            phone={phone}
            onPhoneChange={(v) => {
              setPhone(v)
              // Éditer le numéro invalide la vérification précédente.
              if (otpToken) setOtpToken(null)
            }}
            onVerified={(token) => setOtpToken(token)}
            verified={phoneVerified}
            primaryColor={domain.primaryColor}
            labels={otpLabels}
          />
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
              // Vrais liens vers les pages légales, ouverts dans un NOUVEL ONGLET
              // (point B) : l'utilisateur ne perd pas le formulaire en cours.
              // Les pages sont créées dans un lot ultérieur — lien temporairement
              // 404 jusque-là, assumé.
              terms: (chunks) => (
                <a href={`/${locale}${LEGAL_PATHS.cgu}`} target="_blank" rel="noopener noreferrer" style={{ color: domain.primaryColor, textDecoration: 'underline', textUnderlineOffset: 2 }}>{chunks}</a>
              ),
              privacy: (chunks) => (
                <a href={`/${locale}${LEGAL_PATHS.confidentialite}`} target="_blank" rel="noopener noreferrer" style={{ color: domain.primaryColor, textDecoration: 'underline', textUnderlineOffset: 2 }}>{chunks}</a>
              ),
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
          disabled={loading || !phoneVerified}
          style={{
            width: '100%', padding: 13,
            background: loading || !phoneVerified ? '#94a3b8' : domain.primaryColor,
            color: '#fff', border: 'none',
            borderRadius: 12, fontSize: 15,
            fontWeight: 700, cursor: loading || !phoneVerified ? 'not-allowed' : 'pointer',
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
