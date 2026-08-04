'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

/**
 * Formulaire de contact PUBLIC (D3).
 *
 * - Endpoint PUBLIC pré-auth : on utilise `fetch` nu (PAS useSecureFetch — il n'y
 *   a ni bearer ni session à injecter ici).
 * - Validation inline par champ + validation serveur (source de vérité). Le
 *   consentement RGPD est OBLIGATOIRE (case à cocher liée à la politique de
 *   confidentialité).
 * - États soignés : erreurs inline, bouton désactivé pendant l'envoi, état de
 *   succès et état d'erreur distincts (dont un message dédié au 429 rate_limited).
 */

type FieldName = 'firstName' | 'lastName' | 'email' | 'message'
type Values = {
  firstName: string
  lastName: string
  company: string
  email: string
  phone: string
  message: string
  consent: boolean
}
type Status = 'idle' | 'sending' | 'success' | 'error'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const EMPTY: Values = {
  firstName: '',
  lastName: '',
  company: '',
  email: '',
  phone: '',
  message: '',
  consent: false,
}

export default function ContactForm() {
  const t = useTranslations('contact')

  const [values, setValues] = useState<Values>(EMPTY)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName | 'consent', string>>>({})
  const [status, setStatus] = useState<Status>('idle')
  const [formError, setFormError] = useState<string | null>(null)

  function set<K extends keyof Values>(key: K, val: Values[K]) {
    setValues(prev => ({ ...prev, [key]: val }))
    // On efface l'erreur du champ dès que l'utilisateur le corrige.
    if (key in fieldErrors) {
      setFieldErrors(prev => {
        const next = { ...prev }
        delete next[key as FieldName | 'consent']
        return next
      })
    }
  }

  // Validation client (miroir léger de la validation serveur, qui reste la
  // source de vérité). Retourne la map d'erreurs (vide = valide).
  function validate(v: Values): Partial<Record<FieldName | 'consent', string>> {
    const errs: Partial<Record<FieldName | 'consent', string>> = {}
    if (!v.firstName.trim()) errs.firstName = t('err_firstname_required')
    if (!v.lastName.trim()) errs.lastName = t('err_lastname_required')
    if (!v.email.trim()) errs.email = t('err_email_required')
    else if (!EMAIL_RE.test(v.email.trim())) errs.email = t('err_email_invalid')
    if (!v.message.trim()) errs.message = t('err_message_required')
    if (!v.consent) errs.consent = t('err_consent_required')
    return errs
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    const errs = validate(values)
    setFieldErrors(errs)
    if (Object.keys(errs).length > 0) {
      // Focus du premier champ en erreur pour l'accessibilité.
      const first = document.querySelector<HTMLElement>('[aria-invalid="true"]')
      first?.focus()
      return
    }

    setStatus('sending')
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
          company: values.company.trim(),
          email: values.email.trim(),
          phone: values.phone.trim(),
          message: values.message.trim(),
          consent: values.consent,
        }),
      })
      const data = (await res.json().catch(() => null)) as
        | { ok?: true }
        | { error?: string; code?: string; field?: string }
        | null

      if (res.ok && data && 'ok' in data && data.ok) {
        setStatus('success')
        setValues(EMPTY)
        return
      }

      // Échec : on mappe le code serveur sur un message i18n.
      const code = data && 'code' in data ? data.code : undefined
      if (code === 'rate_limited') setFormError(t('error_rate_limited'))
      else if (code === 'validation') setFormError(t('error_validation'))
      else setFormError(t('error_generic'))
      setStatus('error')
    } catch {
      setFormError(t('error_generic'))
      setStatus('error')
    }
  }

  const sending = status === 'sending'

  // État de succès : on remplace le formulaire par une confirmation nette.
  if (status === 'success') {
    return (
      <div
        role="status"
        style={{
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: 12,
          padding: '20px 22px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span
            aria-hidden
            style={{
              width: 26, height: 26, borderRadius: '50%', background: '#16a34a',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M5 13l4 4L19 7" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#14532d' }}>{t('success_title')}</span>
        </div>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: '#166534', margin: '0 0 16px' }}>
          {t('success_body')}
        </p>
        <button
          type="button"
          onClick={() => setStatus('idle')}
          className="skc-btn-secondary"
          style={{
            appearance: 'none', background: '#fff', border: '1.5px solid #bbf7d0',
            borderRadius: 10, padding: '10px 16px', fontSize: 14, fontWeight: 600,
            color: '#166534', cursor: 'pointer',
          }}
        >
          {t('success_again')}
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Styles de focus/hover scopés (parité avec le reste du chrome public). */}
      <style>{`
        .skc-field { transition: border-color .15s ease, box-shadow .15s ease; }
        .skc-field:hover { border-color: #cbd5e1; }
        .skc-field:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.15); }
        .skc-field[aria-invalid="true"] { border-color: #dc2626; }
        .skc-field[aria-invalid="true"]:focus { box-shadow: 0 0 0 3px rgba(220,38,38,.15); }
        .skc-submit:not(:disabled):hover { filter: brightness(1.06); }
        .skc-submit:disabled { opacity: .6; cursor: not-allowed; }
      `}</style>

      {formError && (
        <div
          role="alert"
          style={{
            background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10,
            padding: '12px 16px', fontSize: 14, color: '#b91c1c', lineHeight: 1.5,
          }}
        >
          {formError}
        </div>
      )}

      {/* Prénom + Nom (2 colonnes sur desktop, empilées sur mobile via minmax). */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 18 }}>
        <TextField
          id="firstName"
          label={t('field_firstname')}
          required
          value={values.firstName}
          error={fieldErrors.firstName}
          autoComplete="given-name"
          onChange={v => set('firstName', v)}
        />
        <TextField
          id="lastName"
          label={t('field_lastname')}
          required
          value={values.lastName}
          error={fieldErrors.lastName}
          autoComplete="family-name"
          onChange={v => set('lastName', v)}
        />
      </div>

      <TextField
        id="company"
        label={t('field_company')}
        optionalLabel={t('optional')}
        value={values.company}
        autoComplete="organization"
        onChange={v => set('company', v)}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 18 }}>
        <TextField
          id="email"
          label={t('field_email')}
          required
          type="email"
          value={values.email}
          error={fieldErrors.email}
          autoComplete="email"
          onChange={v => set('email', v)}
        />
        <TextField
          id="phone"
          label={t('field_phone')}
          optionalLabel={t('optional')}
          type="tel"
          value={values.phone}
          autoComplete="tel"
          onChange={v => set('phone', v)}
        />
      </div>

      {/* Message (textarea). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label htmlFor="message" style={labelStyle}>
          {t('field_message')} <span aria-hidden style={requiredMark}>*</span>
        </label>
        <textarea
          id="message"
          className="skc-field"
          value={values.message}
          onChange={e => set('message', e.target.value)}
          rows={6}
          maxLength={5000}
          required
          aria-invalid={fieldErrors.message ? 'true' : undefined}
          aria-describedby={fieldErrors.message ? 'message-err' : undefined}
          style={{ ...inputStyle, resize: 'vertical', minHeight: 120, lineHeight: 1.6 }}
        />
        {fieldErrors.message && <FieldError id="message-err">{fieldErrors.message}</FieldError>}
      </div>

      {/* Consentement RGPD OBLIGATOIRE, avec lien vers la politique de confidentialité. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={values.consent}
            onChange={e => set('consent', e.target.checked)}
            required
            aria-invalid={fieldErrors.consent ? 'true' : undefined}
            aria-describedby={fieldErrors.consent ? 'consent-err' : undefined}
            style={{ width: 18, height: 18, marginTop: 2, accentColor: '#2563eb', flexShrink: 0, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 13.5, lineHeight: 1.55, color: '#475569' }}>
            {t.rich('consent_label', {
              link: chunks => (
                <Link
                  href="/politique-de-confidentialite"
                  style={{ color: '#2563eb', textDecoration: 'underline', textUnderlineOffset: 2 }}
                >
                  {chunks}
                </Link>
              ),
            })}
          </span>
        </label>
        {fieldErrors.consent && <FieldError id="consent-err">{fieldErrors.consent}</FieldError>}
      </div>

      <div>
        <button
          type="submit"
          className="skc-submit"
          disabled={sending}
          style={{
            appearance: 'none', border: 'none', borderRadius: 10,
            background: '#2563eb', color: '#fff', fontSize: 15, fontWeight: 700,
            padding: '13px 22px', cursor: 'pointer', minHeight: 48,
            display: 'inline-flex', alignItems: 'center', gap: 10,
            transition: 'filter .15s ease',
          }}
        >
          {sending && (
            <span
              aria-hidden
              style={{
                width: 16, height: 16, borderRadius: '50%',
                border: '2px solid rgba(255,255,255,.4)', borderTopColor: '#fff',
                display: 'inline-block', animation: 'skc-spin .7s linear infinite',
              }}
            />
          )}
          {sending ? t('submit_sending') : t('submit')}
        </button>
        <style>{`@keyframes skc-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </form>
  )
}

/* --- Styles partagés --- */
const labelStyle: React.CSSProperties = {
  fontSize: 13.5,
  fontWeight: 600,
  color: '#0f172a',
}
const requiredMark: React.CSSProperties = { color: '#dc2626', fontWeight: 700 }
const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1.5px solid #e2e8f0',
  borderRadius: 10,
  padding: '11px 14px',
  fontSize: 15,
  color: '#0f172a',
  background: '#fff',
  fontFamily: 'inherit',
}

/* --- Sous-composants --- */
function TextField({
  id,
  label,
  value,
  onChange,
  error,
  required,
  optionalLabel,
  type = 'text',
  autoComplete,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  error?: string
  required?: boolean
  optionalLabel?: string
  type?: string
  autoComplete?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor={id} style={labelStyle}>
        {label}{' '}
        {required
          ? <span aria-hidden style={requiredMark}>*</span>
          : optionalLabel
            ? <span style={{ color: '#94a3b8', fontWeight: 500 }}>{optionalLabel}</span>
            : null}
      </label>
      <input
        id={id}
        className="skc-field"
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        maxLength={200}
        autoComplete={autoComplete}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        style={inputStyle}
      />
      {error && <FieldError id={`${id}-err`}>{error}</FieldError>}
    </div>
  )
}

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <span id={id} role="alert" style={{ fontSize: 12.5, color: '#dc2626', lineHeight: 1.4 }}>
      {children}
    </span>
  )
}
