'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'
import MissionCard, { type MissionCardData } from '@/components/dashboard/MissionCard'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'

/**
 * /dashboard/cdi/missions — feed des opportunités MATCHÉES (SC7b Lot UX
 * Finitions 2, miroir freelance avec side='cdi'). MissionCard gère le href
 * /dashboard/cdi/missions/[id]. Backend /api/me/missions partagé : les
 * matches n'ont pas de notion de "side", l'expert est unique côté DB.
 *
 * Tri serveur : score IA décroissant. Auto-vidant SC5 partagé.
 */

type FeedState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; missions: MissionCardData[] }

export default function CdiMissionsFeedPage() {
  const t = useTranslations('missions.feed')
  const locale = useLocale()
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
      console.error('[cdi missions feed] fetch threw', err)
      setState({ kind: 'error', message: t('error_generic') })
    }
  }, [locale, secureFetch, t])

  useEffect(() => {
    void load()
    // SC5 — auto-vidant du badge "Missions" (partagé avec freelance).
    void (async () => {
      try {
        const r = await secureFetch('/api/me/missions/mark-viewed', { method: 'POST' })
        if (r.ok) window.dispatchEvent(new CustomEvent('skilloria:notif-bump'))
      } catch (err) {
        console.error('[cdi missions feed] mark-viewed threw', err)
      }
    })()
  }, [load, secureFetch])

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
              <MissionCard key={m.match_id} mission={m} side="cdi" />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
