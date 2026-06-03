'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch } from '@/lib/secure-fetch'
import MissionCard, { type MissionCardData } from '@/components/dashboard/MissionCard'

/**
 * /dashboard/freelance/missions — feed des opportunités MATCHÉES.
 *
 * Le user ne parcourt pas les publications : il voit UNIQUEMENT les
 * opportunités que l'IA a sélectionnées pour lui (curation imposée par le
 * serveur ET par la RLS publications — cf. migration 20260603160000).
 *
 * Tri serveur : score IA décroissant.
 */

type FeedState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; missions: MissionCardData[] }

export default function MissionsFeedPage() {
  const t = useTranslations('missions.feed')
  const locale = useLocale()
  const router = useRouter()
  const domain = useDomain()
  const secureFetch = useSecureFetch()
  const [state, setState] = useState<FeedState>({ kind: 'loading' })

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const res = await secureFetch(`/api/me/missions?locale=${encodeURIComponent(locale)}`, {
        method: 'GET',
      })
      if (!res.ok) {
        setState({ kind: 'error', message: t('error_generic') })
        return
      }
      const payload = (await res.json().catch(() => ({}))) as { missions?: MissionCardData[] }
      setState({ kind: 'ready', missions: payload.missions ?? [] })
    } catch (err) {
      console.error('[missions feed] fetch threw', err)
      setState({ kind: 'error', message: t('error_generic') })
    }
  }, [locale, secureFetch, t])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px 24px', fontFamily: 'Inter, sans-serif' }}>
      <button
        type="button"
        onClick={() => router.push('/dashboard/freelance')}
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
        {t('back')}
      </button>

      <h1 style={{ fontSize: 26, fontWeight: 700, color: '#0f172a', marginBottom: 6, letterSpacing: '-0.3px' }}>
        {t('title')}
      </h1>
      <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24, lineHeight: 1.55 }}>
        {t('subtitle')}
      </p>

      {state.kind === 'loading' && (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 14 }}>{t('loading')}</div>
      )}

      {state.kind === 'error' && (
        <div role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '14px 18px', borderRadius: 12, fontSize: 13 }}>
          {state.message}
        </div>
      )}

      {state.kind === 'ready' && state.missions.length === 0 && (
        <div
          style={{
            background: '#fff',
            border: '0.5px solid #e5e7eb',
            borderRadius: 14,
            padding: '40px 24px',
            textAlign: 'center',
            color: '#64748b',
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>
            {t('empty_title')}
          </div>
          <div>{t('empty_subtitle')}</div>
        </div>
      )}

      {state.kind === 'ready' && state.missions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {state.missions.map((m) => (
            <MissionCard key={m.match_id} mission={m} />
          ))}
        </div>
      )}
    </div>
  )
}
