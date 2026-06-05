'use client'

import { useLocale, useTranslations } from 'next-intl'
import MissionCard, { type MissionCardData } from '@/components/dashboard/MissionCard'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import NewItemsPill from '@/components/ui/NewItemsPill'
import { useLiveResource } from '@/hooks/useLiveResource'

/**
 * /dashboard/cdi/missions — feed des offres CDI MATCHÉES (parité freelance).
 * Live revalidation SWR + pastille "N nouvelle offre" (holdNewItems=true).
 */

export default function CdiMissionsFeedPage() {
  const t = useTranslations('missions.feed')
  const locale = useLocale()

  const live = useLiveResource<{ missions: MissionCardData[] }, MissionCardData>({
    url: `/api/me/missions?locale=${encodeURIComponent(locale)}`,
    itemsOf: (d) => d.missions ?? [],
    identityOf: (m) => m.match_id,
    versionOf: (m) => `${m.match_status}|${m.ai_score}`,
    holdNewItems: true,
  })
  const state = live.state
  const missions = live.data?.missions ?? []

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

        {state.kind === 'ready' && missions.length === 0 && (
          <EmptyState
            icon="🎯"
            title={t('empty_title')}
            body={t('empty_subtitle')}
          />
        )}

        {state.kind === 'ready' && missions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <NewItemsPill
              count={live.pendingCount}
              onApply={live.applyPending}
              variant="offres"
            />
            {missions.map((m) => (
              <MissionCard key={m.match_id} mission={m} side="cdi" />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
