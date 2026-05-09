'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import LanguageSwitcher from '@/components/LanguageSwitcher'

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
  phone: '+33',
  password: '',
  company_name: '',
  cgu: false,
}

const COOLDOWN_SECONDS = 60
const OTP_LENGTH = 6

export default function InscriptionOrganisationPage() {
  const router = useRouter()
  const domain = useDomain()
  const t = useTranslations('inscription_org')

  const [form, setForm] = useState<FormState>(initialForm)
  const [showPassword, setShowPassword] = useState(false)

  // OTP state
  const [otpRequestId, setOtpRequestId] = useState<string | null>(null)
  const [otpToken, setOtpToken] = useState<string | null>(null)
  const [otpDigits, setOtpDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''))
  const [otpError, setOtpError] = useState<string | null>(null)
  const [otpSending, setOtpSending] = useState(false)
  const [otpVerifying, setOtpVerifying] = useState(false)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [cooldownLeft, setCooldownLeft] = useState(0)
  const otpInputRefs = useRef<Array<HTMLInputElement | null>>([])

  // Submit state
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [redirectAfterSuccess, setRedirectAfterSuccess] = useState(false)

  // Cooldown ticker
  useEffect(() => {
    if (cooldownLeft <= 0) return
    const id = setInterval(() => setCooldownLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [cooldownLeft])

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
  const isPhoneValid = useMemo(
    () => /^\+[1-9]\d{6,14}$/.test(form.phone),
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

  // ── Send SMS ─────────────────────────────────────────────────────────────
  async function handleSendSms() {
    setPhoneError(null)
    setOtpError(null)
    if (!isPhoneValid) {
      setPhoneError(t('errors.invalid_phone'))
      return
    }
    setOtpSending(true)
    try {
      const res = await fetch('/api/auth/public/send-phone-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: form.phone }),
      })
      const json = (await res.json().catch(() => ({}))) as { request_id?: string; code?: string }
      if (!res.ok || !json.request_id) {
        setPhoneError(t('errors.vonage_error'))
        return
      }
      setOtpRequestId(json.request_id)
      setOtpDigits(Array(OTP_LENGTH).fill(''))
      setCooldownLeft(COOLDOWN_SECONDS)
      // focus first OTP input
      setTimeout(() => otpInputRefs.current[0]?.focus(), 50)
    } catch {
      setPhoneError(t('errors.vonage_error'))
    } finally {
      setOtpSending(false)
    }
  }

  // ── Verify OTP ───────────────────────────────────────────────────────────
  async function verifyOtp(code: string) {
    if (!otpRequestId) return
    setOtpVerifying(true)
    setOtpError(null)
    try {
      const res = await fetch('/api/auth/public/verify-phone-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request_id: otpRequestId,
          code,
          phone: form.phone,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        phone_verified?: boolean
        phone_otp_token?: string
        code?: string
      }
      if (!res.ok || !json.phone_verified || !json.phone_otp_token) {
        setOtpError(t('code_invalid'))
        setOtpDigits(Array(OTP_LENGTH).fill(''))
        setTimeout(() => otpInputRefs.current[0]?.focus(), 50)
        return
      }
      setOtpToken(json.phone_otp_token)
    } catch {
      setOtpError(t('code_invalid'))
      setOtpDigits(Array(OTP_LENGTH).fill(''))
    } finally {
      setOtpVerifying(false)
    }
  }

  // OTP digit change
  function handleOtpChange(idx: number, raw: string) {
    const cleaned = raw.replace(/\D/g, '')
    if (cleaned.length === 0) {
      const next = [...otpDigits]
      next[idx] = ''
      setOtpDigits(next)
      return
    }
    // Paste full code (multiple digits)
    if (cleaned.length > 1) {
      const chars = cleaned.slice(0, OTP_LENGTH).split('')
      const next = Array(OTP_LENGTH).fill('')
      chars.forEach((c, i) => {
        next[i] = c
      })
      setOtpDigits(next)
      const lastIdx = Math.min(chars.length, OTP_LENGTH) - 1
      otpInputRefs.current[lastIdx]?.focus()
      if (chars.length === OTP_LENGTH) {
        void verifyOtp(chars.join(''))
      }
      return
    }
    const next = [...otpDigits]
    next[idx] = cleaned[0]
    setOtpDigits(next)
    if (idx < OTP_LENGTH - 1) {
      otpInputRefs.current[idx + 1]?.focus()
    }
    if (next.every((d) => d.length === 1)) {
      void verifyOtp(next.join(''))
    }
  }

  function handleOtpKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && otpDigits[idx] === '' && idx > 0) {
      otpInputRefs.current[idx - 1]?.focus()
    }
  }

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
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { code?: string; error?: string }
      if (!res.ok) {
        const c = json.code
        if (c === 'email_domain_blocked') setSubmitError(t('errors.email_domain_blocked'))
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
        <div style={sectionPhoneStyle}>
          <div style={sectionTitleStyle}>{t('section_phone')}</div>

          <label htmlFor="phone" style={labelStyle}>
            {t('phone_label')} *
          </label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <div
              style={{
                position: 'relative',
                flex: 1,
                minWidth: 200,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  left: 12,
                  fontSize: 16,
                  pointerEvents: 'none',
                }}
              >
                🇫🇷
              </span>
              <input
                id="phone"
                type="tel"
                value={form.phone}
                onChange={(e) => {
                  setField('phone', e.target.value)
                  if (phoneError) setPhoneError(null)
                }}
                placeholder={t('phone_placeholder')}
                style={{
                  ...inputBase,
                  paddingLeft: 38,
                  background: phoneVerified ? '#f1f5f9' : '#fff',
                  borderColor: phoneVerified ? '#22c55e' : '#cbd5e1',
                }}
                readOnly={phoneVerified}
                required
              />
              {phoneVerified && (
                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    right: 12,
                    color: '#22c55e',
                    fontSize: 18,
                    fontWeight: 700,
                  }}
                >
                  ✓
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={handleSendSms}
              disabled={otpSending || cooldownLeft > 0 || phoneVerified || !isPhoneValid}
              style={{
                padding: '11px 16px',
                fontSize: 13,
                fontWeight: 600,
                color: '#fff',
                background:
                  otpSending || cooldownLeft > 0 || phoneVerified || !isPhoneValid
                    ? '#94a3b8'
                    : domain.primaryColor,
                border: 'none',
                borderRadius: 8,
                cursor:
                  otpSending || cooldownLeft > 0 || phoneVerified || !isPhoneValid
                    ? 'not-allowed'
                    : 'pointer',
                whiteSpace: 'nowrap',
                fontFamily: 'inherit',
              }}
            >
              {cooldownLeft > 0
                ? t('resend_sms_label', { seconds: cooldownLeft })
                : t('send_sms_button')}
            </button>
          </div>

          {phoneError && (
            <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 8 }}>
              {phoneError}
            </div>
          )}

          {phoneVerified && (
            <div
              style={{
                fontSize: 13,
                color: '#15803d',
                fontWeight: 600,
                marginTop: 4,
              }}
            >
              ✓ {t('phone_verified')}
            </div>
          )}

          {otpRequestId && !phoneVerified && (
            <div style={{ marginTop: 12 }}>
              <label style={labelStyle}>{t('code_label')}</label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                {Array.from({ length: OTP_LENGTH }).map((_, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      otpInputRefs.current[i] = el
                    }}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={i === 0 ? OTP_LENGTH : 1}
                    value={otpDigits[i]}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    disabled={otpVerifying}
                    aria-label={`Code digit ${i + 1}`}
                    style={{
                      width: 42,
                      height: 50,
                      textAlign: 'center',
                      fontSize: 18,
                      fontWeight: 700,
                      border: `1px solid ${otpError ? '#dc2626' : '#cbd5e1'}`,
                      borderRadius: 8,
                      outline: 'none',
                      background: '#fff',
                      color: '#0f172a',
                      boxSizing: 'border-box',
                    }}
                  />
                ))}
              </div>
              {otpError && (
                <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 8 }}>
                  {otpError}
                </div>
              )}
            </div>
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
                  href="/cgu"
                  target="_blank"
                  rel="noreferrer"
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
