'use client'

import { useCallback, useEffect, useState } from 'react'
import { use } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/experts/[id] — fiche détaillée + actions Approve/Reject.
 */

type Props = { params: Promise<{ id: string }> }

type ExpertFull = {
  id: string
  user_id: string
  domain_id: string
  expert_type: string | null
  title: string | null
  summary: string | null
  seniority: string | null
  years_experience: number | null
  years_total_experience: number | null
  skills: string[] | null
  certifications: unknown
  tjm_min: number | null
  tjm_max: number | null
  salary_min: number | null
  salary_max: number | null
  availability_status: string | null
  linkedin_url: string | null
  cv_url: string | null
  visible: boolean | null
  ai_consent_at: string | null
  cv_parsing_status: string | null
  verification_status: string | null
  verification_method: string | null
  verification_score: number | null
  verification_data: {
    score?: number
    notes?: string
    discrepancies?: string[]
    flags?: string[]
    web_search_used?: boolean
    model_used?: string
    decided_at?: string
  } | null
  verified_at: string | null
  verified_by: string | null
  review_reason: string | null
  branches: { id: string; name: string } | null
  specialities: { id: string; name: string } | null
  users: { id: string; email: string; first_name: string | null; last_name: string | null; phone: string | null; locale: string | null; civility: string | null; job_title: string | null; linkedin_url: string | null } | null
}

type Experience = { role: string | null; employer: string | null; sector: string | null; start_date: string | null; end_date: string | null; is_current: boolean | null; description: string | null }
type Education = { school: string | null; degree: string | null; field: string | null; start_year: string | null; end_year: string | null; location: string | null }
type LanguageItem = { language: string; level: string | null; is_primary: boolean | null }

type Payload = { expert: ExpertFull; experiences: Experience[]; educations: Education[]; languages_structured: LanguageItem[] }

function pickRel<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function scoreColor(score: number | null | undefined): string {
  if (score == null) return '#94a3b8'
  if (score < 5) return '#dc2626'
  if (score < 9) return '#d97706'
  return '#16a34a'
}

export default function AdminExpertDetailPage({ params }: Props) {
  const { id } = use(params)
  const t = useTranslations('admin_back_office.experts')
  const tCommon = useTranslations('common')
  const locale = useLocale()
  const router = useRouter()
  const secureFetch = useSecureFetch()
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [showReject, setShowReject] = useState(false)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await secureFetch(`/api/admin/get-expert/${id}`, { method: 'GET' })
      if (!res.ok) {
        setError(t('error_load'))
        return
      }
      const payload = (await res.json()) as Payload
      setData(payload)
    } catch (err) {
      console.error('[admin/expert detail] load threw', err)
      setError(t('error_load'))
    }
  }, [id, secureFetch, t])

  useEffect(() => { void load() }, [load])

  const handleApprove = async () => {
    setBusy('approve')
    try {
      const res = await secureFetch('/api/admin/approve-expert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile_id: id }),
      })
      if (!res.ok) {
        const p = await res.json().catch(() => ({})) as { code?: string }
        setError(p.code === 'already_processed' ? t('error_already_processed') : t('error_generic'))
        return
      }
      await load()
    } catch (err) {
      console.error('[admin/expert] approve threw', err)
      setError(t('error_generic'))
    } finally {
      setBusy(null)
    }
  }

  const handleReject = async () => {
    if (!reason.trim()) { setError(t('error_reason_required')); return }
    setBusy('reject')
    try {
      const res = await secureFetch('/api/admin/reject-expert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile_id: id, reason: reason.trim() }),
      })
      if (!res.ok) {
        const p = await res.json().catch(() => ({})) as { code?: string }
        setError(p.code === 'already_processed' ? t('error_already_processed') : t('error_generic'))
        return
      }
      setShowReject(false)
      await load()
    } catch (err) {
      console.error('[admin/expert] reject threw', err)
      setError(t('error_generic'))
    } finally {
      setBusy(null)
    }
  }

  if (!data && !error) {
    return <div style={{ padding: 48, textAlign: 'center', color: '#64748b', fontFamily: 'Inter, sans-serif' }}>{t('loading')}</div>
  }
  if (error && !data) {
    return (
      <div>
        <p style={{ color: '#b91c1c', marginBottom: 18 }}>{error}</p>
        <button type="button" onClick={() => router.push('/admin/experts')} style={{ padding: '10px 18px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{t('back')}</button>
      </div>
    )
  }
  if (!data) return null

  const { expert: e, experiences, educations, languages_structured } = data
  const user = e.users
  const fullName = user ? [user.first_name, user.last_name].filter(Boolean).join(' ').trim() : ''
  const status = e.verification_status ?? 'pending'
  const aiData = e.verification_data ?? null

  return (
    <div>
      <button type="button" onClick={() => router.push('/admin/experts')} style={{ background: 'transparent', border: 'none', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0, marginBottom: 14 }}>← {t('back')}</button>

      {error && (
        <div role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '10px 14px', borderRadius: 10, fontSize: 12, marginBottom: 16 }}>{error}</div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#f1f5f9', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, flexShrink: 0 }}>
          {((user?.first_name?.[0] ?? '') + (user?.last_name?.[0] ?? '')).toUpperCase() || '?'}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>{fullName || user?.email || '—'}</h1>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            {[e.title, e.seniority, e.years_experience != null ? `${e.years_experience} an(s)` : null].filter(Boolean).join(' · ')}
          </div>
        </div>
        <span style={{
          padding: '6px 14px', fontSize: 12, fontWeight: 700, borderRadius: 12,
          background: status === 'approved' ? '#DCFCE7' : status === 'rejected' ? '#FEE2E2' : status === 'pending_admin_review' ? '#FEF9C3' : '#f1f5f9',
          color: status === 'approved' ? '#166534' : status === 'rejected' ? '#991B1B' : status === 'pending_admin_review' ? '#854D0E' : '#475569',
          textTransform: 'uppercase', letterSpacing: '.05em',
        }}>
          {t(`status_${status}` as 'status_pending_admin_review')}
        </span>
      </div>

      {/* Score IA + verdict */}
      {aiData && (
        <section style={{ background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: 14, padding: '16px 18px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#64748b' }}>{t('section_ai_verdict')}</h2>
            {e.verification_score != null && (
              <span style={{ padding: '4px 12px', background: `${scoreColor(e.verification_score)}1A`, color: scoreColor(e.verification_score), fontSize: 13, fontWeight: 700, borderRadius: 12 }}>
                {Math.round(e.verification_score)}/10
              </span>
            )}
          </div>
          {aiData.notes && <p style={{ fontSize: 13, color: '#334155', lineHeight: 1.55, whiteSpace: 'pre-wrap', marginBottom: 10 }}>{aiData.notes}</p>}
          {aiData.flags && aiData.flags.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600, marginBottom: 4 }}>{t('flags')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {aiData.flags.map((f) => (
                  <span key={f} style={{ background: '#FEE2E2', color: '#991B1B', padding: '3px 9px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{f}</span>
                ))}
              </div>
            </div>
          )}
          {aiData.discrepancies && aiData.discrepancies.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600, marginBottom: 4 }}>{t('discrepancies')}</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
                {aiData.discrepancies.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 11, color: '#94a3b8' }}>
            {aiData.model_used ?? '—'} {aiData.web_search_used ? '· web_search ✓' : ''}
          </div>
        </section>
      )}

      {/* Identité + contact */}
      <section style={{ background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: 14, padding: '16px 18px', marginBottom: 14 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#64748b', marginBottom: 10 }}>{t('section_identity')}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, fontSize: 13 }}>
          <div><div style={{ color: '#94a3b8', fontSize: 11 }}>{t('email')}</div><div>{user?.email}</div></div>
          <div><div style={{ color: '#94a3b8', fontSize: 11 }}>{t('phone')}</div><div>{user?.phone ?? '—'}</div></div>
          <div><div style={{ color: '#94a3b8', fontSize: 11 }}>LinkedIn (profil)</div><div>{e.linkedin_url ? <a href={e.linkedin_url} target="_blank" rel="noreferrer">{e.linkedin_url}</a> : '—'}</div></div>
          <div><div style={{ color: '#94a3b8', fontSize: 11 }}>CV</div><div>{e.cv_url ? <a href={e.cv_url} target="_blank" rel="noreferrer">↗ {t('download_cv')}</a> : '—'}</div></div>
        </div>
      </section>

      {/* Profil pro */}
      <section style={{ background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: 14, padding: '16px 18px', marginBottom: 14 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#64748b', marginBottom: 10 }}>{t('section_profile')}</h2>
        <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.6, marginBottom: 10, whiteSpace: 'pre-wrap' }}>{e.summary ?? '—'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, fontSize: 13 }}>
          <div><div style={{ color: '#94a3b8', fontSize: 11 }}>{t('branch')}</div><div>{(pickRel(e.branches) as { name: string } | null)?.name ?? '—'}</div></div>
          <div><div style={{ color: '#94a3b8', fontSize: 11 }}>{t('speciality')}</div><div>{(pickRel(e.specialities) as { name: string } | null)?.name ?? '—'}</div></div>
        </div>
        {e.skills && e.skills.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 6 }}>{t('skills')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {e.skills.map((s) => <span key={s} style={{ background: '#f1f5f9', color: '#334155', padding: '3px 9px', borderRadius: 10, fontSize: 11, fontWeight: 500 }}>{s}</span>)}
            </div>
          </div>
        )}
      </section>

      {/* Expériences */}
      {experiences.length > 0 && (
        <section style={{ background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: 14, padding: '16px 18px', marginBottom: 14 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#64748b', marginBottom: 10 }}>{t('section_experiences')}</h2>
          {experiences.map((x, i) => (
            <div key={i} style={{ paddingBottom: 12, marginBottom: 12, borderBottom: i === experiences.length - 1 ? 'none' : '1px dashed #e5e7eb' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{x.role ?? '—'} <span style={{ color: '#64748b', fontWeight: 400 }}>· {x.employer ?? '—'}</span></div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{x.sector ?? ''} · {x.start_date ?? '?'} → {x.is_current ? t('current') : x.end_date ?? '?'}</div>
              {x.description && <p style={{ fontSize: 12, color: '#475569', marginTop: 6, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{x.description}</p>}
            </div>
          ))}
        </section>
      )}

      {/* Formations */}
      {educations.length > 0 && (
        <section style={{ background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: 14, padding: '16px 18px', marginBottom: 14 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#64748b', marginBottom: 10 }}>{t('section_educations')}</h2>
          {educations.map((x, i) => (
            <div key={i} style={{ marginBottom: 8, fontSize: 13, color: '#334155' }}>
              <span style={{ fontWeight: 600 }}>{x.degree ?? '—'}</span> {x.field ? `· ${x.field}` : ''} — {x.school ?? '—'} ({x.start_year ?? '?'}-{x.end_year ?? '?'})
            </div>
          ))}
        </section>
      )}

      {/* Langues */}
      {languages_structured.length > 0 && (
        <section style={{ background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: 14, padding: '16px 18px', marginBottom: 14 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#64748b', marginBottom: 10 }}>{t('section_languages')}</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {languages_structured.map((l, i) => (
              <span key={i} style={{ background: '#f1f5f9', color: '#334155', padding: '4px 12px', borderRadius: 10, fontSize: 12, fontWeight: 500 }}>
                {l.language} {l.level ? `(${l.level})` : ''}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Décision admin antérieure (si appliquée) */}
      {(status === 'approved' || status === 'rejected') && (
        <section style={{ background: status === 'approved' ? '#DCFCE730' : '#FEE2E230', border: status === 'approved' ? '1px solid #86EFAC' : '1px solid #FECACA', borderRadius: 14, padding: '14px 18px', marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: status === 'approved' ? '#166534' : '#991B1B', marginBottom: 6 }}>
            {status === 'approved' ? t('admin_approved_label') : t('admin_rejected_label')}
          </div>
          {e.review_reason && <p style={{ fontSize: 13, color: '#334155', whiteSpace: 'pre-wrap', margin: 0 }}>{e.review_reason}</p>}
        </section>
      )}

      {/* Actions */}
      {status === 'pending_admin_review' && (
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          {!showReject ? (
            <>
              <button type="button" onClick={() => setShowReject(true)} disabled={busy !== null} style={{ padding: '10px 18px', background: 'transparent', color: '#64748b', border: '1px solid #cbd5e1', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>{t('button_reject')}</button>
              <button type="button" onClick={handleApprove} disabled={busy !== null} style={{ padding: '10px 22px', background: '#16A34A', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: busy === 'approve' ? 0.6 : 1 }}>{busy === 'approve' ? t('button_approving') : t('button_approve')}</button>
            </>
          ) : (
            <div style={{ flex: 1, background: '#FEF2F2', border: '1.5px solid #FECACA', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#991B1B', marginBottom: 8 }}>{t('reject_title')}</div>
              <textarea value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder={t('reject_placeholder')} maxLength={2000} rows={4} style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #FECACA', borderRadius: 8, outline: 'none', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', marginBottom: 10 }} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => { setShowReject(false); setReason('') }} disabled={busy !== null} style={{ padding: '8px 14px', background: 'transparent', color: '#64748b', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>{tCommon('cancel')}</button>
                <button type="button" onClick={handleReject} disabled={busy !== null} style={{ padding: '8px 14px', background: '#DC2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: busy === 'reject' ? 0.6 : 1 }}>{busy === 'reject' ? t('button_rejecting') : t('reject_confirm')}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
