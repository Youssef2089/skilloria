'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/organisations/[id] — fiche détail d'une organisation (B5c).
 *
 * Source : GET /api/admin/get-org/[id] (renvoie { org, contact, verification })
 *
 * 3 blocs : Entreprise / Contact / Résultat de vérification.
 *
 * Actions admin (UNIQUEMENT si verification_status='pending_admin_review') :
 *   - Valider → POST /api/admin/approve-org
 *   - Refuser → POST /api/admin/reject-org (avec motif optionnel)
 *
 * Mini-confirmation inline avant action (style Stripe/Linear).
 * Après succès → router.push('/admin/organisations').
 *
 * Si statut approved/rejected → encart décision + masquer les boutons.
 */

type Org = {
  id: string
  company_name: string | null
  logo_url: string | null
  siren: string | null
  vat_number: string | null
  org_type: string | null
  country: string | null
  email_domain: string | null
  website_url: string | null
  verification_status: string | null
  verification_method: string | null
  verified_at: string | null
  verified_by: string | null
  review_reason: string | null
  created_at: string
}

type Contact = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
  job_title: string | null
  linkedin_url: string | null
  civility: string | null
  locale: string | null
}

type Verification = {
  method: string | null
  status: string | null
  score: number | null
  notes: string | null
  last_provider: string | null
  attempts_count: number | null
  had_rejection: boolean
  rejected_by: string[]
  /** 11G — écarts détectés par l'IA entre données saisies et INSEE. */
  discrepancies: string[]
  /** Fix Sirene (D4) — état du provider Sirene après ses tentatives. */
  sirene_status: 'ok' | 'not_found' | 'error' | 'skipped' | null
  /** Fix Sirene (D4) — message court d'erreur Sirene si sirene_status='error'. */
  sirene_error_note: string | null
}

type LoadedData = { org: Org; contact: Contact | null; verification: Verification }

type ConfirmMode = null | 'approve' | 'reject'

function scoreColor(score: number | null): string {
  if (score == null) return 'var(--color-text-tertiary, #94a3b8)'
  if (score < 5) return '#dc2626'
  if (score < 9) return '#d97706'
  return '#16a34a'
}

function statusBadge(
  status: string | null,
): { bg: string; color: string; dot: string } {
  if (status === 'approved') return { bg: '#DCFCE7', color: '#166534', dot: '#16A34A' }
  if (status === 'rejected') return { bg: '#FEE2E2', color: '#991b1b', dot: '#dc2626' }
  return { bg: '#FEF9C3', color: '#713F12', dot: '#CA8A04' }
}

export default function AdminOrgDetailPage() {
  const t = useTranslations('admin_back_office')
  const locale = useLocale()
  const params = useParams()
  const router = useRouter()
  const secureFetch = useSecureFetch()

  const orgId = (params?.id as string | undefined) ?? ''

  const [data, setData] = useState<LoadedData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await secureFetch(`/api/admin/get-org/${orgId}`, {
        method: 'GET',
      })
      if (res.status === 404) {
        setError('not_found')
        setLoading(false)
        return
      }
      if (res.status === 403) {
        setError(t('errors.forbidden'))
        setLoading(false)
        return
      }
      if (!res.ok) {
        setError(t('errors.generic'))
        setLoading(false)
        return
      }
      const json = (await res.json()) as LoadedData
      setData(json)
    } catch {
      setError(t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [orgId, t, secureFetch])

  useEffect(() => {
    if (orgId) void load()
  }, [orgId, load])

  async function performDecision(action: 'approve' | 'reject') {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const url = action === 'approve' ? '/api/admin/approve-org' : '/api/admin/reject-org'
      const body: { organization_id: string; reason?: string } = { organization_id: orgId }
      if (action === 'reject') {
        const trimmed = rejectReason.trim()
        if (trimmed.length > 0) body.reason = trimmed
      }
      const res = await secureFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = (await res.json().catch(() => ({}))) as { code?: string }
      if (!res.ok) {
        if (payload.code === 'already_processed') {
          setSubmitError(t('errors.already_processed'))
        } else {
          setSubmitError(t('errors.generic'))
        }
        return
      }
      // Succès → retour à la liste
      router.push('/admin/organisations')
    } catch {
      setSubmitError(t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  function formatDate(iso: string | null): string {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleDateString(locale, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return iso.slice(0, 10)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 14 }}>
        {t('loading')}
      </div>
    )
  }

  if (error === 'not_found' || (!loading && !data && !error)) {
    return (
      <div>
        <Link
          href="/admin/organisations"
          style={{ fontSize: 13, color: '#00B9FF', textDecoration: 'none', marginBottom: 24, display: 'inline-block' }}
        >
          {t('detail.back')}
        </Link>
        <div
          style={{
            padding: 32,
            background: 'var(--color-background-primary, #fff)',
            border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
            borderRadius: 12,
            textAlign: 'center',
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 500, color: 'var(--color-text-primary, #0f172a)', marginBottom: 8 }}>
            {t('not_found_title')}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)' }}>
            {t('not_found_subtitle')}
          </p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <Link
          href="/admin/organisations"
          style={{ fontSize: 13, color: '#00B9FF', textDecoration: 'none', marginBottom: 24, display: 'inline-block' }}
        >
          {t('detail.back')}
        </Link>
        <div
          role="alert"
          style={{
            padding: 16,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
            fontSize: 13,
            borderRadius: 10,
          }}
        >
          {error}
        </div>
      </div>
    )
  }

  if (!data) return null

  const { org, contact, verification } = data
  const badge = statusBadge(org.verification_status)
  const isPending = org.verification_status === 'pending_admin_review'

  // Composant utilitaire row
  function Row({ label, value, isLink }: { label: string; value: string | null; isLink?: boolean }) {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '160px 1fr',
          gap: 12,
          padding: '8px 0',
          fontSize: 13,
        }}
      >
        <div style={{ color: 'var(--color-text-secondary, #64748b)' }}>{label}</div>
        <div style={{ color: 'var(--color-text-primary, #0f172a)', wordBreak: 'break-word' }}>
          {value
            ? isLink
              ? (
                <a href={value} target="_blank" rel="noreferrer" style={{ color: '#00B9FF', textDecoration: 'underline' }}>
                  {value}
                </a>
              )
              : value
            : '—'}
        </div>
      </div>
    )
  }

  const contactFullName = contact
    ? [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim() || '—'
    : '—'

  return (
    <div>
      <Link
        href="/admin/organisations"
        style={{ fontSize: 13, color: '#00B9FF', textDecoration: 'none', marginBottom: 16, display: 'inline-block' }}
      >
        {t('detail.back')}
      </Link>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          marginBottom: 24,
          flexWrap: 'wrap',
        }}
      >
        {org.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={org.logo_url}
            alt={org.company_name ?? ''}
            width={56}
            height={56}
            style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover' }}
          />
        ) : (
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: '#DBEAFE',
              color: '#00B9FF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              fontWeight: 500,
            }}
          >
            {((org.company_name ?? '').trim().slice(0, 2) || '??').toUpperCase()}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ fontSize: 22, fontWeight: 500, color: 'var(--color-text-primary, #0f172a)', margin: 0 }}>
            {org.company_name ?? '—'}
          </h1>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 10px',
                background: badge.bg,
                color: badge.color,
                fontSize: 11,
                fontWeight: 500,
                borderRadius: 12,
              }}
            >
              <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: badge.dot }} />
              {org.verification_status === 'approved'
                ? t('status_approved')
                : org.verification_status === 'rejected'
                  ? t('status_rejected')
                  : t('status_pending')}
            </span>
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #64748b)' }}>
              {t('table.col_registered')} {formatDate(org.created_at)}
            </span>
          </div>
        </div>
      </div>

      {/* Encart décision si déjà traitée */}
      {!isPending && (
        <div
          style={{
            background: 'var(--color-background-primary, #fff)',
            border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
            borderRadius: 12,
            padding: '16px 18px',
            marginBottom: 20,
          }}
        >
          <div style={{ fontSize: 13, color: 'var(--color-text-primary, #0f172a)', fontWeight: 500, marginBottom: 4 }}>
            {t('decided_on', { date: formatDate(org.verified_at) })}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #64748b)' }}>
            {org.verified_by ? t('decision_manual') : t('decision_auto')}
          </div>
          {org.review_reason && (
            <div style={{ marginTop: 10, fontSize: 13, color: 'var(--color-text-primary, #0f172a)' }}>
              <span style={{ color: 'var(--color-text-secondary, #64748b)', fontWeight: 500 }}>
                {t('review_reason_label')} :
              </span>{' '}
              {org.review_reason}
            </div>
          )}
        </div>
      )}

      {/* 3 blocs */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
          marginBottom: 24,
        }}
      >
        {/* Entreprise */}
        <section
          style={{
            background: 'var(--color-background-primary, #fff)',
            border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
            borderRadius: 12,
            padding: '18px 22px',
          }}
        >
          <h2
            style={{
              fontSize: 11,
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '.08em',
              color: 'var(--color-text-secondary, #64748b)',
              marginBottom: 10,
            }}
          >
            {t('detail.section_company')}
          </h2>
          <Row label={t('detail.field_siren')} value={org.siren} />
          <Row label={t('detail.field_type')} value={org.org_type} />
          <Row label={t('detail.field_website')} value={org.website_url} isLink />
        </section>

        {/* Contact */}
        <section
          style={{
            background: 'var(--color-background-primary, #fff)',
            border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
            borderRadius: 12,
            padding: '18px 22px',
          }}
        >
          <h2
            style={{
              fontSize: 11,
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '.08em',
              color: 'var(--color-text-secondary, #64748b)',
              marginBottom: 10,
            }}
          >
            {t('detail.section_contact')}
          </h2>
          <Row label={t('detail.field_name')} value={contactFullName} />
          <Row label={t('detail.field_role')} value={contact?.job_title ?? null} />
          <Row label={t('detail.field_email')} value={contact?.email ?? null} />
          <Row label={t('detail.field_linkedin')} value={contact?.linkedin_url ?? null} isLink />
        </section>

        {/* Vérification */}
        <section
          style={{
            background: 'var(--color-background-primary, #fff)',
            border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
            borderRadius: 12,
            padding: '18px 22px',
          }}
        >
          <h2
            style={{
              fontSize: 11,
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '.08em',
              color: 'var(--color-text-secondary, #64748b)',
              marginBottom: 10,
            }}
          >
            {t('detail.section_verification')}
          </h2>
          {verification.sirene_status === 'error' && (
            <div
              role="alert"
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                padding: '10px 12px',
                marginBottom: 12,
                background: '#FEF9C3',
                border: '1px solid #FDE047',
                borderRadius: 8,
                fontSize: 12,
                color: '#713F12',
                lineHeight: 1.5,
              }}
            >
              <span aria-hidden style={{ flexShrink: 0, marginTop: 2, width: 6, height: 6, borderRadius: '50%', background: '#CA8A04' }} />
              <span>
                <strong style={{ fontWeight: 500 }}>{t('detail.sirene_unavailable_title')}</strong>
                <br />
                {t('detail.sirene_unavailable_hint')}
                {verification.sirene_error_note ? ` (${verification.sirene_error_note})` : ''}
              </span>
            </div>
          )}
          <Row label={t('detail.field_method')} value={verification.method ?? verification.last_provider ?? null} />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '160px 1fr',
              gap: 12,
              padding: '8px 0',
              fontSize: 13,
            }}
          >
            <div style={{ color: 'var(--color-text-secondary, #64748b)' }}>{t('detail.field_score')}</div>
            <div style={{ color: scoreColor(verification.score), fontWeight: 500 }}>
              {verification.score == null ? '—' : Math.round(verification.score)}
            </div>
          </div>
          {verification.had_rejection && verification.rejected_by.length > 0 && (
            <Row
              label={t('detail.field_reject_provider')}
              value={verification.rejected_by.join(', ')}
            />
          )}
          {verification.notes && (
            <div style={{ marginTop: 10 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: '.05em',
                  color: 'var(--color-text-secondary, #64748b)',
                  marginBottom: 4,
                }}
              >
                {t('detail.ai_note_label')}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--color-text-primary, #0f172a)',
                  lineHeight: 1.6,
                  background: 'var(--color-background-secondary, #f8fafc)',
                  padding: '10px 12px',
                  borderRadius: 8,
                }}
              >
                {verification.notes}
              </div>
            </div>
          )}
          {verification.discrepancies.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: '.05em',
                  color: 'var(--color-text-secondary, #64748b)',
                  marginBottom: 6,
                }}
              >
                {t('detail.discrepancies_label')}
              </div>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: 'var(--color-text-primary, #0f172a)',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  padding: '10px 12px 10px 28px',
                  borderRadius: 8,
                  listStyle: 'disc',
                }}
              >
                {verification.discrepancies.map((d, i) => (
                  <li key={i} style={{ marginBottom: 2 }}>
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      {/* Actions admin */}
      {isPending && (
        <div
          style={{
            background: 'var(--color-background-primary, #fff)',
            border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
            borderRadius: 12,
            padding: '18px 22px',
          }}
        >
          {submitError && (
            <div
              role="alert"
              style={{
                padding: '8px 12px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                fontSize: 12,
                borderRadius: 8,
                marginBottom: 12,
              }}
            >
              {submitError}
            </div>
          )}

          {confirmMode === null && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setConfirmMode('approve')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 18px',
                  background: '#16a34a',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {t('action_approve')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmMode('reject')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 18px',
                  background: '#fff',
                  color: '#dc2626',
                  border: '1px solid #dc2626',
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {t('action_reject')}
              </button>
            </div>
          )}

          {confirmMode === 'approve' && (
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 500, color: 'var(--color-text-primary, #0f172a)', marginBottom: 6 }}>
                {t('confirm_approve_title')}
              </h3>
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', marginBottom: 16, lineHeight: 1.5 }}>
                {t('confirm_approve_text')}
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => void performDecision('approve')}
                  disabled={submitting}
                  style={{
                    padding: '10px 18px',
                    background: '#16a34a',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    opacity: submitting ? 0.6 : 1,
                    fontFamily: 'inherit',
                  }}
                >
                  {submitting ? t('loading') : t('confirm_yes')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmMode(null)}
                  disabled={submitting}
                  style={{
                    padding: '10px 18px',
                    background: 'transparent',
                    color: 'var(--color-text-secondary, #64748b)',
                    border: '1px solid var(--color-border-tertiary, #e5e7eb)',
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {t('confirm_cancel')}
                </button>
              </div>
            </div>
          )}

          {confirmMode === 'reject' && (
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 500, color: 'var(--color-text-primary, #0f172a)', marginBottom: 6 }}>
                {t('confirm_reject_title')}
              </h3>
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', marginBottom: 16, lineHeight: 1.5 }}>
                {t('confirm_reject_text')}
              </p>
              <label
                htmlFor="reject_reason"
                style={{ display: 'block', fontSize: 12, color: 'var(--color-text-secondary, #64748b)', fontWeight: 500, marginBottom: 6 }}
              >
                {t('reject_reason_label')}
              </label>
              <textarea
                id="reject_reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder={t('reject_reason_placeholder')}
                maxLength={1000}
                rows={3}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: 13,
                  border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
                  borderRadius: 8,
                  outline: 'none',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  marginBottom: 12,
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => void performDecision('reject')}
                  disabled={submitting}
                  style={{
                    padding: '10px 18px',
                    background: '#dc2626',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    opacity: submitting ? 0.6 : 1,
                    fontFamily: 'inherit',
                  }}
                >
                  {submitting ? t('loading') : t('confirm_yes')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmMode(null)
                    setRejectReason('')
                  }}
                  disabled={submitting}
                  style={{
                    padding: '10px 18px',
                    background: 'transparent',
                    color: 'var(--color-text-secondary, #64748b)',
                    border: '1px solid var(--color-border-tertiary, #e5e7eb)',
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {t('confirm_cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
