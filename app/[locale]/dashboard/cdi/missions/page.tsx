'use client'

import { useEffect, useRef } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import MissionCard, { type MissionCardData } from '@/components/dashboard/MissionCard'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import NewItemsPill from '@/components/ui/NewItemsPill'
import BoundedScrollList from '@/components/ui/BoundedScrollList'
import DndEmptyState from '@/components/dashboard/DndEmptyState'
import { useLiveResource } from '@/hooks/useLiveResource'
import { markSectionVisited } from '@/lib/section-visit-client'

/**
 * /dashboard/cdi/missions — feed des offres CDI MATCHÉES (parité freelance).
 * Layout flex column + BoundedScrollList (Lot F). Mobile <768px : scroll natif.
 *
 * Lot A : empty-state ROUGE conditionnel quand l'expert est en DND
 * (cdi_status='employed').
 *
 * Lot global C2 : pill "Nouveau" via snapshot last_visited_at (cf. variante
 * freelance pour le pattern complet).
 */

type MissionsPayload = {
  missions: MissionCardData[]
  expert_status?: { is_dnd: boolean }
  last_visited_at?: string | null
}

export default function CdiMissionsFeedPage() {
  const t = useTranslations('missions.feed')
  const locale = useLocale()

  const live = useLiveResource<MissionsPayload, MissionCardData>({
    url: `/api/me/missions?locale=${encodeURIComponent(locale)}`,
    itemsOf: (d) => d.missions ?? [],
    identityOf: (m) => m.match_id,
    versionOf: (m) => `${m.match_status}|${m.ai_score}`,
    holdNewItems: true,
    // Lot global C1 : si is_dnd change (Réactiver → false, ou DND → true),
    // on force l'update de `displayed` sans passer par le "hold". Sinon le
    // passage DND→À l'écoute ne propagerait jamais les missions à la liste.
    metadataHash: (d) => String(d.expert_status?.is_dnd ?? false),
  })
  const state = live.state
  const missions = live.data?.missions ?? []
  const isDnd = !!live.data?.expert_status?.is_dnd

  // Lot global C2 : snapshot du last_visited_at figé à la 1re réponse.
  const snapshotRef = useRef<string | null | undefined>(undefined)
  if (snapshotRef.current === undefined && live.data?.last_visited_at !== undefined) {
    snapshotRef.current = live.data.last_visited_at
  }

  useEffect(() => {
    void markSectionVisited('missions')
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '24px 26px' }}>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {state.kind === 'loading' && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--sk-muted)', fontSize: 14 }}>{t('loading')}</div>
      )}

      {state.kind === 'error' && (
        <div role="alert" style={{ background: 'var(--sk-red-soft)', border: '1px solid var(--sk-red)', color: 'var(--sk-red)', padding: '14px 18px', borderRadius: 'var(--sk-r-lg)', fontSize: 13, marginTop: 14 }}>
          {state.message}
        </div>
      )}

      {state.kind === 'ready' && missions.length === 0 && (
        <div style={{ marginTop: 14 }}>
          {isDnd ? (
            <DndEmptyState side="cdi" />
          ) : (
            <EmptyState
              icon="🎯"
              title={t('empty_title')}
              body={t('empty_subtitle')}
            />
          )}
        </div>
      )}

      {state.kind === 'ready' && missions.length > 0 && (
        <BoundedScrollList
          stickyHeader={
            <NewItemsPill
              count={live.pendingCount}
              onApply={live.applyPending}
              variant="offres"
            />
          }
        >
          {missions.map((m) => (
            <MissionCard
              key={m.match_id}
              mission={m}
              side="cdi"
              isNew={isMatchNewerThanSnapshot(m.matched_at, snapshotRef.current ?? null)}
            />
          ))}
        </BoundedScrollList>
      )}
    </div>
  )
}

function isMatchNewerThanSnapshot(matchedAt: string, snapshot: string | null): boolean {
  if (!snapshot) return true
  const m = new Date(matchedAt).getTime()
  const s = new Date(snapshot).getTime()
  if (Number.isNaN(m) || Number.isNaN(s)) return false
  return m > s
}
