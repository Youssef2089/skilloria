'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /dashboard/freelance/candidatures — suivi par mission (Point 3 finitions UX).
 *
 * Liste les candidatures de l'expert courant via GET /api/me/candidatures.
 * Chaque carte = 1 mission + statut humain + actions contextuelles selon
 * l'état :
 *   - received / in_review / shortlisted → "En attente de réponse"
 *   - unlocked                            → bouton "Ouvrir la conversation"
 *   - rejected                            → motif (review_reason) si présent
 *
 * Polling 30s + revalidate-on-focus + écoute 'skilloria:notif-bump'.
 */

type Candidature = {
  id: string
  publication_id: string
  publication: { id: string; type: string; title: string; status: string } | null
  status: string
  status_reason: string | null
  ai_match_score: number | null
  unlocked_at: string | null
  cover_message: string | null
  created_at: string
  conversation_id: string | null
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; candidatures: Candidature[] }

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

function statusColor(status: string, domainPrimary: string): { bg: string; fg: string } {
  switch (status) {
    case 'unlocked':    return { bg: '#DCFCE7', fg: '#166534' }
    case 'rejected':    return { bg: '#FEE2E2', fg: '#991B1B' }
    case 'shortlisted': return { bg: `${domainPrimary}1A`, fg: domainPrimary }
    case 'in_review':   return { bg: '#FEF9C3', fg: '#854D0E' }
    case 'received':    return { bg: '#DBEAFE', fg: '#1E40AF' }
    default:            return { bg: '#f1f5f9', fg: '#475569' }
  }
}

export default function FreelanceCandidaturesPage() {
  const t = useTranslations('candidatures_tracking')
  const tPub = useTranslations('publications')
  const locale = useLocale()
  const router = useRouter()
  const domain = useDomain()
  const secureFetch = useSecureFetch()
  const [state, setState] = useState<State>({ kind: 'loading' })

  const load = useCallback(async (silent: boolean) => {
    if (!silent) setState({ kind: 'loading' })
    try {
      const res = await secureFetch('/api/me/candidatures', { method: 'GET' })
      if (!res.ok) {
        if (!silent) setState({ kind: 'error', message: t('error_generic') })
        return
      }
      const payload = (await res.json()) as { candidatures?: Candidature[] }
      setState({ kind: 'ready', candidatures: payload.candidatures ?? [] })
    } catch (err) {
      if (!silent) {
        console.error('[candidatures tracking] load threw', err)
        setState({ kind: 'error', message: t('error_generic') })
      }
    }
  }, [secureFetch, t])

  useEffect(() => {
    void load(false)
    const intervalId = window.setInterval(() => { void load(true) }, 30_000)
    const onFocus = () => { void load(true) }
    const onNotifBump = () => { void load(true) }
    window.addEventListener('focus', onFocus)
    window.addEventListener('skilloria:notif-bump', onNotifBump)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('skilloria:notif-bump', onNotifBump)
    }
  }, [load])

  if (state.kind === 'loading') {
    return <div style={{ padding: 48, textAlign: 'center', color: '#64748b', fontFamily: 'Inter, sans-serif' }}>{t('loading')}</div>
  }
  if (state.kind === 'error') {
    return (
      <div style={{ maxWidth: 560, margin: '60px auto', padding: '0 24px', textAlign: 'center', fontFamily: 'Inter, sans-serif' }}>
        <p style={{ fontSize: 14, color: '#b91c1c', marginBottom: 18 }}>{state.message}</p>
        <button
          type="button"
          onClick={() => router.push('/dashboard/freelance')}
          style={{ padding: '10px 18px', background: domain.primaryColor, color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {t('back_to_dashboard')}
        </button>
      </div>
    )
  }

  const { candidatures } = state

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px 24px 60px', fontFamily: 'Inter, sans-serif' }}>
      <button
        type="button"
        onClick={() => router.push('/dashboard/freelance')}
        style={{ background: 'transparent', border: 'none', color: domain.primaryColor, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0, marginBottom: 18 }}
      >
        {t('back_to_dashboard')}
      </button>

      <h1 style={{ fontSize: 26, fontWeight: 700, color: '#0f172a', marginBottom: 6, letterSpacing: '-0.3px' }}>{t('title')}</h1>
      <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24, lineHeight: 1.55 }}>{t('subtitle')}</p>

      {candidatures.length === 0 ? (
        <div
          style={{
            background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: 14,
            padding: '40px 24px', textAlign: 'center', color: '#64748b', fontSize: 14, lineHeight: 1.6,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>{t('empty_title')}</div>
          <div>{t('empty_subtitle')}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {candidatures.map((c) => {
            const colors = statusColor(c.status, domain.primaryColor)
            const isUnlocked = c.status === 'unlocked'
            const isRejected = c.status === 'rejected'
            return (
              <article
                key={c.id}
                style={{
                  background: '#fff',
                  border: isUnlocked ? `1.5px solid ${domain.primaryColor}` : '0.5px solid #e5e7eb',
                  borderRadius: 14,
                  padding: '18px 20px',
                  opacity: isRejected ? 0.7 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 10 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 4, lineHeight: 1.35 }}>
                      {c.publication?.title ?? '—'}
                    </h3>
                    <div style={{ fontSize: 12, color: '#64748b', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      {c.publication?.type && <span style={{ fontWeight: 500 }}>{tPub(`type.${c.publication.type}`)}</span>}
                      <span aria-hidden>·</span>
                      <span>{t('candidated_ago', { time: relativeFromNow(c.created_at, locale) })}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                    {c.ai_match_score != null && (
                      <span style={{ padding: '3px 9px', background: `${domain.primaryColor}1A`, color: domain.primaryColor, fontSize: 11, fontWeight: 700, borderRadius: 10 }}>
                        {Math.round(c.ai_match_score)}/10
                      </span>
                    )}
                    <span style={{ padding: '3px 10px', background: colors.bg, color: colors.fg, fontSize: 11, fontWeight: 600, borderRadius: 10, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                      {t(`status.${c.status}` as 'status.received')}
                    </span>
                  </div>
                </div>

                {/* État contextualisé */}
                {!isUnlocked && !isRejected && (
                  <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.55, margin: '8px 0 0' }}>
                    {t('waiting_for_org')}
                  </p>
                )}

                {isUnlocked && c.unlocked_at && (
                  <p style={{ fontSize: 13, color: '#166534', lineHeight: 1.55, margin: '8px 0 0' }}>
                    {t('unlocked_since', { time: relativeFromNow(c.unlocked_at, locale) })}
                  </p>
                )}

                {isRejected && c.status_reason && (
                  <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: '#991B1B', lineHeight: 1.5, marginTop: 10 }}>
                    <strong>{t('rejection_reason_label')}</strong> {c.status_reason}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
                  {c.publication?.id && (
                    <Link
                      href={`/dashboard/freelance/missions/${c.publication.id}`}
                      style={{ padding: '8px 14px', background: 'transparent', color: '#475569', border: '1px solid #cbd5e1', borderRadius: 9, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}
                    >
                      {t('view_mission')}
                    </Link>
                  )}
                  {isUnlocked && c.conversation_id && (
                    <Link
                      href={`/dashboard/freelance/messages/${c.conversation_id}`}
                      style={{ padding: '8px 18px', background: domain.primaryColor, color: '#fff', border: 'none', borderRadius: 9, fontSize: 12, fontWeight: 700, textDecoration: 'none' }}
                    >
                      💬 {t('open_conversation')}
                    </Link>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
