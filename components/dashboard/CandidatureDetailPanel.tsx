'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useRelativeTime } from '@/lib/use-relative-time'
import { Link } from '@/i18n/navigation'
import {
  IconSend,
  IconSparkles,
  IconLockOpen,
  IconClock,
  IconX,
  IconMessage2,
  IconExternalLink,
  IconTrophy,
} from '@tabler/icons-react'
import StatusPill from '@/components/ui/StatusPill'
import TimelineStep from '@/components/ui/TimelineStep'
import PublicationSynthesisLine, { type PublicationSynthesisData } from '@/components/dashboard/PublicationSynthesisLine'

/**
 * CandidatureDetailPanel — détail d'UNE candidature côté expert.
 *
 * SOURCE UNIQUE : utilisé À LA FOIS comme panneau de droite du master-detail
 * (/dashboard/{side}/candidatures) ET comme contenu de la page de détail dédiée
 * (/dashboard/{side}/candidatures/[id]). Aucune duplication.
 *
 * Composant présentationnel auto-suffisant : il résout lui-même i18n + locale
 * (plus de prop-drilling). Contenu : en-tête (titre + type + statut), bandeau
 * 🏆 'selected', chips synthèse, timeline SUIVI, message de motivation, et les
 * actions « Ouvrir la conversation » / « Voir la mission ».
 */

export type Candidature = {
  id: string
  publication_id: string
  publication: (PublicationSynthesisData & { status: string | null }) | null
  status: string
  status_reason: string | null
  ai_match_score: number | null
  unlocked_at: string | null
  selected_at: string | null
  cover_message: string | null
  created_at: string
  conversation_id: string | null
  viewed_by_me?: boolean
}

export function statusToPillKind(status: string): 'open' | 'won' | 'wait' | 'refused' | 'neutral' {
  if (status === 'selected') return 'won'
  if (status === 'unlocked') return 'open'
  if (status === 'rejected') return 'refused'
  if (status === 'received' || status === 'in_review' || status === 'shortlisted') return 'wait'
  return 'neutral'
}

export default function CandidatureDetailPanel({
  candidature: c,
  side,
}: {
  candidature: Candidature
  side: 'freelance' | 'cdi'
}) {
  const t = useTranslations('candidatures_tracking')
  const tPub = useTranslations('publications')
  const locale = useLocale()
  const relTime = useRelativeTime()

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

      {/* Lot état 'selected' : bandeau triomphal côté expert. */}
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
          sub={t('candidated_ago', { time: relTime(c.created_at) })}
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
            sub={t('unlocked_since', { time: relTime(c.unlocked_at) })}
            state="done"
            isLast={c.status === 'unlocked'}
          />
        )}
        {c.status === 'selected' && c.selected_at && (
          <TimelineStep
            icon={<IconTrophy size={16} />}
            label={t(isMission ? 'timeline.selected_mission' : 'timeline.selected_offre')}
            sub={t('selected_since', { time: relTime(c.selected_at) })}
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
            href={`/dashboard/${side}/missions/${c.publication.id}`}
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
