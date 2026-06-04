'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch } from '@/lib/secure-fetch'
import CandidatureModal from '@/components/dashboard/CandidatureModal'

/**
 * /dashboard/freelance/missions/[id] — détail d'une opportunité matchée.
 *
 * Charge le détail via GET /api/me/missions/[id] (qui flippe atomiquement
 * notif read + match notified→viewed côté serveur).
 *
 * Actions :
 *  - Candidater (POST /api/candidatures avec cover_message optionnel)
 *  - Décliner (POST /api/me/missions/[id]/dismiss → retour feed)
 */

type Props = { params: Promise<{ id: string }> }

type DetailData = {
  match: { id: string; status: string; ai_score: number; ai_reason: string | null; matched_at: string }
  publication: {
    id: string
    type: string
    title: string
    description: string
    branch_label: string | null
    speciality_label: string | null
    skills_required: string[]
    seniority: string | null
    work_mode: string | null
    location: string | null
    duration: string | null
    start_date: string | null
    budget_min: number | null
    budget_max: number | null
    confidential: boolean
    published_at: string | null
  }
  org: { name: string | null; logo_url: string | null } | null
  candidature: { id: string; status: string; created_at: string; cover_message: string | null } | null
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: DetailData }

type TForm = ReturnType<typeof useTranslations<'publications.form'>>

function translateSeniority(code: string, tForm: TForm): string {
  switch (code) {
    case 'junior':    return tForm('seniority_options.junior')
    case 'confirmed': return tForm('seniority_options.confirmed')
    case 'senior':    return tForm('seniority_options.senior')
    case 'expert':    return tForm('seniority_options.expert')
    default: return code
  }
}

function translateWorkMode(code: string, tForm: TForm): string {
  switch (code) {
    case 'remote': return tForm('work_mode_options.remote')
    case 'onsite': return tForm('work_mode_options.onsite')
    case 'hybrid': return tForm('work_mode_options.hybrid')
    default: return code
  }
}

function formatBudget(min: number | null, max: number | null, type: string, locale: string): string {
  if (min == null && max == null) return ''
  const unitMap: Record<string, Record<string, string>> = {
    fr: { mission: '/jour', offre: '/an' },
    en: { mission: '/day', offre: '/year' },
    es: { mission: '/día', offre: '/año' },
    de: { mission: '/Tag', offre: '/Jahr' },
  }
  const unit = unitMap[locale]?.[type] ?? unitMap.fr[type] ?? ''
  if (min != null && max != null) return `${Math.round(min)}-${Math.round(max)}€${unit}`
  if (min != null) return `${Math.round(min)}€${unit}`
  return `${Math.round(max!)}€${unit}`
}

export default function MissionDetailPage({ params }: Props) {
  const t = useTranslations('missions.detail')
  const tPub = useTranslations('publications')
  const tForm = useTranslations('publications.form')
  const locale = useLocale()
  const router = useRouter()
  const domain = useDomain()
  const secureFetch = useSecureFetch()

  const [pubId, setPubId] = useState<string | null>(null)
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [coverOpen, setCoverOpen] = useState(false)
  const [coverMessage, setCoverMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  const [successBanner, setSuccessBanner] = useState<string | null>(null)
  const [dismissing, setDismissing] = useState(false)

  const load = useCallback(async (id: string) => {
    setState({ kind: 'loading' })
    setErrorBanner(null)
    try {
      const res = await secureFetch(`/api/me/missions/${id}?locale=${encodeURIComponent(locale)}`, {
        method: 'GET',
      })
      const payload = (await res.json().catch(() => ({} as { code?: string }))) as Record<string, unknown> & { code?: string }
      if (!res.ok) {
        const code = payload.code as string | undefined
        const message =
          code === 'not_found' ? t('error_not_found') :
          code === 'org_required' ? t('error_generic') :
          t('error_generic')
        setState({ kind: 'error', message })
        return
      }
      setState({ kind: 'ready', data: payload as unknown as DetailData })
    } catch (err) {
      console.error('[mission detail] fetch threw', err)
      setState({ kind: 'error', message: t('error_generic') })
    }
  }, [locale, secureFetch, t])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const p = await params
      if (cancelled) return
      setPubId(p.id)
      void load(p.id)
    })()
    return () => { cancelled = true }
  }, [params, load])

  // ── Actions ─────────────────────────────────────────────────────────────
  // SC3 : handleSubmitCandidature accepte le cover_message en paramètre
  //  (envoyé par CandidatureModal via onSubmit). Le state local coverMessage
  //  reste pour rétrocompat mais n'est plus la source de vérité.
  const handleSubmitCandidature = async (coverFromModal?: string | null) => {
    if (!pubId) return
    setErrorBanner(null)
    setSuccessBanner(null)
    const cover = coverFromModal !== undefined ? coverFromModal : (coverMessage.trim() || null)
    if (cover && cover.length > 2000) {
      setErrorBanner(t('error_cover_too_long'))
      return
    }
    setSubmitting(true)
    try {
      const res = await secureFetch('/api/candidatures', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          publication_id: pubId,
          cover_message: cover,
        }),
      })
      const payload = (await res.json().catch(() => ({} as { code?: string }))) as { code?: string; status?: string }
      if (!res.ok) {
        if (payload.code === 'already_applied') setErrorBanner(t('error_already_applied'))
        else if (payload.code === 'not_matched') setErrorBanner(t('error_not_matched'))
        else if (payload.code === 'publication_not_published') setErrorBanner(t('error_not_published'))
        else if (payload.code === 'invalid_cover_message') setErrorBanner(t('error_cover_too_long'))
        else setErrorBanner(t('error_generic'))
        return
      }
      setSuccessBanner(t('success_applied'))
      setCoverOpen(false)
      setCoverMessage('')
      if (pubId) await load(pubId)
    } catch (err) {
      console.error('[candidatures POST] threw', err)
      setErrorBanner(t('error_generic'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDismiss = async () => {
    if (!pubId) return
    setDismissing(true)
    try {
      const res = await secureFetch(`/api/me/missions/${pubId}/dismiss`, { method: 'POST' })
      if (res.ok) router.push('/dashboard/freelance/missions')
      else setErrorBanner(t('error_generic'))
    } catch (err) {
      console.error('[mission dismiss] threw', err)
      setErrorBanner(t('error_generic'))
    } finally {
      setDismissing(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  if (state.kind === 'loading') {
    return <div style={{ padding: 48, textAlign: 'center', color: '#64748b', fontFamily: 'Inter, sans-serif' }}>{t('loading')}</div>
  }

  if (state.kind === 'error') {
    return (
      <div style={{ maxWidth: 560, margin: '60px auto', padding: '0 24px', textAlign: 'center', fontFamily: 'Inter, sans-serif' }}>
        <p style={{ fontSize: 14, color: '#b91c1c', marginBottom: 18 }}>{state.message}</p>
        <button
          type="button"
          onClick={() => router.push('/dashboard/freelance/missions')}
          style={{
            padding: '10px 18px',
            background: domain.primaryColor,
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {t('back_to_feed')}
        </button>
      </div>
    )
  }

  const { match, publication: pub, org, candidature } = state.data
  const orgName = pub.confidential ? t('confidential_org') : org?.name ?? t('confidential_org')
  const budgetText = formatBudget(pub.budget_min, pub.budget_max, pub.type, locale)
  const alreadyApplied = !!candidature

  return (
    <div style={{ maxWidth: 980, padding: '24px 26px' }}>
      <button
        type="button"
        onClick={() => router.push('/dashboard/freelance/missions')}
        style={{
          background: 'transparent',
          border: 'none',
          color: domain.primaryColor,
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          padding: 0,
          marginBottom: 18,
        }}
      >
        {t('back_to_feed')}
      </button>

      {errorBanner && (
        <div role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '12px 16px', borderRadius: 10, fontSize: 13, marginBottom: 18 }}>
          {errorBanner}
        </div>
      )}

      {successBanner && (
        <div role="status" style={{ background: '#DCFCE7', border: '1px solid #86EFAC', color: '#166534', padding: '12px 16px', borderRadius: 10, fontSize: 13, marginBottom: 18 }}>
          {successBanner}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 500 }}>{tPub(`type.${pub.type}`)}</span>
            <span aria-hidden>·</span>
            <span>{orgName}</span>
            {pub.confidential && <span aria-hidden title={t('confidential_tooltip')}>🔒</span>}
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#0f172a', lineHeight: 1.25, letterSpacing: '-0.3px', marginBottom: 8 }}>
            {pub.title}
          </h1>
          <div style={{ fontSize: 13, color: '#475569' }}>
            {[pub.branch_label, pub.speciality_label, budgetText].filter(Boolean).join(' · ')}
          </div>
        </div>
        <span
          title={t('ai_score_tooltip')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '6px 14px',
            background: `${domain.primaryColor}1A`,
            color: domain.primaryColor,
            fontSize: 13,
            fontWeight: 700,
            borderRadius: 14,
            flexShrink: 0,
          }}
        >
          {t('ai_score_label', { score: Math.round(match.ai_score) })}
        </span>
      </div>

      {/* AI reason — pourquoi ça vous correspond */}
      {match.ai_reason && (
        <div
          style={{
            background: `${domain.primaryColor}0A`,
            border: `1px solid ${domain.primaryColor}33`,
            borderRadius: 12,
            padding: '14px 16px',
            fontSize: 13,
            color: '#334155',
            lineHeight: 1.6,
            marginBottom: 22,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: domain.primaryColor, marginBottom: 6 }}>
            {t('why_match_label')}
          </div>
          {match.ai_reason}
        </div>
      )}

      {/* Description */}
      <section style={{ background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: 14, padding: '20px 22px', marginBottom: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#64748b', marginBottom: 12 }}>
          {t('section_description')}
        </div>
        <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}>
          {pub.description}
        </p>
      </section>

      {/* Details grid */}
      <section style={{ background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: 14, padding: '20px 22px', marginBottom: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#64748b', marginBottom: 14 }}>
          {t('section_details')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, fontSize: 13 }}>
          {pub.seniority && (
            <div><div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>{tForm('field_seniority')}</div><div>{translateSeniority(pub.seniority, tForm)}</div></div>
          )}
          {pub.work_mode && (
            <div><div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>{tForm('field_work_mode')}</div><div>{translateWorkMode(pub.work_mode, tForm)}</div></div>
          )}
          {pub.location && (
            <div><div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>{tForm('field_location')}</div><div>{pub.location}</div></div>
          )}
          {pub.duration && (
            <div><div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>{tForm('field_duration')}</div><div>{pub.duration}</div></div>
          )}
          {pub.start_date && (
            <div><div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>{tForm('field_start_date')}</div><div>{pub.start_date}</div></div>
          )}
          {budgetText && (
            <div><div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>{t('budget_label')}</div><div>{budgetText}</div></div>
          )}
        </div>
        {pub.skills_required.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 6 }}>{tForm('field_skills')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {pub.skills_required.map((skill) => (
                <span key={skill} style={{ background: '#f1f5f9', color: '#334155', padding: '4px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500 }}>{skill}</span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Actions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'flex-end', marginTop: 24 }}>
        {!alreadyApplied && (
          <button
            type="button"
            onClick={handleDismiss}
            disabled={dismissing}
            style={{
              padding: '12px 20px',
              background: 'transparent',
              color: '#64748b',
              border: '1px solid #cbd5e1',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              cursor: dismissing ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              opacity: dismissing ? 0.5 : 1,
            }}
          >
            {dismissing ? t('button_dismissing') : t('button_dismiss')}
          </button>
        )}
        {alreadyApplied ? (
          <div style={{ padding: '12px 20px', background: '#DCFCE7', color: '#166534', border: '1px solid #86EFAC', borderRadius: 10, fontSize: 13, fontWeight: 600 }}>
            ✓ {t('already_applied')}
          </div>
        ) : !coverOpen ? (
          <button
            type="button"
            onClick={() => setCoverOpen(true)}
            style={{
              padding: '12px 22px',
              background: domain.primaryColor,
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('button_apply')}
          </button>
        ) : null}
      </div>

      {/* SC3 — Modal réutilisable (remplace l'inline form). Logique POST
          inchangée : handleSubmitCandidature accepte le cover_message du modal
          et appelle /api/candidatures comme avant. */}
      <CandidatureModal
        open={coverOpen && !alreadyApplied}
        publicationTitle={pub.title}
        onClose={() => { setCoverOpen(false); setCoverMessage(''); setErrorBanner(null) }}
        onSubmit={async (cm) => { await handleSubmitCandidature(cm) }}
        busy={submitting}
        error={errorBanner}
      />
    </div>
  )
}
