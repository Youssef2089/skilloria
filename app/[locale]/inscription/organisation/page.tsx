'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import PhoneTakenNotice from '@/components/auth/PhoneTakenNotice'
import PhoneOtpField, { type PhoneOtpLabels } from '@/components/PhoneOtpField'
import { normalizeE164 } from '@/lib/phone'
import { LEGAL_PATHS } from '@/lib/legal'
import { lienAideOtp } from '@/lib/otp/lien-aide'

type FormState = {
  first_name: string
  last_name: string
  email: string
  phone: string
  password: string
  company_name: string
  cgu: boolean
}

const initialForm: FormState = {
  first_name: '',
  last_name: '',
  email: '',
  // VIDE, plus `'+33'`. L'utilisateur ne compose plus d'indicatif : il choisit
  // un pays et tape son numéro national.
  phone: '',
  password: '',
  company_name: '',
  cgu: false,
}

export default function InscriptionOrganisationPage() {
  const router = useRouter()
  const domain = useDomain()
  const locale = useLocale()
  const t = useTranslations('inscription_org')

  const [form, setForm] = useState<FormState>(initialForm)
  const [showPassword, setShowPassword] = useState(false)

  // Le parcours OTP vit dans `PhoneOtpField` : il ne reste ici que ce dont le
  // FORMULAIRE a besoin — le jeton (requis au submit) et le refus D6.
  const [otpToken, setOtpToken] = useState<string | null>(null)
  // D6 — numéro déjà rattaché à un compte (refus avant envoi SMS).
  const [phoneTaken, setPhoneTaken] = useState(false)

  const otpLabels: PhoneOtpLabels = {
    phone_label: t('phone_label'),
    pays_label: t('otp_pays_label'),
    send_sms_button: t('send_sms_button'),
    resend_sms_label: (seconds: number) => t('resend_sms_label', { seconds }),
    code_label: t('code_label'),
    code_invalid: t('code_invalid'),
    phone_verified: t('phone_verified'),
    demande_transmise: t('otp_demande_transmise'),
    invalid_phone: t('errors.invalid_phone'),
    rate_limited: t('errors.rate_limited'),
    vonage_error: t('errors.vonage_error'),
    pays_non_pris_en_charge: t('errors.sms_pays_non_pris_en_charge'),
    verification_en_cours: t('errors.verification_en_cours'),
    pas_recu: t('otp_pas_recu'),
    edit_number: t('otp_edit_number'),
  }

  // Submit state
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [redirectAfterSuccess, setRedirectAfterSuccess] = useState(false)

  // Le compte à rebours a suivi le parcours OTP dans `PhoneOtpField` : c'est
  // lui qui sait quand une demande a été transmise, donc lui seul peut le
  // décompter honnêtement.

  // Redirect after success (useEffect — pas de router.push pendant render)
  useEffect(() => {
    if (redirectAfterSuccess) {
      router.push('/inscription/organisation/confirmation')
    }
  }, [redirectAfterSuccess, router])

  const phoneVerified = otpToken !== null

  const isEmailValid = useMemo(
    () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email),
    [form.email],
  )
  // LA REGEX LAXISTE A DISPARU. `/^\+[1-9]\d{6,14}$/` laissait passer un numéro
  // structurellement E.164 mais NON ATTRIBUABLE (`+3312345678`) : le bouton
  // s'activait, le serveur refusait, et l'écran affichait « Service SMS
  // indisponible » pour une simple faute de saisie.
  //
  // `PhoneOtpField` avait corrigé ce point dans le parcours EXPERT, et le
  // correctif n'avait jamais été rétroporté ici — six mois. On passe maintenant
  // par la MÊME source que le serveur, `lib/phone`, et il n'y a plus qu'un
  // seul endroit où cette règle peut se tromper.
  const isPhoneValid = useMemo(
    () => normalizeE164(form.phone) !== null,
    [form.phone],
  )
  const isPasswordValid = form.password.length >= 8
  const allFieldsFilled =
    form.first_name.trim().length > 0 &&
    form.last_name.trim().length > 0 &&
    form.email.trim().length > 0 &&
    form.phone.trim().length > 0 &&
    form.password.length > 0 &&
    form.company_name.trim().length > 0

  const submitDisabled =
    submitting ||
    !phoneVerified ||
    !form.cgu ||
    !allFieldsFilled ||
    !isEmailValid ||
    !isPhoneValid ||
    !isPasswordValid

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((prev) => ({ ...prev, [k]: v }))
  }

  // ── LE PARCOURS OTP VIT DANS `PhoneOtpField` ─────────────────────────────
  //
  //  handleSendSms, verifyOtp, handleEditPhone, handleOtpChange,
  //  handleOtpKeyDown et leur état ont été SUPPRIMÉS : c’étaient les jumeaux
  //  de ceux du composant, à quelques divergences près — et ces divergences
  //  étaient le défaut. Ici, seul `rate_limited` était distingué : un numéro
  //  simplement mal saisi s’affichait « Service SMS indisponible », alors même
  //  que la clé `errors.invalid_phone` existait déjà dans les quatre langues.

  // ── Submit ───────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)

    if (!allFieldsFilled) {
      setSubmitError(t('errors.missing_fields'))
      return
    }
    if (!isEmailValid) {
      setSubmitError(t('errors.invalid_email'))
      return
    }
    if (!isPhoneValid) {
      setSubmitError(t('errors.invalid_phone'))
      return
    }
    if (!isPasswordValid) {
      setSubmitError(t('errors.password_too_short'))
      return
    }
    if (!form.cgu) {
      setSubmitError(t('errors.cgu_required'))
      return
    }
    if (!phoneVerified || !otpToken) {
      setSubmitError(t('errors.phone_not_verified'))
      return
    }

    setSubmitting(true)
    try {
      // URL absolue vers /[locale]/auth/callback — Supabase l'inclura dans
      // le lien de confirmation email pour ramener l'user sur cette page
      // après validation (B3.3.fix2). `window` dispo car 'use client'.
      const emailRedirectTo = `${window.location.origin}/${locale}/auth/callback`
      const res = await fetch('/api/auth/register-org', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          country_code: 'FR',
          company_name: form.company_name.trim(),
          email: form.email.trim().toLowerCase(),
          password: form.password,
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          phone: form.phone,
          phone_otp_token: otpToken,
          domain_slug: domain.subdomain,
          org_type: 'client',
          email_redirect_to: emailRedirectTo,
          // Acceptation des CGU — transmise pour preuve serveur (point C).
          cgu_accepted: form.cgu,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { code?: string; error?: string }
      if (!res.ok) {
        const c = json.code
        if (c === 'email_domain_blocked') setSubmitError(t('errors.email_domain_blocked'))
        else if (c === 'cgu_required') setSubmitError(t('errors.cgu_required'))
        else if (c === 'email_domain_taken') setSubmitError(t('errors.email_domain_taken'))
        else if (c === 'phone_otp_required') setSubmitError(t('errors.phone_not_verified'))
        else if (c === 'invalid_email') setSubmitError(t('errors.invalid_email'))
        else if (c === 'invalid_phone') setSubmitError(t('errors.invalid_phone'))
        else if (c === 'invalid_password') setSubmitError(t('errors.password_too_short'))
        else if (c === 'create_user_failed' && (json.error ?? '').toLowerCase().includes('already')) {
          setSubmitError(t('errors.email_taken'))
        } else {
          setSubmitError(t('errors.generic'))
        }
        return
      }
      setRedirectAfterSuccess(true)
    } catch {
      setSubmitError(t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Styles ───────────────────────────────────────────────────────────────
  const inputBase: React.CSSProperties = {
    width: '100%',
    padding: '11px 14px',
    fontSize: 14,
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    outline: 'none',
    fontFamily: 'inherit',
    background: '#fff',
    color: '#0f172a',
    boxSizing: 'border-box',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#334155',
    marginBottom: 6,
  }

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '.08em',
    color: '#64748b',
    marginBottom: 12,
  }

  const sectionStyle: React.CSSProperties = {
    marginBottom: 24,
  }

  const sectionPhoneStyle: React.CSSProperties = {
    ...sectionStyle,
    background: '#f1f5f9',
    padding: '20px',
    borderRadius: 12,
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '24px 16px 48px',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      {/* Logo + LanguageSwitcher */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginBottom: 24,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 9,
              background: domain.primaryColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2L12 22M2 12L22 12M5 5L19 19M19 5L5 19"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <span style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>
            {domain.name}
          </span>
        </div>
        <LanguageSwitcher />
      </div>

      {/* Card form */}
      <form
        onSubmit={handleSubmit}
        style={{
          width: '100%',
          maxWidth: 520,
          background: '#fff',
          borderRadius: 16,
          padding: '32px 28px',
          boxShadow: '0 1px 3px rgba(15,23,42,.08), 0 8px 32px rgba(15,23,42,.04)',
        }}
      >
        <h1
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: '#0f172a',
            marginBottom: 6,
            textAlign: 'center',
          }}
        >
          {t('title')}
        </h1>
        <p
          style={{
            fontSize: 13,
            color: '#64748b',
            textAlign: 'center',
            marginBottom: 28,
          }}
        >
          {t('subtitle_already_account')}{' '}
          <span
            onClick={() => router.push('/connexion')}
            style={{
              color: domain.primaryColor,
              fontWeight: 600,
              cursor: 'pointer',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
            }}
          >
            {t('sign_in')}
          </span>
        </p>

        {submitError && (
          <div
            role="alert"
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#b91c1c',
              padding: '10px 14px',
              borderRadius: 8,
              fontSize: 13,
              marginBottom: 20,
            }}
          >
            {submitError}
          </div>
        )}

        {/* SECTION 1 — Identité */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>{t('section_identity')}</div>

          <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label htmlFor="first_name" style={labelStyle}>
                {t('firstname_label')} *
              </label>
              <input
                id="first_name"
                type="text"
                value={form.first_name}
                onChange={(e) => setField('first_name', e.target.value)}
                placeholder={t('firstname_placeholder')}
                style={inputBase}
                required
              />
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label htmlFor="last_name" style={labelStyle}>
                {t('lastname_label')} *
              </label>
              <input
                id="last_name"
                type="text"
                value={form.last_name}
                onChange={(e) => setField('last_name', e.target.value)}
                placeholder={t('lastname_placeholder')}
                style={inputBase}
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="email" style={labelStyle}>
              {t('email_label')} *
            </label>
            <input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => setField('email', e.target.value)}
              placeholder={t('email_placeholder')}
              style={inputBase}
              required
            />
          </div>
        </div>

        {/* SECTION 2 — Vérification téléphone */}
        {/*
          ≈170 LIGNES RECOPIÉES ONT DISPARU ICI, et ce n’est pas une
          économie de place : c’est la fermeture d’un défaut.

          Ce bloc était le jumeau de `PhoneOtpField`, avec sa propre
          validation et sa propre table d’erreurs. `PhoneOtpField` avait
          corrigé une regex laxiste qui laissait passer un numéro
          structurellement E.164 mais non attribuable, pour que le serveur le
          refuse ensuite sous un « Service SMS indisponible » mensonger — le
          correctif n’a jamais été rétroporté ICI, et la regex y vivait encore
          six mois plus tard.

          Un correctif appliqué à un parcours et pas à son jumeau se lit comme
          corrigé alors qu’il est vivant. La seule forme qui l’empêche est
          celle-ci : un seul composant, trois usages.
        */}
        <div style={sectionPhoneStyle}>
          <div style={sectionTitleStyle}>{t('section_phone')}</div>

          <PhoneOtpField
            phone={form.phone}
            onPhoneChange={(v) => {
              setField('phone', v)
              if (otpToken) setOtpToken(null)
              if (phoneTaken) setPhoneTaken(false)
            }}
            onVerified={(token) => setOtpToken(token)}
            verified={phoneVerified}
            primaryColor={domain.primaryColor}
            labels={otpLabels}
            onPhoneTaken={() => setPhoneTaken(true)}
            onEdit={() => { setOtpToken(null); setPhoneTaken(false) }}
            lienAide={(ph, iso) => lienAideOtp(locale, ph, iso)}
          />

          {phoneTaken && (
            <PhoneTakenNotice
              primaryColor={domain.primaryColor}
              onUseAnotherNumber={() => { setField('phone', ''); setOtpToken(null); setPhoneTaken(false) }}
            />
          )}
        </div>

        {/* SECTION 3 — Compte */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>{t('section_account')}</div>

          <div style={{ marginBottom: 14 }}>
            <label htmlFor="password" style={labelStyle}>
              {t('password_label')} *
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => setField('password', e.target.value)}
                placeholder={t('password_placeholder')}
                style={{ ...inputBase, paddingRight: 44 }}
                required
                minLength={8}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 16,
                  padding: 6,
                  color: '#64748b',
                  lineHeight: 1,
                }}
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="company_name" style={labelStyle}>
              {t('company_label')} *
            </label>
            <input
              id="company_name"
              type="text"
              value={form.company_name}
              onChange={(e) => setField('company_name', e.target.value)}
              placeholder={t('company_placeholder')}
              style={inputBase}
              required
            />
          </div>
        </div>

        {/* CGU + CTA */}
        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            fontSize: 13,
            color: '#475569',
            marginBottom: 20,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={form.cgu}
            onChange={(e) => setField('cgu', e.target.checked)}
            style={{ marginTop: 2, cursor: 'pointer' }}
          />
          <span>
            {t.rich('cgu_text', {
              link: (chunks) => (
                <a
                  href={`/${locale}${LEGAL_PATHS.cgu}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: domain.primaryColor, textDecoration: 'underline' }}
                >
                  {chunks}
                </a>
              ),
            })}{' '}
            *
          </span>
        </label>

        <button
          type="submit"
          disabled={submitDisabled}
          style={{
            width: '100%',
            padding: '14px',
            fontSize: 15,
            fontWeight: 700,
            color: '#fff',
            background: submitDisabled ? '#94a3b8' : domain.primaryColor,
            border: 'none',
            borderRadius: 10,
            cursor: submitDisabled ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
            transition: 'background .2s',
          }}
        >
          {submitting ? t('submitting') : t('submit_button')}
        </button>
      </form>
    </div>
  )
}
