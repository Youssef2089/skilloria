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
import { useMarkSectionVisited } from '@/lib/section-visit-client'

/**
 * /dashboard/freelance/missions — feed des opportunités MATCHÉES.
 *
 * Layout flex column height:100% → BoundedScrollList prend la hauteur
 * disponible du <main> shell (qui est lui-même flex:1; overflow:auto).
 * Sur mobile <768px, la borne se désactive et la page scrolle naturellement.
 *
 * Lot A : empty-state ROUGE conditionnel quand l'expert est en DND
 * (via expert_status.is_dnd côté serveur).
 *
 * Lot global C2 : pill "Nouveau" sur chaque carte = matched_at > snapshot
 * du last_visited_at capturé à la 1re réponse. Pattern "freeze pendant la
 * session" : la pill reste visible le temps qu'on consulte, et s'efface à
 * la prochaine ouverture de la section (POST /api/me/section-visit advances
 * la DB → snapshot suivant ≥ matched_at).
 */

type MissionsPayload = {
  missions: MissionCardData[]
  expert_status?: { is_dnd: boolean }
  /** Lot global C2 : snapshot du last_visited_at AVANT POST section-visit. */
  last_visited_at?: string | null
}

export default function MissionsFeedPage() {
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
  //   - 1re fetch : on capture la valeur DB AVANT que markSectionVisited ne
  //     l'avance. Tous les matches avec matched_at > snapshot sont "Nouveau".
  //   - Polls suivants : on IGNORE la nouvelle valeur (le ref reste figé) →
  //     les pills ne disparaissent pas en cours de session.
  const snapshotRef = useRef<string | null | undefined>(undefined)
  if (snapshotRef.current === undefined && live.data?.last_visited_at !== undefined) {
    snapshotRef.current = live.data.last_visited_at
  }

  // Lot global C2 : mark section visited au mount.
  // POST via useSecureFetch (Authorization: Bearer requis par requireAuth)
  // — sinon 401 silencieux et la ligne user_section_visits n'est pas créée.
  // Le snapshot est déjà figé avant ; cet appel n'affecte QUE le badge nav
  // (passe à 0 immédiatement) et le snapshot de la PROCHAINE visite.
  const markVisited = useMarkSectionVisited()
  useEffect(() => {
    void markVisited('missions')
  }, [markVisited])

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
        <BoundedScrollList
          stickyHeader={
            <NewItemsPill
              count={live.pendingCount}
              onApply={live.applyPending}
              variant="missions"
            />
          }
        >
          {missions.map((m) => (
            <MissionCard
              key={m.match_id}
              mission={m}
              isNew={isMatchNewerThanSnapshot(m.matched_at, snapshotRef.current ?? null)}
            />
          ))}
        </BoundedScrollList>
      )}
    </div>
  )
}

/**
 * is_new = matched_at > snapshot_last_visited_at. Si snapshot null
 * (l'utilisateur n'a JAMAIS ouvert la section), TOUS les matches comptent
 * comme nouveaux (défaut produit cohérent avec /api/me/badges).
 */
function isMatchNewerThanSnapshot(matchedAt: string, snapshot: string | null): boolean {
  if (!snapshot) return true
  const m = new Date(matchedAt).getTime()
  const s = new Date(snapshot).getTime()
  if (Number.isNaN(m) || Number.isNaN(s)) return false
  return m > s
}
