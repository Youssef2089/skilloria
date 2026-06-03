'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * Carte de candidature côté ORG (Lot 2c).
 *
 * États visuels :
 *  - 'received' / 'in_review' / 'shortlisted' :
 *      preview masquée (anonymisée) + boutons Accepter l'échange / Refuser
 *  - 'unlocked' :
 *      profil COMPLET (identité, contact, détails) + badge « Échange ouvert »
 *      + lien désactivé « Conversation (Lot 3 — bientôt) »
 *  - 'rejected' :
 *      carte fanée + badge refus + status_reason si présent (jamais d'actions)
 *  - 'withdrawn' / 'archived' :
 *      carte fanée informative
 *
 * La carte ne fait pas elle-même le fetch initial — elle reçoit les données du
 * parent et déclenche les mutations via secureFetch. Le parent re-fetche après
 * mutation pour rafraîchir la liste.
 */

export type CandidatureUnlockedProfile = {
  first_name: string | null
  last_name: string | null
  civility: string | null
  email: string | null
  phone: string | null
  job_title: string | null
  user_linkedin_url: string | null
  title: string | null
  summary: string | null
  skills: string[]
  seniority: string | null
  expert_type: string | null
  years_experience: number | null
  years_total_experience: number | null
  tjm_min: number | null
  tjm_max: number | null
  salary_min: number | null
  salary_max: number | null
  work_modes: string[]
  languages: string[]
  country: string | null
  city: string | null
  address_line: string | null
  postal_code: string | null
  availability_status: string | null
  availability_date: string | null
  profile_score: number | null
  cv_url: string | null
  linkedin_url: string | null
  photo_url: string | null
  birth_year: number | null
}

export type CandidaturePreview = {
  title: string | null
  summary: string | null
  skills: string[]
  seniority: string | null
  expert_type: string | null
  years_experience: number | null
  years_total_experience: number | null
  tjm_min: number | null
  tjm_max: number | null
  salary_min: number | null
  salary_max: number | null
  work_modes: string[]
  languages: string[]
  country: string | null
  city: string | null
  availability_status: string | null
  availability_date: string | null
  profile_score: number | null
  branch_label: string | null
  speciality_label: string | null
}

export type CandidatureData = {
  id: string
  profile_id: string
  status: string
  status_reason: string | null
  unlocked_at: string | null
  cover_message: string | null
  ai_match_score: number | null
  created_at: string
  preview: CandidaturePreview
  unlocked_profile: CandidatureUnlockedProfile | null
}

type Props = {
  candidature: CandidatureData
  publicationType: string                 // 'mission' | 'offre'
  onMutated: () => void                   // re-fetch parent
}

function relativeFromNow(iso: string | null, locale: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffMs = Math.max(0, now - then)
  const sec = Math.round(diffMs / 1000)
  const min = Math.round(sec / 60)
  const hr = Math.round(min / 60)
  const day = Math.round(hr / 24)
  const labels =
    locale === 'fr' ? { d: 'j', h: 'h', m: 'min' }
    : locale === 'es' ? { d: 'd', h: 'h', m: 'min' }
    : locale === 'de' ? { d: 'T', h: 'h', m: 'min' }
    : { d: 'd', h: 'h', m: 'min' }
  if (day >= 1) return `${day}${labels.d}`
  if (hr >= 1) return `${hr}${labels.h}`
  if (min >= 1) return `${min}${labels.m}`
  return locale === 'fr' ? "à l'instant" : 'just now'
}

function formatRate(min: number | null, max: number | null, unit: string): string {
  if (min == null && max == null) return ''
  if (min != null && max != null) return `${Math.round(min)}-${Math.round(max)}€${unit}`
  if (min != null) return `${Math.round(min)}€${unit}`
  return `${Math.round(max!)}€${unit}`
}

function scoreColor(score: number, domainPrimary: string): string {
  if (score >= 9) return '#16A34A'
  if (score >= 7) return domainPrimary
  if (score >= 5) return '#CA8A04'
  return '#94a3b8'
}

export default function CandidatureCard({ candidature, publicationType, onMutated }: Props) {
  const t = useTranslations('candidatures.card')
  const locale = useLocale()
  const domain = useDomain()
  const secureFetch = useSecureFetch()

  const [busy, setBusy] = useState<'unlock' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmReject, setConfirmReject] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const { status, preview, unlocked_profile, ai_match_score, cover_message, created_at, status_reason } = candidature
  const isUnlocked = status === 'unlocked'
  const isRejected = status === 'rejected'
  const isClosed = isRejected || status === 'withdrawn' || status === 'archived'
  const canAct = status === 'received' || status === 'in_review' || status === 'shortlisted'

  const rateUnit = publicationType === 'mission'
    ? (locale === 'fr' ? '/jour' : locale === 'es' ? '/día' : locale === 'de' ? '/Tag' : '/day')
    : (locale === 'fr' ? '/an' : locale === 'es' ? '/año' : locale === 'de' ? '/Jahr' : '/year')
  const rateText = publicationType === 'mission'
    ? formatRate(preview.tjm_min, preview.tjm_max, rateUnit)
    : formatRate(preview.salary_min, preview.salary_max, rateUnit)

  const handleUnlock = async () => {
    setBusy('unlock')
    setError(null)
    try {
      const res = await secureFetch(`/api/candidatures/${candidature.id}/unlock`, { method: 'POST' })
      const payload = (await res.json().catch(() => ({} as { code?: string }))) as { code?: string }
      if (!res.ok) {
        if (payload.code === 'invalid_transition') setError(t('error_invalid_transition'))
        else if (payload.code === 'not_found') setError(t('error_not_found'))
        else setError(t('error_generic'))
        return
      }
      onMutated()
    } catch (err) {
      console.error('[candidature unlock] threw', err)
      setError(t('error_generic'))
    } finally {
      setBusy(null)
    }
  }

  const handleReject = async () => {
    if (rejectReason.length > 2000) {
      setError(t('error_reason_too_long'))
      return
    }
    setBusy('reject')
    setError(null)
    try {
      const res = await secureFetch(`/api/candidatures/${candidature.id}/reject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason.trim() || null }),
      })
      const payload = (await res.json().catch(() => ({} as { code?: string }))) as { code?: string }
      if (!res.ok) {
        if (payload.code === 'invalid_transition') setError(t('error_invalid_transition'))
        else if (payload.code === 'not_found') setError(t('error_not_found'))
        else setError(t('error_generic'))
        return
      }
      onMutated()
    } catch (err) {
      console.error('[candidature reject] threw', err)
      setError(t('error_generic'))
    } finally {
      setBusy(null)
      setConfirmReject(false)
    }
  }

  // ── Display name : masqué avant unlock, complet après ───────────────────
  const displayName = isUnlocked && unlocked_profile
    ? [unlocked_profile.civility, unlocked_profile.first_name, unlocked_profile.last_name].filter(Boolean).join(' ').trim() || t('candidate_label')
    : t('anonymous_candidate')

  return (
    <article
      style={{
        background: '#fff',
        border: isUnlocked ? `1.5px solid ${domain.primaryColor}` : '0.5px solid #e5e7eb',
        borderRadius: 14,
        padding: '18px 20px',
        opacity: isClosed ? 0.65 : 1,
        transition: 'opacity .15s, box-shadow .2s',
      }}
    >
      {/* Header : avatar + nom (ou anonyme) + score + status badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
          {isUnlocked && unlocked_profile?.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={unlocked_profile.photo_url} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
          ) : (
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#f1f5f9', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 600, flexShrink: 0 }}>
              {isUnlocked && unlocked_profile?.first_name ? unlocked_profile.first_name[0]?.toUpperCase() ?? '?' : '?'}
            </div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 2, lineHeight: 1.35 }}>
              {displayName}
            </h3>
            <div style={{ fontSize: 12, color: '#64748b', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {preview.title && <span>{preview.title}</span>}
              {preview.seniority && (<><span aria-hidden>·</span><span>{preview.seniority}</span></>)}
              {(preview.years_experience ?? preview.years_total_experience) != null && (
                <><span aria-hidden>·</span><span>{t('years_experience', { years: preview.years_experience ?? preview.years_total_experience ?? 0 })}</span></>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          {ai_match_score != null && (
            <span
              title={t('ai_score_tooltip')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                background: `${scoreColor(ai_match_score, domain.primaryColor)}1A`,
                color: scoreColor(ai_match_score, domain.primaryColor),
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 12,
              }}
            >
              <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: scoreColor(ai_match_score, domain.primaryColor) }} />
              {t('ai_score', { score: Math.round(ai_match_score) })}
            </span>
          )}
          <span
            style={{
              padding: '3px 9px',
              background: isUnlocked ? '#DCFCE7' : isRejected ? '#FEE2E2' : '#f1f5f9',
              color: isUnlocked ? '#166534' : isRejected ? '#991B1B' : '#475569',
              fontSize: 10,
              fontWeight: 600,
              borderRadius: 10,
              textTransform: 'uppercase',
              letterSpacing: '.05em',
            }}
          >
            {t(`status.${status}`)}
          </span>
        </div>
      </div>

      {/* Méta : ville / pays / disponibilité (preview) */}
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(preview.city ?? preview.country) && (
          <span>📍 {[preview.city, preview.country].filter(Boolean).join(', ')}</span>
        )}
        {rateText && (<><span aria-hidden>·</span><span>{rateText}</span></>)}
        {preview.availability_status && (
          <><span aria-hidden>·</span><span>{t(`availability.${preview.availability_status}` as 'availability.immediate', {} as never)}</span></>
        )}
        <span aria-hidden>·</span>
        <span title={created_at}>{t('candidated_ago', { time: relativeFromNow(created_at, locale) })}</span>
      </div>

      {/* Compétences */}
      {preview.skills.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {preview.skills.slice(0, 12).map((s) => (
            <span key={s} style={{ background: '#f1f5f9', color: '#334155', padding: '3px 9px', borderRadius: 10, fontSize: 11, fontWeight: 500 }}>{s}</span>
          ))}
          {preview.skills.length > 12 && (
            <span style={{ color: '#94a3b8', fontSize: 11 }}>+{preview.skills.length - 12}</span>
          )}
        </div>
      )}

      {/* Summary preview (clip 220 char) */}
      {preview.summary && (
        <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.5, margin: '0 0 12px 0' }}>
          {preview.summary.length > 220 ? `${preview.summary.slice(0, 220)}…` : preview.summary}
        </p>
      )}

      {/* Cover message expert */}
      {cover_message && (
        <div style={{ background: `${domain.primaryColor}0A`, border: `1px solid ${domain.primaryColor}22`, borderRadius: 10, padding: '10px 12px', fontSize: 12, color: '#334155', lineHeight: 1.55, marginBottom: 12, whiteSpace: 'pre-wrap' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: domain.primaryColor, marginBottom: 4 }}>
            {t('cover_message_label')}
          </div>
          {cover_message}
        </div>
      )}

      {/* PROFIL COMPLET (post-unlock) */}
      {isUnlocked && unlocked_profile && (
        <div style={{ background: '#DCFCE730', border: '1px solid #86EFAC', borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#166534', marginBottom: 10 }}>
            ✓ {t('unlocked_section_label')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, fontSize: 13 }}>
            {unlocked_profile.email && (
              <div><div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>{t('email')}</div><div><a href={`mailto:${unlocked_profile.email}`} style={{ color: domain.primaryColor, textDecoration: 'none' }}>{unlocked_profile.email}</a></div></div>
            )}
            {unlocked_profile.phone && (
              <div><div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>{t('phone')}</div><div><a href={`tel:${unlocked_profile.phone}`} style={{ color: domain.primaryColor, textDecoration: 'none' }}>{unlocked_profile.phone}</a></div></div>
            )}
            {(unlocked_profile.user_linkedin_url ?? unlocked_profile.linkedin_url) && (
              <div><div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>LinkedIn</div><div><a href={(unlocked_profile.user_linkedin_url ?? unlocked_profile.linkedin_url) ?? '#'} target="_blank" rel="noreferrer" style={{ color: domain.primaryColor, textDecoration: 'none' }}>{t('view_profile')} ↗</a></div></div>
            )}
            {unlocked_profile.cv_url && (
              <div><div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>CV</div><div><a href={unlocked_profile.cv_url} target="_blank" rel="noreferrer" style={{ color: domain.primaryColor, textDecoration: 'none' }}>{t('download_cv')} ↗</a></div></div>
            )}
            {unlocked_profile.address_line && (
              <div style={{ gridColumn: 'span 2' }}>
                <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>{t('address')}</div>
                <div>{[unlocked_profile.address_line, unlocked_profile.postal_code, unlocked_profile.city, unlocked_profile.country].filter(Boolean).join(', ')}</div>
              </div>
            )}
          </div>
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #86EFAC' }}>
            <button
              type="button"
              disabled
              title={t('conversation_lot3_tooltip')}
              style={{
                padding: '8px 14px',
                background: '#fff',
                color: '#94a3b8',
                border: '1px solid #cbd5e1',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'not-allowed',
                fontFamily: 'inherit',
              }}
            >
              💬 {t('conversation_lot3_button')}
            </button>
          </div>
        </div>
      )}

      {/* Refus : raison */}
      {isRejected && status_reason && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: '#991B1B', lineHeight: 1.5, marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#991B1B', marginBottom: 4 }}>
            {t('rejection_reason_label')}
          </div>
          {status_reason}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div role="alert" style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', padding: '10px 12px', borderRadius: 10, fontSize: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* Actions */}
      {canAct && !confirmReject && (
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => setConfirmReject(true)}
            disabled={busy !== null}
            style={{
              padding: '9px 16px',
              background: 'transparent',
              color: '#64748b',
              border: '1px solid #cbd5e1',
              borderRadius: 9,
              fontSize: 12,
              fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('button_reject')}
          </button>
          <button
            type="button"
            onClick={handleUnlock}
            disabled={busy !== null}
            style={{
              padding: '9px 18px',
              background: domain.primaryColor,
              color: '#fff',
              border: 'none',
              borderRadius: 9,
              fontSize: 12,
              fontWeight: 700,
              cursor: busy ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              opacity: busy === 'unlock' ? 0.6 : 1,
            }}
          >
            {busy === 'unlock' ? t('button_unlocking') : t('button_unlock')}
          </button>
        </div>
      )}

      {/* Confirm reject inline form */}
      {canAct && confirmReject && (
        <div style={{ background: '#FEF2F2', border: '1.5px solid #FECACA', borderRadius: 10, padding: '14px 16px', marginTop: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#991B1B', marginBottom: 8 }}>{t('reject_confirm_title')}</div>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder={t('reject_reason_placeholder')}
            maxLength={2000}
            rows={3}
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: 12,
              border: '1px solid #FECACA',
              borderRadius: 8,
              outline: 'none',
              fontFamily: 'inherit',
              resize: 'vertical',
              boxSizing: 'border-box',
              lineHeight: 1.5,
              marginBottom: 10,
            }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => { setConfirmReject(false); setRejectReason(''); setError(null) }}
              disabled={busy !== null}
              style={{ padding: '8px 14px', background: 'transparent', color: '#64748b', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
            >
              {t('reject_cancel')}
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={busy !== null}
              style={{ padding: '8px 14px', background: '#DC2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: busy === 'reject' ? 0.6 : 1 }}
            >
              {busy === 'reject' ? t('button_rejecting') : t('reject_confirm')}
            </button>
          </div>
        </div>
      )}
    </article>
  )
}
