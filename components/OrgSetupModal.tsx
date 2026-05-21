'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch, useSecureLogout } from '@/lib/secure-fetch'

/**
 * Modale BLOQUANTE post-login pour finaliser l'inscription organisation (B3.4).
 *
 * Design lock-in :
 *   - Pas de croix de fermeture
 *   - ESC ne ferme pas (preventDefault sur keydown)
 *   - Click sur l'overlay ne ferme pas (clic capté mais pas de close)
 *   - Pas de bouton "Plus tard"
 *
 * Le seul moyen de fermer la modale = la soumettre OU se déconnecter.
 *
 * Submit :
 *   - Validation client AVANT serveur (UX rapide)
 *   - POST /api/auth/finalize-org-registration avec Bearer token
 *   - Loader pendant 3-10s (runVerification SYNCHRONE en V1)
 */

type Civility = 'mr' | 'mrs' | 'mx'
type OrgSubType = 'client' | 'esn' | 'cabinet'

type FormState = {
  civility: Civility | ''
  job_title: string
  linkedin_url: string
  siren: string
  org_sub_type: OrgSubType | ''
  website: string
}

const initialForm: FormState = {
  civility: '',
  job_title: '',
  linkedin_url: '',
  siren: '',
  org_sub_type: '',
  website: '',
}

function isValidUrl(s: string): boolean {
  if (!s || s.length > 500) return false
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function isValidLinkedinUrl(s: string): boolean {
  return isValidUrl(s) && /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\//i.test(s)
}

export default function OrgSetupModal({
  onComplete,
}: {
  onComplete: () => void
}) {
  const domain = useDomain()
  const secureFetch = useSecureFetch()
  const secureLogout = useSecureLogout()
  const t = useTranslations('inscription_org.modal_setup')

  const [form, setForm] = useState<FormState>(initialForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Bloquer le scroll du body + intercepter ESC tant que la modale est ouverte.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKeyDown, { capture: true } as EventListenerOptions)
    }
  }, [])

  // Side-effect onComplete (séparé pour éviter setState pendant render).
  useEffect(() => {
    if (success) onComplete()
  }, [success, onComplete])

  const sirenValid = /^\d{9}$/.test(form.siren.replace(/\s/g, ''))
  const jobTitleValid = form.job_title.trim().length >= 2
  const linkedinValid = !form.linkedin_url || isValidLinkedinUrl(form.linkedin_url)
  const websiteValid = !form.website || isValidUrl(form.website)

  const submitDisabled = useMemo(
    () =>
      submitting ||
      !form.civility ||
      !jobTitleValid ||
      !sirenValid ||
      !form.org_sub_type ||
      !linkedinValid ||
      !websiteValid,
    [submitting, form.civility, form.org_sub_type, jobTitleValid, sirenValid, linkedinValid, websiteValid],
  )

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((prev) => ({ ...prev, [k]: v }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!form.civility || !form.org_sub_type) {
      setError(t('errors.missing_fields'))
      return
    }
    if (!jobTitleValid) {
      setError(t('errors.missing_fields'))
      return
    }
    if (!sirenValid) {
      setError(t('errors.invalid_siren'))
      return
    }
    if (!linkedinValid) {
      setError(t('errors.invalid_linkedin'))
      return
    }
    if (!websiteValid) {
      setError(t('errors.invalid_website'))
      return
    }

    setSubmitting(true)
    try {
      const res = await secureFetch('/api/auth/finalize-org-registration', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          civility: form.civility,
          job_title: form.job_title.trim(),
          linkedin_url: form.linkedin_url.trim() || null,
          siren: form.siren.replace(/\s/g, ''),
          org_sub_type: form.org_sub_type,
          website: form.website.trim() || null,
        }),
      })
      const payload = (await res.json().catch(() => ({}))) as { code?: string }
      if (!res.ok) {
        const c = payload.code
        if (c === 'invalid_siren' || c === 'siren_taken') setError(t('errors.invalid_siren'))
        else if (c === 'invalid_linkedin') setError(t('errors.invalid_linkedin'))
        else if (c === 'invalid_website') setError(t('errors.invalid_website'))
        else setError(t('errors.generic'))
        return
      }
      setSuccess(true)
    } catch {
      setError(t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSignOut() {
    // secureLogout : POST /api/auth/logout (vide last_session_token + cookie)
    // PUIS supabase.auth.signOut() + router.push. Cf. lib/secure-fetch.ts.
    await secureLogout({ redirectTo: '/' })
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
  const sectionStyle: React.CSSProperties = { marginBottom: 24 }

  function radioStyle(active: boolean): React.CSSProperties {
    return {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '10px 14px',
      border: `1.5px solid ${active ? domain.primaryColor : '#cbd5e1'}`,
      borderRadius: 10,
      background: active ? `${domain.primaryColor}10` : '#fff',
      cursor: 'pointer',
      fontSize: 13,
      fontWeight: 600,
      color: active ? domain.primaryColor : '#475569',
      userSelect: 'none',
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="org-setup-modal-title"
      // Click outside ne ferme pas — pas de onClick handler ici.
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, .65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        zIndex: 9999,
        fontFamily: 'Inter, sans-serif',
        overflowY: 'auto',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: '#fff',
          borderRadius: 20,
          padding: '32px 28px',
          width: '100%',
          maxWidth: 560,
          boxShadow: '0 20px 50px rgba(0,0,0,.25)',
          marginTop: 'auto',
          marginBottom: 'auto',
        }}
      >
        <h2
          id="org-setup-modal-title"
          style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', marginBottom: 6 }}
        >
          {t('title')}
        </h2>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 24 }}>
          {t('subtitle')}
        </p>

        {error && (
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
            {error}
          </div>
        )}

        {/* Section personnel */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>{t('section_personal')}</div>

          <label style={labelStyle}>{t('civility_label')} *</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            {(['mr', 'mrs', 'mx'] as const).map((c) => (
              <label
                key={c}
                style={radioStyle(form.civility === c)}
              >
                <input
                  type="radio"
                  name="civility"
                  value={c}
                  checked={form.civility === c}
                  onChange={() => setField('civility', c)}
                  style={{ display: 'none' }}
                />
                {t(`civility_${c}`)}
              </label>
            ))}
          </div>

          <label htmlFor="job_title" style={labelStyle}>
            {t('job_title_label')} *
          </label>
          <input
            id="job_title"
            type="text"
            value={form.job_title}
            onChange={(e) => setField('job_title', e.target.value)}
            placeholder={t('job_title_placeholder')}
            style={{ ...inputBase, marginBottom: 14 }}
            required
            maxLength={200}
          />

          <label htmlFor="linkedin_url" style={labelStyle}>
            {t('linkedin_label')}
          </label>
          <input
            id="linkedin_url"
            type="url"
            value={form.linkedin_url}
            onChange={(e) => setField('linkedin_url', e.target.value)}
            placeholder={t('linkedin_placeholder')}
            style={inputBase}
          />
        </div>

        {/* Section entreprise */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>{t('section_company')}</div>

          <label htmlFor="siren" style={labelStyle}>
            {t('siren_label')} *
          </label>
          <input
            id="siren"
            type="text"
            inputMode="numeric"
            value={form.siren}
            onChange={(e) =>
              setField('siren', e.target.value.replace(/\D/g, '').slice(0, 9))
            }
            placeholder={t('siren_placeholder')}
            style={{ ...inputBase, marginBottom: 4 }}
            required
            maxLength={9}
          />
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 14 }}>
            {t('siren_hint')}
          </div>

          <label style={labelStyle}>{t('org_sub_type_label')} *</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            {(['client', 'esn', 'cabinet'] as const).map((s) => (
              <label
                key={s}
                style={radioStyle(form.org_sub_type === s)}
              >
                <input
                  type="radio"
                  name="org_sub_type"
                  value={s}
                  checked={form.org_sub_type === s}
                  onChange={() => setField('org_sub_type', s)}
                  style={{ display: 'none' }}
                />
                {t(`org_sub_type_${s}`)}
              </label>
            ))}
          </div>

          <label htmlFor="website" style={labelStyle}>
            {t('website_label')}
          </label>
          <input
            id="website"
            type="url"
            value={form.website}
            onChange={(e) => setField('website', e.target.value)}
            placeholder={t('website_placeholder')}
            style={inputBase}
          />
        </div>

        {/* CTA */}
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
            marginBottom: 14,
          }}
        >
          {submitting ? t('submitting') : t('submit_button')}
        </button>

        <p style={{ fontSize: 12, color: '#64748b', textAlign: 'center', marginBottom: 12 }}>
          {t('security_notice')}
        </p>

        <div style={{ textAlign: 'center' }}>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={submitting}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#64748b',
              fontSize: 12,
              fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
              fontFamily: 'inherit',
              padding: 4,
            }}
          >
            {t('sign_out')}
          </button>
        </div>
      </form>
    </div>
  )
}
