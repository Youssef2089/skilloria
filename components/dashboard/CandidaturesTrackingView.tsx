'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useLiveResource } from '@/hooks/useLiveResource'
import {
  IconSend,
  IconSparkles,
  IconLockOpen,
  IconClock,
  IconX,
  IconBuilding,
  IconMessage2,
  IconExternalLink,
  IconTrophy,
} from '@tabler/icons-react'
import PageHeader from '@/components/ui/PageHeader'
import StatsStrip, { type Stat } from '@/components/ui/StatsStrip'
import StatusPill from '@/components/ui/StatusPill'
import MasterDetail from '@/components/ui/MasterDetail'
import EmptyState from '@/components/ui/EmptyState'
import TimelineStep from '@/components/ui/TimelineStep'
import PublicationSynthesisLine, { type PublicationSynthesisData } from '@/components/dashboard/PublicationSynthesisLine'
import { useMarkCandidatureViewed } from '@/lib/candidature-view-client'

/**
 * CandidaturesTrackingView — vue tracking des candidatures côté expert
 * (extrait SC7b Lot UX Finitions 2). Composant partagé entre
 * /dashboard/freelance/candidatures et /dashboard/cdi/candidatures. Seuls les
 * hrefs (messages/missions) varient via le paramètre `side`.
 *
 * Layout : PageHeader + StatsStrip + MasterDetail (filtres chips + cartes
 * liste à gauche + détail à droite avec timeline + meta + actions).
 * Polling 30s + focus + bump préservé.
 */

type Candidature = {
  id: string
  publication_id: string
  /** Lot synthèse parlante : publication enrichie via helper serveur. */
  publication: (PublicationSynthesisData & { status: string | null }) | null
  status: string
  status_reason: string | null
  ai_match_score: number | null
  unlocked_at: string | null
  /** Lot état 'selected' : timestamp pose à la transition unlocked → selected. */
  selected_at: string | null
  cover_message: string | null
  created_at: string
  conversation_id: string | null
  /** Lot bascule badges par item : true si déjà consultée par cet user. */
  viewed_by_me?: boolean
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; candidatures: Candidature[] }

// Lot état 'selected' : nouveau filtre 'won' (Mission remportée / Poste décroché).
type FilterKey = 'all' | 'open' | 'won' | 'wait' | 'refused'

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

function statusToPillKind(status: string): 'open' | 'won' | 'wait' | 'refused' | 'neutral' {
  if (status === 'selected') return 'won'
  if (status === 'unlocked') return 'open'
  if (status === 'rejected') return 'refused'
  if (status === 'received' || status === 'in_review' || status === 'shortlisted') return 'wait'
  return 'neutral'
}

function matchesFilter(status: string, f: FilterKey): boolean {
  if (f === 'all') return true
  if (f === 'open') return status === 'unlocked'
  if (f === 'won') return status === 'selected'
  if (f === 'wait') return status === 'received' || status === 'in_review' || status === 'shortlisted'
  if (f === 'refused') return status === 'rejected'
  return true
}

export default function CandidaturesTrackingView({ side = 'freelance' }: { side?: 'freelance' | 'cdi' }) {
  const t = useTranslations('candidatures_tracking')
  const tPub = useTranslations('publications')
  // Pour la pill "Nouveau" cohérente avec MissionCard.
  const tMissionsCard = useTranslations('missions.card')
  const locale = useLocale()
  const domain = useDomain()
  const [filter, setFilter] = useState<FilterKey>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // useLiveResource : holdNewItems=false ici, les changements de status
  // (unlocked/rejected) doivent apparaître instantanément.
  const live = useLiveResource<{ candidatures: Candidature[] }, Candidature>({
    url: `/api/me/candidatures?locale=${encodeURIComponent(locale)}`,
    itemsOf: (d) => d.candidatures ?? [],
    identityOf: (c) => c.id,
    versionOf: (c) => `${c.status}|${c.unlocked_at ?? ''}|${c.conversation_id ?? ''}`,
    holdNewItems: false,
  })
  const state = live.state
  const list = live.data?.candidatures ?? []
  const filtered = useMemo(() => list.filter((c) => matchesFilter(c.status, filter)), [list, filter])
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

  const counts = useMemo(() => {
    let open = 0, won = 0, wait = 0, scoreSum = 0, scoreN = 0
    for (const c of list) {
      if (c.status === 'selected') won++
      else if (c.status === 'unlocked') open++
      else if (c.status === 'received' || c.status === 'in_review' || c.status === 'shortlisted') wait++
      if (c.ai_match_score != null) { scoreSum += c.ai_match_score; scoreN++ }
    }
    const avgPct = scoreN > 0 ? Math.round((scoreSum / scoreN) * 10) : null
    return { total: list.length, open, won, wait, avgPct }
  }, [list])

  const stats: Stat[] = [
    { value: counts.total, label: t('stats.total') },
    { value: counts.open,  label: t('stats.open'),  emphasis: 'success' },
    { value: counts.wait,  label: t('stats.wait') },
    { value: counts.avgPct == null ? '—' : `${counts.avgPct}%`, label: t('stats.avg_score') },
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

  // Filtre 'won' insere entre 'open' et 'wait' (ordre de funnel naturel :
  // retenu → en cours → en attente → refuse). Le label se differencie par
  // type de publication via i18n (won_mission / won_offre sont identiques
  // au niveau du filtre — le distingo n'apparait que dans le détail).
  const filters: Array<{ key: FilterKey; label: string }> = [
    { key: 'all',     label: t('filters.all') },
    { key: 'won',     label: t('filters.won') },
    { key: 'open',    label: t('filters.open') },
    { key: 'wait',    label: t('filters.wait') },
    { key: 'refused', label: t('filters.refused') },
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
                {filters.map((f) => {
                  const on = filter === f.key
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setFilter(f.key)}
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
                  <EmptyState icon="🔍" title={t('empty_filter_title')} body={t('empty_filter_body')} surface="card" />
                ) : (
                  filtered.map((c) => {
                    const on = c.id === selectedId
                    const pk = statusToPillKind(c.status)
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
                            {c.status === 'selected'
                              ? t(c.publication?.type === 'mission' ? 'status_selected_mission' : 'status_selected_offre')
                              : t(`status.${c.status}` as 'status.received')}
                          </StatusPill>
                          <span style={{ color: 'var(--sk-faint)', fontSize: 12 }}>{t('candidated_ago', { time: relativeFromNow(c.created_at, locale) })}</span>
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
              <CandidatureDetail
                candidature={selected}
                tPub={tPub}
                t={t}
                locale={locale}
                domainAccent={domain.primaryColor}
                side={side}
              />
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

function CandidatureDetail({
  candidature: c,
  tPub,
  t,
  locale,
  domainAccent,
  side,
}: {
  candidature: Candidature
  tPub: ReturnType<typeof useTranslations<'publications'>>
  t: ReturnType<typeof useTranslations<'candidatures_tracking'>>
  locale: string
  domainAccent: string
  side: 'freelance' | 'cdi'
}) {
  void domainAccent
  // Retour universel : provenance = page courante (suivi des candidatures).
  const pathname = usePathname()
  const pk = statusToPillKind(c.status)
  const PIcon = pk === 'won' ? IconTrophy : pk === 'open' ? IconLockOpen : pk === 'refused' ? IconX : IconClock
  const isSelected = c.status === 'selected'
  const isMission = c.publication?.type === 'mission'
  return (
    <div style={{ background: 'var(--sk-surface)', border: '1px solid var(--sk-border)', borderRadius: 'var(--sk-r-lg)', padding: '24px 26px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px', lineHeight: 1.25, color: 'var(--sk-text)' }}>
            {c.publication?.title ?? '—'}
          </div>
          <div style={{ color: 'var(--sk-muted)', fontSize: 13, marginTop: 5 }}>
            {c.publication ? tPub(`type.${c.publication.type}`) : '—'}
          </div>
        </div>
        <StatusPill kind={pk} icon={<PIcon size={14} />}>
          {isSelected
            ? t(isMission ? 'status_selected_mission' : 'status_selected_offre')
            : t(`status.${c.status}` as 'status.received')}
        </StatusPill>
      </div>

      {/* Lot état 'selected' : bandeau triomphal côté expert. Affiché en tête
          du detail pour matérialiser le résultat positif. */}
      {isSelected && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginTop: 16,
            background: '#FEF3C7',
            border: '1.5px solid #F59E0B',
            borderRadius: 'var(--sk-r-lg)',
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <div style={{ fontSize: 24, lineHeight: 1 }} aria-hidden>🏆</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#92400E', letterSpacing: '-0.2px' }}>
              {t(isMission ? 'selected_banner_title_mission' : 'selected_banner_title_offre')}
            </div>
            <div style={{ fontSize: 13, color: '#92400E', marginTop: 4, lineHeight: 1.55 }}>
              {t(isMission ? 'selected_banner_body_mission' : 'selected_banner_body_offre')}
            </div>
          </div>
        </div>
      )}

      {/* Lot synthèse parlante : chips publication inline. */}
      {c.publication && (
        <div style={{ marginTop: 14 }}>
          <PublicationSynthesisLine pub={c.publication} size="md" />
        </div>
      )}

      <div style={{ color: 'var(--sk-faint)', fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', margin: '24px 0 12px' }}>
        {t('section_timeline')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <TimelineStep
          icon={<IconSend size={16} />}
          label={t('timeline.sent')}
          sub={t('candidated_ago', { time: relativeFromNow(c.created_at, locale) })}
          state="done"
        />
        {c.ai_match_score != null && (
          <TimelineStep
            icon={<IconSparkles size={16} />}
            label={t('timeline.ai_proposed', { score: Math.round(c.ai_match_score) })}
            state="done"
          />
        )}
        {(c.status === 'unlocked' || c.status === 'selected') && c.unlocked_at && (
          <TimelineStep
            icon={<IconLockOpen size={16} />}
            label={t('timeline.unlocked')}
            sub={t('unlocked_since', { time: relativeFromNow(c.unlocked_at, locale) })}
            state="done"
            isLast={c.status === 'unlocked'}
          />
        )}
        {c.status === 'selected' && c.selected_at && (
          <TimelineStep
            icon={<IconTrophy size={16} />}
            label={t(isMission ? 'timeline.selected_mission' : 'timeline.selected_offre')}
            sub={t('selected_since', { time: relativeFromNow(c.selected_at, locale) })}
            state="done"
            isLast
          />
        )}
        {c.status === 'rejected' && (
          <TimelineStep
            icon={<IconX size={16} />}
            label={t('timeline.rejected')}
            sub={c.status_reason ?? undefined}
            state="failed"
            isLast
          />
        )}
        {c.status !== 'unlocked' && c.status !== 'rejected' && c.status !== 'selected' && (
          <TimelineStep
            icon={<IconClock size={16} />}
            label={t('timeline.waiting')}
            sub={t('waiting_for_org')}
            state="pending"
            isLast
          />
        )}
      </div>

      {c.cover_message && (
        <>
          <div style={{ color: 'var(--sk-faint)', fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', margin: '24px 0 12px' }}>
            {t('section_cover_message')}
          </div>
          <div style={{ background: 'var(--sk-surface-2)', border: '1px solid var(--sk-border-soft)', borderRadius: 'var(--sk-r-lg)', padding: '14px 16px', fontSize: 14, lineHeight: 1.6, color: 'var(--sk-text)', whiteSpace: 'pre-wrap' }}>
            {c.cover_message}
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 11, marginTop: 26, paddingTop: 20, borderTop: '1px solid var(--sk-border-soft)' }}>
        {(c.status === 'unlocked' || c.status === 'selected') && c.conversation_id && (
          <Link
            href={`/dashboard/${side}/messages/${c.conversation_id}`}
            style={{
              padding: '11px 20px', borderRadius: 11,
              background: 'var(--sk-accent)', color: '#fff',
              border: 'none', fontWeight: 600, fontSize: 14,
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
              textDecoration: 'none',
            }}
          >
            <IconMessage2 size={16} stroke={2} />
            {t('open_conversation')}
          </Link>
        )}
        {c.publication?.id && (
          <Link
            href={`/dashboard/${side}/missions/${c.publication.id}?from=${encodeURIComponent(pathname)}`}
            style={{
              padding: '11px 20px', borderRadius: 11,
              background: 'var(--sk-surface)', color: 'var(--sk-text)',
              border: '1px solid var(--sk-border)', fontWeight: 600, fontSize: 14,
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
              textDecoration: 'none',
            }}
          >
            <IconExternalLink size={16} stroke={2} />
            {t('view_mission')}
          </Link>
        )}
      </div>
    </div>
  )
}
