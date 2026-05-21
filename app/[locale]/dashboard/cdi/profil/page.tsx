'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { supabase } from '@/lib/supabase'
import { useSecureFetch } from '@/lib/secure-fetch'
import LanguageSwitcher from '@/components/LanguageSwitcher'

// =============================================================================
// Page d'entrée upload CV — variant CDI
// =============================================================================
// Mirror de /dashboard/freelance/profil/page.tsx adapté CDI :
//   - POST sur /api/profile/cdi-upload-cv (au lieu de /api/profile/upload-cv)
//   - Namespace i18n cdi_profile_upload (au lieu de profile_upload)
//   - Auth check + garde stricte user_type === 'expert_cdi' (403 sinon)
//   - Après parsing OK → router.push('/dashboard/cdi/profil/valider')
//
// TODO post-merge V1+V3 : factoriser avec /freelance/profil/page.tsx
// (95% du JSX est identique).
// =============================================================================

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error'

const MAX_SIZE = 5 * 1024 * 1024
const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 60_000

const LOCALE_DATE_MAP: Record<string, string> = {
  fr: 'fr-FR',
  en: 'en-GB',
  es: 'es-ES',
  de: 'de-DE',
}

export default function CdiProfilUploadPage() {
  const t = useTranslations('cdi_profile_upload')
  const locale = useLocale()
  const router = useRouter()
  const domain = useDomain()
  const secureFetch = useSecureFetch()


  const [authChecked, setAuthChecked] = useState(false)
  const [forbidden, setForbidden] = useState(false)
  const [consent, setConsent] = useState(false)
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  const cvInputRef = useRef<HTMLInputElement>(null)
  const liInputRef = useRef<HTMLInputElement>(null)

  const busy = status === 'uploading' || status === 'success'

  // ── Auth + role check sur mount ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (cancelled) return
      if (!session) {
        router.push('/connexion')
        return
      }
      const { data: userRow } = await supabase
        .from('users')
        .select('user_type')
        .eq('id', session.user.id)
        .maybeSingle()
      if (cancelled) return
      if ((userRow?.user_type as string | null) !== 'expert_cdi') {
        setForbidden(true)
      }
      setAuthChecked(true)
    }
    check()
    return () => {
      cancelled = true
    }
  }, [router])

  const requestFile = (ref: RefObject<HTMLInputElement | null>) => {
    setErrorMsg(null)
    if (!consent) {
      setErrorMsg(t('errors.consent_required'))
      return
    }
    ref.current?.click()
  }

  const pollStatus = async (
    jobId: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    const start = Date.now()
    while (Date.now() - start < POLL_TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
      const res = await secureFetch(`/api/profile/cv-status/${jobId}`, { method: 'GET' })
      const payload = await res.json().catch(() => ({} as any))
      if (payload?.status === 'done') return { ok: true }
      if (payload?.status === 'failed') {
        return { ok: false, error: payload?.error ?? t('errors.parsing_default') }
      }
    }
    return { ok: false, error: t('errors.timeout') }
  }

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (!consent) {
      setErrorMsg(t('errors.consent_required'))
      return
    }
    if (file.size > MAX_SIZE) {
      setErrorMsg(t('errors.file_too_large'))
      return
    }
    if (file.type !== 'application/pdf') {
      setErrorMsg(t('errors.invalid_format'))
      return
    }

    setStatus('uploading')
    setErrorMsg(null)
    setStatusMsg(null)

    try {
      const form = new FormData()
      form.append('file', file)
      form.append('consent', 'true')

      const res = await secureFetch('/api/profile/cdi-upload-cv', {
        method: 'POST',
        body: form,
      })
      const payload = await res.json().catch(() => ({} as any))

      if (!res.ok) {
        const code = payload?.code
        if (res.status === 503 && code === 'ai_disabled') {
          setErrorMsg(t('errors.ai_disabled'))
        } else if (res.status === 429) {
          const reset = payload?.reset_at
            ? new Date(payload.reset_at).toLocaleString(LOCALE_DATE_MAP[locale] ?? locale)
            : t('errors.rate_limit_later')
          setErrorMsg(t('errors.rate_limit', { reset }))
        } else if (code === 'file_too_large') {
          setErrorMsg(t('errors.file_too_large'))
        } else if (code === 'bad_mime') {
          setErrorMsg(t('errors.invalid_format'))
        } else if (code === 'consent_missing') {
          setErrorMsg(t('errors.consent_required'))
        } else {
          setErrorMsg(payload?.error || t('errors.generic'))
        }
        setStatus('error')
        return
      }

      if (payload?.status === 'failed') {
        setErrorMsg(
          t('errors.parsing_failed', {
            reason: payload.error ?? t('errors.unknown_reason'),
          }),
        )
        setStatus('error')
        return
      }

      if (payload?.status === 'processing' && payload?.jobId) {
        const poll = await pollStatus(payload.jobId)
        if (!poll.ok) {
          setErrorMsg(t('errors.parsing_failed', { reason: poll.error }))
          setStatus('error')
          return
        }
      } else if (payload?.status !== 'done') {
        setErrorMsg(t('errors.generic'))
        setStatus('error')
        return
      }

      setStatus('success')
      setStatusMsg(t('parsing_overlay.success'))
      router.push('/dashboard/cdi/profil/valider')
    } catch (err) {
      console.error('[cdi-profil upload] unexpected error', err)
      setErrorMsg(t('errors.generic'))
      setStatus('error')
    }
  }

  // ─── Loading (auth check pending) ────────────────────────────────────────
  if (!authChecked) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#f8fafc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <style>{`@keyframes sk-spin { to { transform: rotate(360deg); } }`}</style>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            border: `3px solid ${domain.primaryColor}22`,
            borderTopColor: domain.primaryColor,
            animation: 'sk-spin 0.9s linear infinite',
          }}
        />
      </div>
    )
  }

  // ─── Forbidden (user_type !== 'expert_cdi') ──────────────────────────────
  if (forbidden) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#f8fafc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 16,
            padding: 32,
            maxWidth: 440,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden>
            🔒
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
            403
          </div>
          <button
            type="button"
            onClick={() => router.push('/')}
            style={{
              marginTop: 16,
              background: domain.primaryColor,
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              padding: '10px 18px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            ←
          </button>
        </div>
      </div>
    )
  }

  // ─── Main render ─────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'Inter, sans-serif' }}>
      <style>{`
        @keyframes sk-spin { to { transform: rotate(360deg); } }
        @media (max-width: 767px) {
          .profil-grid { grid-template-columns: 1fr !important; }
          .profil-main { padding: 18px !important; }
          .profil-title { font-size: 26px !important; }
          .profil-header { padding: 0 16px !important; }
        }
      `}</style>

      {/* Header */}
      <div
        className="profil-header"
        style={{
          background: '#fff',
          borderBottom: '1px solid #e5e7eb',
          padding: '0 20px',
          height: 58,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: domain.primaryColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {domain.logoUrl ? (
              <img src={domain.logoUrl} alt={domain.name} width={18} height={18} />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 2L12 22M2 12L22 12M5 5L19 19M19 5L5 19"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </div>
          <span style={{ fontSize: 17, fontWeight: 700, color: '#111827' }}>{domain.name}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <LanguageSwitcher />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: '#fef9c3',
              border: '1px solid #fde68a',
              padding: '7px 14px',
              borderRadius: 20,
            }}
          >
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#eab308' }} />
            <span
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: '#92400e',
                whiteSpace: 'nowrap',
              }}
            >
              {t('status_badge.pending')}
            </span>
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="profil-main" style={{ maxWidth: 1040, margin: '0 auto', padding: 32 }}>
        <button
          type="button"
          onClick={() => router.push('/dashboard/cdi')}
          style={{
            background: 'transparent',
            border: 'none',
            color: domain.primaryColor,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            padding: 0,
            marginBottom: 24,
          }}
        >
          {t('back_link')}
        </button>

        {errorMsg && (
          <div
            role="alert"
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 12,
              padding: '12px 16px',
              marginBottom: 20,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
            }}
          >
            <div style={{ color: '#dc2626', fontSize: 13, flex: 1, lineHeight: 1.55 }}>
              {errorMsg}
            </div>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              aria-label={t('error_close_aria')}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#991b1b',
                fontSize: 20,
                cursor: 'pointer',
                lineHeight: 1,
                padding: 0,
              }}
            >
              ×
            </button>
          </div>
        )}

        <h1
          className="profil-title"
          style={{
            fontSize: 32,
            fontWeight: 800,
            color: '#0f172a',
            letterSpacing: '-0.3px',
            marginBottom: 8,
          }}
        >
          {t('page_title')}
        </h1>
        <p
          style={{
            fontSize: 15,
            color: '#64748b',
            lineHeight: 1.6,
            marginBottom: 32,
            maxWidth: 640,
          }}
        >
          {t('page_subtitle')}
        </p>

        <div
          className="profil-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 20,
            marginBottom: 24,
          }}
        >
          {/* CV card */}
          <div
            style={{
              position: 'relative',
              background: '#fff',
              borderRadius: 16,
              border: `2px solid ${domain.primaryColor}`,
              padding: 24,
              opacity: busy ? 0.55 : 1,
              pointerEvents: busy ? 'none' : 'auto',
              transition: 'opacity 0.2s',
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: 16,
                right: 16,
                background: domain.primaryColor,
                color: '#fff',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.05em',
                padding: '4px 10px',
                borderRadius: 100,
              }}
            >
              {t('card_cv.recommended_badge')}
            </span>

            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                background: `${domain.primaryColor}15`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <path
                  d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                  stroke={domain.primaryColor}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <polyline
                  points="14 2 14 8 20 8"
                  fill="none"
                  stroke={domain.primaryColor}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <h2
              style={{
                fontSize: 18,
                fontWeight: 800,
                color: '#0f172a',
                marginBottom: 6,
                letterSpacing: '-0.3px',
              }}
            >
              {t('card_cv.title')}
            </h2>
            <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.55, marginBottom: 18 }}>
              {t('card_cv.subtitle')}
            </p>

            <button
              type="button"
              onClick={() => requestFile(cvInputRef)}
              disabled={busy}
              style={{
                width: '100%',
                background: `${domain.primaryColor}08`,
                border: `2px dashed ${domain.primaryColor}66`,
                borderRadius: 12,
                padding: '22px 16px',
                color: domain.primaryColor,
                cursor: busy ? 'not-allowed' : 'pointer',
                textAlign: 'center',
                fontFamily: 'inherit',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                {t('card_cv.dropzone_label')}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>
                {t('card_cv.dropzone_hint')}
              </div>
            </button>
            <input
              ref={cvInputRef}
              type="file"
              accept="application/pdf"
              style={{ display: 'none' }}
              onChange={handleFile}
            />
          </div>

          {/* LinkedIn card */}
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              border: '1px solid #e2e8f0',
              padding: 24,
              opacity: busy ? 0.55 : 1,
              pointerEvents: busy ? 'none' : 'auto',
              transition: 'opacity 0.2s',
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                background: '#e0e7ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="#0a66c2">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.024-3.037-1.852-3.037-1.853 0-2.136 1.446-2.136 2.94v5.666H9.352V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.602 0 4.268 2.37 4.268 5.455v6.286zM5.337 7.433a2.063 2.063 0 0 1-2.063-2.065 2.063 2.063 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452z" />
              </svg>
            </div>

            <h2
              style={{
                fontSize: 18,
                fontWeight: 800,
                color: '#0f172a',
                marginBottom: 6,
                letterSpacing: '-0.3px',
              }}
            >
              {t('card_linkedin.title')}
            </h2>
            <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.55, marginBottom: 14 }}>
              {t('card_linkedin.subtitle')}
            </p>

            <ol
              style={{
                fontSize: 12,
                color: '#475569',
                lineHeight: 1.7,
                paddingLeft: 18,
                marginBottom: 18,
              }}
            >
              <li>{t('card_linkedin.step_1')}</li>
              <li>
                {t.rich('card_linkedin.step_2', {
                  strong: chunks => <strong>{chunks}</strong>,
                })}
              </li>
              <li>
                {t.rich('card_linkedin.step_3', {
                  strong: chunks => <strong>{chunks}</strong>,
                })}
              </li>
            </ol>

            <button
              type="button"
              onClick={() => requestFile(liInputRef)}
              disabled={busy}
              style={{
                width: '100%',
                background: '#f8fafc',
                border: '2px dashed #cbd5e1',
                borderRadius: 12,
                padding: '22px 16px',
                color: '#475569',
                cursor: busy ? 'not-allowed' : 'pointer',
                textAlign: 'center',
                fontFamily: 'inherit',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                {t('card_linkedin.dropzone_label')}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>
                {t('card_linkedin.dropzone_hint')}
              </div>
            </button>
            <input
              ref={liInputRef}
              type="file"
              accept="application/pdf"
              style={{ display: 'none' }}
              onChange={handleFile}
            />
          </div>
        </div>

        {/* Consent */}
        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            padding: 16,
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            marginBottom: 20,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={consent}
            onChange={e => setConsent(e.target.checked)}
            style={{ marginTop: 3, flexShrink: 0, accentColor: domain.primaryColor }}
          />
          <span style={{ fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
            {t.rich('consent.text', {
              highlight: chunks => (
                <span style={{ color: domain.primaryColor, fontWeight: 600 }}>{chunks}</span>
              ),
            })}
          </span>
        </label>

        {/* Yellow locked banner */}
        <div
          style={{
            background: '#fef9c3',
            border: '1px solid #fde68a',
            borderRadius: 12,
            padding: 16,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: '#fef08a',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"
                stroke="#92400e"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div style={{ fontSize: 13, color: '#92400e', lineHeight: 1.6 }}>
            {t.rich('locked_banner', {
              strong: chunks => <strong>{chunks}</strong>,
            })}
          </div>
        </div>
      </div>

      {/* Uploading overlay */}
      {status === 'uploading' && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            backdropFilter: 'blur(3px)',
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              padding: '28px 32px',
              textAlign: 'center',
              maxWidth: 340,
              boxShadow: '0 20px 50px rgba(0,0,0,0.2)',
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                border: `3px solid ${domain.primaryColor}22`,
                borderTopColor: domain.primaryColor,
                margin: '0 auto 14px',
                animation: 'sk-spin 0.9s linear infinite',
              }}
            />
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>
              {t('parsing_overlay.title')}
            </div>
            <div style={{ fontSize: 13, color: '#64748b' }}>{t('parsing_overlay.duration')}</div>
          </div>
        </div>
      )}

      {/* Success overlay */}
      {status === 'success' && statusMsg && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              padding: '22px 28px',
              fontSize: 15,
              fontWeight: 600,
              color: '#0f172a',
            }}
          >
            {statusMsg}
          </div>
        </div>
      )}
    </div>
  )
}
