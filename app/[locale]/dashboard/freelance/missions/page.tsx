'use client'

import { useLocale, useTranslations } from 'next-intl'
import MissionCard, { type MissionCardData } from '@/components/dashboard/MissionCard'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import NewItemsPill from '@/components/ui/NewItemsPill'
import DndEmptyState from '@/components/dashboard/DndEmptyState'
import SpotlightCarousel from '@/components/dashboard/SpotlightCarousel'
import { useLiveResource } from '@/hooks/useLiveResource'

/**
 * /dashboard/freelance/missions — feed des opportunités MATCHÉES.
 *
 * Vue « casting sous projecteur » (shell partagé SpotlightCarousel) : une
 * carte mission centrée en pleine lumière, les voisines en retrait/atténuées,
 * navigation flèches/clavier/swipe + compteur "X / N · Trié par score".
 * Les missions arrivent déjà triées par score DESC côté /api/me/missions.
 *
 * Lot A : empty-state ROUGE conditionnel quand l'expert est en DND
 * (via expert_status.is_dnd côté serveur).
 *
 * Lot bascule badges par item : la pill "Nouveau" sur chaque carte est
 * dérivée de `match.status` ∈ {pending, notified} côté MissionCard (source
 * unique DB). L'ouverture du détail flippe vers 'viewed' → la pill disparaît
 * et le badge nav décrémente. Le défilement du casting NE marque RIEN comme vu.
 */

type MissionsPayload = {
  missions: MissionCardData[]
  expert_status?: { is_dnd: boolean }
}

export default function MissionsFeedPage() {
  const t = useTranslations('missions.feed')
  const tc = useTranslations('missions.casting')
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
            <DndEmptyState side="freelance" />
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
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
          <NewItemsPill
            count={live.pendingCount}
            onApply={live.applyPending}
            variant="missions"
          />
          <SpotlightCarousel<MissionCardData>
            items={missions}
            getKey={(m) => m.match_id}
            labels={{
              formatCounter: (current, total) => tc('counter', { current, total }),
              sortedByScore: tc('sorted_by_score'),
              prevAria: tc('prev_aria'),
              nextAria: tc('next_aria'),
              paginationAria: tc('pagination_aria'),
              gotoAria: (index) => tc('goto_aria', { index }),
              empty: tc('empty'),
            }}
            renderItem={(m, { isCenter }) => (
              <div style={{ width: isCenter ? 'min(480px, 92vw)' : '100%' }}>
                <MissionCard mission={m} side="freelance" />
              </div>
            )}
          />
        </div>
      )}
    </div>
  )
}
