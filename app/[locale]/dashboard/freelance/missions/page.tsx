'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'
import MissionCard, { type MissionCardData } from '@/components/dashboard/MissionCard'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'

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
  const secureFetch = useSecureFetch()
  const [state, setState] = useState<FeedState>({ kind: 'loading' })

  const load = useCallback(async (silent: boolean) => {
    if (!silent) setState({ kind: 'loading' })
    try {
      const res = await secureFetch(`/api/me/missions?locale=${encodeURIComponent(locale)}`, {
        method: 'GET',
      })
      if (!res.ok) {
        if (!silent) setState({ kind: 'error', message: t('error_generic') })
        return
      }
      const payload = (await res.json().catch(() => ({}))) as { missions?: MissionCardData[] }
      setState({ kind: 'ready', missions: payload.missions ?? [] })
    } catch (err) {
      console.error('[missions feed] fetch threw', err)
      if (!silent) setState({ kind: 'error', message: t('error_generic') })
    }
  }, [locale, secureFetch, t])

  useEffect(() => {
    void load(false)
    // Fraîcheur feed (parité MessagesInbox / CandidaturesTrackingView) :
    // polling 30s + revalidation au focus + listener 'skilloria:notif-bump'
    // émis par NotificationBell quand une nouvelle notif apparaît
    // (e.g. new_match_opportunity créée par runMatching à la publication).
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

  return (
    <div style={{ padding: '24px 26px' }}>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <div style={{ padding: '14px 0 0' }}>
        {state.kind === 'loading' && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--sk-muted)', fontSize: 14 }}>{t('loading')}</div>
        )}

        {state.kind === 'error' && (
          <div role="alert" style={{ background: 'var(--sk-red-soft)', border: '1px solid var(--sk-red)', color: 'var(--sk-red)', padding: '14px 18px', borderRadius: 'var(--sk-r-lg)', fontSize: 13 }}>
            {state.message}
          </div>
        )}

        {state.kind === 'ready' && state.missions.length === 0 && (
          <EmptyState
            icon="🎯"
            title={t('empty_title')}
            body={t('empty_subtitle')}
          />
        )}

        {state.kind === 'ready' && state.missions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {state.missions.map((m) => (
              <MissionCard key={m.match_id} mission={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
