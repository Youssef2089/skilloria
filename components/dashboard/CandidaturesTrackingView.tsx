'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useLiveResource } from '@/hooks/useLiveResource'
import {
  IconSend,
  IconLockOpen,
  IconClock,
  IconX,
  IconBuilding,
  IconTrophy,
} from '@tabler/icons-react'
import PageHeader from '@/components/ui/PageHeader'
import StatsStrip, { type Stat } from '@/components/ui/StatsStrip'
import StatusPill from '@/components/ui/StatusPill'
import MasterDetail from '@/components/ui/MasterDetail'
import EmptyState from '@/components/ui/EmptyState'
import CandidatureDetailPanel, {
  type Candidature,
} from '@/components/dashboard/CandidatureDetailPanel'
import {
  lifecycleToPillKind,
  useCandidatureLifecycleLabel,
} from '@/lib/candidatures/use-lifecycle-label'
import { useMarkCandidatureViewed } from '@/lib/candidature-view-client'
import { useRelativeTime } from '@/lib/use-relative-time'

/**
 * CandidaturesTrackingView — vue tracking des candidatures côté expert
 * (extrait SC7b Lot UX Finitions 2). Composant partagé entre
 * /dashboard/freelance/candidatures et /dashboard/cdi/candidatures. Seuls les
 * hrefs (messages/missions) varient via le paramètre `side`.
 *
 * Layout : PageHeader + StatsStrip + MasterDetail (filtres chips + cartes
 * liste à gauche + détail à droite avec timeline + meta + actions).
 * Polling 30s + focus + bump préservé.
 *
 * FILTRE (lot état de vie) : DEUX buckets, Actives et Archivées — c'est la
 * cible produit, pas cinq chips par statut brut. Le filtrage est fait par le
 * SERVEUR (`?filter=`), pas ici : le client demande un bucket et affiche ce
 * qu'on lui rend. Il ne peut pas montrer active ce que le serveur dit
 * archivé. ACTIVES PAR DÉFAUT. Les compteurs des deux onglets viennent de la
 * réponse (`counts`), donc jamais recomptés côté client.
 */

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; candidatures: Candidature[] }

type BucketKey = 'active' | 'archived'

export default function CandidaturesTrackingView({ side = 'freelance' }: { side?: 'freelance' | 'cdi' }) {
  const t = useTranslations('candidatures_tracking')
  const tPub = useTranslations('publications')
  // Pour la pill "Nouveau" cohérente avec MissionCard.
  const tMissionsCard = useTranslations('missions.card')
  const locale = useLocale()
  const relTime = useRelativeTime()
  const tLifecycle = useTranslations('candidature_lifecycle')
  const lifecycleLabel = useCandidatureLifecycleLabel('expert')
  const [bucket, setBucket] = useState<BucketKey>('active')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // useLiveResource : holdNewItems=false ici, les changements d'état
  // (échange ouvert / refus / expiration) doivent apparaître instantanément.
  // L'URL porte le bucket → changer d'onglet re-demande au SERVEUR.
  const live = useLiveResource<
    { candidatures: Candidature[]; counts?: { active: number; archived: number } },
    Candidature
  >({
    url: `/api/me/candidatures?locale=${encodeURIComponent(locale)}&filter=${bucket}`,
    itemsOf: (d) => d.candidatures ?? [],
    identityOf: (c) => c.id,
    // `lifecycle.reason` fait partie de la version : une candidature qui
    // bascule archivée (fenêtre écoulée) doit se rafraîchir sans clic.
    versionOf: (c) => `${c.status}|${c.lifecycle?.reason ?? ''}|${c.unlocked_at ?? ''}|${c.conversation_id ?? ''}`,
    holdNewItems: false,
  })
  const state = live.state
  const list = live.data?.candidatures ?? []
  const counts = live.data?.counts ?? { active: 0, archived: 0 }
  // Plus de filtrage client : la liste servie EST le bucket demandé.
  const filtered = list
  useEffect(() => {
    if (!selectedId && filtered.length > 0) setSelectedId(filtered[0].id)
    if (selectedId && !filtered.some((c) => c.id === selectedId) && filtered.length > 0) {
      setSelectedId(filtered[0].id)
    }
  }, [selectedId, filtered])
  // Lot bascule badges par item : ouvrir le DÉTAIL d'une candidature (clic
  // sur l'item du MasterDetail) la marque comme consultée pour cet user.
  // Le serveur upsert candidature_views ; useNavBadges revalide via
  // 'skilloria:notif-bump' dispatché dans le hook → badge -1 instantané.
  const markCandidatureViewed = useMarkCandidatureViewed()
  useEffect(() => {
    if (selectedId) {
      void markCandidatureViewed(selectedId)
    }
  }, [selectedId, markCandidatureViewed])
  const selected = selectedId ? list.find((c) => c.id === selectedId) ?? null : null

  // Stats DÉRIVÉES DES RAISONS servies, plus des statuts bruts : « Échanges
  // ouverts » ne doit compter que des fenêtres réellement ouvertes.
  const derived = useMemo(() => {
    let open = 0, wait = 0, scoreSum = 0, scoreN = 0
    for (const c of list) {
      if (c.lifecycle?.reason === 'exchange_open') open++
      else if (c.lifecycle?.reason === 'awaiting_review') wait++
      if (c.ai_match_score != null) { scoreSum += c.ai_match_score; scoreN++ }
    }
    const avgPct = scoreN > 0 ? Math.round((scoreSum / scoreN) * 10) : null
    return { open, wait, avgPct }
  }, [list])

  const stats: Stat[] = [
    { value: counts.active + counts.archived, label: t('stats.total') },
    { value: derived.open,  label: t('stats.open'),  emphasis: 'success' },
    { value: derived.wait,  label: t('stats.wait') },
    { value: derived.avgPct == null ? '—' : `${derived.avgPct}%`, label: t('stats.avg_score') },
  ]

  if (state.kind === 'loading') {
    return (
      <div style={{ padding: '24px 26px' }}>
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--sk-muted)' }}>{t('loading')}</div>
      </div>
    )
  }
  if (state.kind === 'error') {
    return (
      <div style={{ padding: '24px 26px' }}>
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <EmptyState icon="⚠️" title={state.message} surface="card" />
      </div>
    )
  }

  // DEUX buckets, pas cinq chips par statut : Actives (ce qui peut encore
  // bouger, sélection comprise) et Archivées (ce dont plus rien ne sortira,
  // toujours consultable). Compteurs servis par le serveur.
  const buckets: Array<{ key: BucketKey; label: string }> = [
    { key: 'active',   label: tLifecycle('filters.active_count',   { count: counts.active }) },
    { key: 'archived', label: tLifecycle('filters.archived_count', { count: counts.archived }) },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <StatsStrip stats={stats} />

      {list.length === 0 ? (
        <div style={{ padding: '0 26px 22px' }}>
          <EmptyState
            icon={<IconSend size={32} />}
            title={t('empty_title')}
            body={t('empty_subtitle')}
          />
        </div>
      ) : (
        <MasterDetail
          listWidth={392}
          detailVisible={selected !== null}
          list={
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                {buckets.map((f) => {
                  const on = bucket === f.key
                  return (
                    <button
                      key={f.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setBucket(f.key)}
                      style={{
                        fontSize: 12.5, fontWeight: 600, padding: '6px 13px',
                        borderRadius: 999,
                        color: on ? 'var(--sk-accent-ink)' : 'var(--sk-muted)',
                        background: on ? 'var(--sk-accent-soft)' : 'var(--sk-surface)',
                        border: on ? '1px solid transparent' : '1px solid var(--sk-border)',
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      {f.label}
                    </button>
                  )
                })}
              </div>

              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 11, paddingRight: 2 }}>
                {filtered.length === 0 ? (
                  <EmptyState
                    icon={bucket === 'archived' ? '🗂️' : '🔍'}
                    title={tLifecycle(bucket === 'archived' ? 'empty_archived_title' : 'empty_active_title')}
                    body={tLifecycle(bucket === 'archived' ? 'empty_archived_body' : 'empty_active_body')}
                    surface="card"
                  />
                ) : (
                  filtered.map((c) => {
                    const on = c.id === selectedId
                    // SITE DE RENDU 2/5 — teinte ET libellé viennent de la raison.
                    const pk = c.lifecycle ? lifecycleToPillKind(c.lifecycle.reason) : 'neutral'
                    const PIcon = pk === 'won' ? IconTrophy : pk === 'open' ? IconLockOpen : pk === 'refused' ? IconX : IconClock
                    // Lot bascule badges par item : "Nouveau" si pas encore
                    // consulté (et pas l'item actuellement sélectionné, qui
                    // sera marqué consulté à l'instant du clic via le useEffect).
                    const isUnviewed = c.viewed_by_me === false && !on
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedId(c.id)}
                        style={{
                          background: 'var(--sk-surface)',
                          border: on
                            ? `1px solid var(--sk-accent)`
                            : isUnviewed
                              ? `1.5px solid var(--sk-accent)`
                              : '1px solid var(--sk-border)',
                          boxShadow: on ? `0 0 0 3px var(--sk-accent-soft)` : undefined,
                          borderRadius: 'var(--sk-r-lg)',
                          padding: '15px 16px',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          textAlign: 'left',
                          width: '100%',
                          transition: 'border-color .12s, box-shadow .12s',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                          <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--sk-text)', lineHeight: 1.3, letterSpacing: '-0.2px', minWidth: 0 }}>
                            {c.publication?.title ?? '—'}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                            {c.ai_match_score != null && (
                              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--sk-accent-ink)', background: 'var(--sk-accent-soft)', padding: '3px 9px', borderRadius: 8 }}>
                                {Math.round(c.ai_match_score)}/10
                              </span>
                            )}
                            {isUnviewed && (
                              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--sk-accent-ink)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                                {tMissionsCard('new_label')}
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ color: 'var(--sk-muted)', fontSize: 12.5, marginTop: 4, display: 'flex', alignItems: 'center', gap: 7 }}>
                          <IconBuilding size={15} stroke={1.8} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {c.publication?.type === 'mission' ? tPub('type.mission') : c.publication?.type === 'offre' ? tPub('type.offre') : '—'}
                          </span>
                        </div>
                        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <StatusPill kind={pk} icon={<PIcon size={14} />} size="sm">
                            {lifecycleLabel(c.lifecycle, c.publication?.type)}
                          </StatusPill>
                          <span style={{ color: 'var(--sk-faint)', fontSize: 12 }}>{t('candidated_ago', { time: relTime(c.created_at) })}</span>
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </>
          }
          detail={
            selected ? (
              <CandidatureDetailPanel candidature={selected} side={side} />
            ) : (
              <div style={{ background: 'var(--sk-surface)', border: '1px solid var(--sk-border)', borderRadius: 'var(--sk-r-lg)', padding: '40px 24px', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center', color: 'var(--sk-muted)' }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }} aria-hidden>📨</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--sk-text)' }}>{t('detail_empty_title')}</div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>{t('detail_empty_subtitle')}</div>
                </div>
              </div>
            )
          }
        />
      )}
    </div>
  )
}
