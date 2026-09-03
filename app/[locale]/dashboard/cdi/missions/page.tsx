'use client'

import { useLocale, useTranslations } from 'next-intl'
import MissionCard, { type MissionCardData } from '@/components/dashboard/MissionCard'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import NewItemsPill from '@/components/ui/NewItemsPill'
import BoundedScrollList from '@/components/ui/BoundedScrollList'
import DndEmptyState from '@/components/dashboard/DndEmptyState'
import { useLiveResource } from '@/hooks/useLiveResource'

/**
 * /dashboard/cdi/missions — feed des offres CDI MATCHÉES (parité freelance).
 * Layout flex column + BoundedScrollList. Mobile <768px : scroll natif.
 *
 * Lot A : empty-state ROUGE conditionnel quand l'expert est en DND
 * (cdi_status='employed').
 *
 * Lot bascule badges par item : la pill "Nouveau" est dérivée de
 * `match.status` côté MissionCard. L'ouverture du détail flippe vers
 * 'viewed' → la pill disparaît et le badge nav décrémente.
 */

type MissionsPayload = {
  missions: MissionCardData[]
  expert_status?: { is_dnd: boolean }
}

export default function CdiMissionsFeedPage() {
  const t = useTranslations('missions.feed')
  // Réutilise la clé i18n existante du tableau de bord CDI pour l'état "profil
  // pas encore validé" (message cohérent avec la section "Suggestions").
  const tDash = useTranslations('dashboard_cdi')
  const locale = useLocale()

  const live = useLiveResource<MissionsPayload, MissionCardData>({
    url: `/api/me/missions?locale=${encodeURIComponent(locale)}`,
    itemsOf: (d) => d.missions ?? [],
    identityOf: (m) => m.match_id,
    versionOf: (m) => `${m.match_status}|${m.relevance_tier}`,
    holdNewItems: true,
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

      {/* Profil pas encore validé (403 not_verified) : état vide propre, jamais
          une erreur — message cohérent avec le tableau de bord. */}
      {state.kind === 'error' && state.status === 403 && (
        <div style={{ marginTop: 14 }}>
          <EmptyState icon="🔒" title={tDash('suggestions_section.empty_unverified')} />
        </div>
      )}

      {state.kind === 'error' && state.status !== 403 && (
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
            <MissionCard key={m.match_id} mission={m} side="cdi" />
          ))}
        </BoundedScrollList>
      )}
    </div>
  )
}
