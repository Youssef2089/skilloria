'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { IconTrophy, IconLockOpen, IconClock, IconX } from '@tabler/icons-react'
import Avatar from '@/components/ui/Avatar'
import StatusPill, { type StatusPillKind } from '@/components/ui/StatusPill'
import PublicationSynthesisLine, { formatPublicationBudget, type PublicationSynthesisData } from './PublicationSynthesisLine'
import type { MissionCardData } from './MissionCard'

/**
 * CandidatureCastingCard — variante candidatures de la carte casting « direction
 * B » pour le home (Vos candidatures / Mes candidatures).
 *
 * Identique à MissionCastingCard MAIS l'anneau score est remplacé par la
 * PASTILLE DE STATUT. Vocabulaire expert PRÉSERVÉ via les namespaces
 * dashboard_{freelance,cdi} : « Mission remportée » / « Poste décroché » pour
 * 'selected' (jamais « Acceptée »).
 *
 * Lien → page candidatures (navigation existante). Pill « Nouveau » dérivée de
 * viewed_by_me ; décrément à l'ouverture du détail (page candidatures), pas au
 * scroll. Confidential : org masquée → Avatar initiales + 🔒.
 */

export type CandidatureCastingData = {
  id: string
  publication: (PublicationSynthesisData & { status?: string | null; published_at?: string | null }) | null
  org: MissionCardData['org']
  skills_required: string[]
  status: string
  viewed_by_me?: boolean
}

function statusToPillKind(status: string): StatusPillKind {
  if (status === 'selected') return 'won'
  if (status === 'unlocked') return 'open'
  if (status === 'rejected' || status === 'withdrawn') return 'refused'
  if (status === 'received' || status === 'in_review' || status === 'shortlisted') return 'wait'
  return 'neutral'
}

export default function CandidatureCastingCard({
  candidature,
  side = 'freelance',
}: {
  candidature: CandidatureCastingData
  side?: 'freelance' | 'cdi'
}) {
  const tCard = useTranslations('missions.card')
  const tc = useTranslations('missions.casting')
  const tPub = useTranslations('publications')
  const domain = useDomain()
  // Vocabulaire expert : labels de statut sous dashboard_{freelance,cdi}
  // (« Mission remportée » / « Poste décroché », jamais « Acceptée »).
  const tStatus = useTranslations(
    side === 'cdi' ? 'dashboard_cdi.applications_section' : 'dashboard_freelance.cards.your_candidatures',
  )

  const { publication: pub, org, status, skills_required = [], viewed_by_me } = candidature
  if (!pub) return null

  const orgName = pub.confidential ? tCard('confidential_org') : org?.name ?? tCard('confidential_org')
  const logoUrl = pub.confidential ? null : org?.logo_url ?? null

  const isClosed = status === 'rejected' || status === 'withdrawn' || status === 'archived'
  const isFresh = viewed_by_me === false && !isClosed

  const pillKind = statusToPillKind(status)
  const PillIcon = pillKind === 'won' ? IconTrophy : pillKind === 'open' ? IconLockOpen : pillKind === 'refused' ? IconX : IconClock
  const statusLabel = (() => {
    try {
      if (status === 'selected') {
        return tStatus(pub.type === 'mission' ? 'status_selected_mission' : 'status_selected_offre')
      }
      return tStatus(`status.${status}` as 'status.received')
    } catch {
      return status
    }
  })()

  const budgetUnit = pub.type === 'offre' ? tPub('budget_unit.year') : tPub('budget_unit.day')
  const budgetText = formatPublicationBudget(pub, budgetUnit)

  const visibleSkills = skills_required.slice(0, 3)
  const extraSkills = skills_required.length - visibleSkills.length

  return (
    <Link
      href={`/dashboard/${side}/candidatures`}
      style={{
        display: 'block',
        position: 'relative',
        background: 'var(--sk-surface)',
        border: isFresh ? `1.5px solid ${domain.primaryColor}` : '0.5px solid var(--sk-border)',
        borderRadius: 16,
        padding: '16px 18px',
        textDecoration: 'none',
        color: 'inherit',
        boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
        transition: 'box-shadow .15s, border-color .15s',
      }}
    >
      {/* Header : logo + titre/org + pastille statut */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <Avatar src={logoUrl} name={orgName} size={44} variant="neutral" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--sk-text)', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {pub.title}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--sk-muted)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{orgName}</span>
            {pub.confidential && (
              <span title={tCard('confidential_tooltip')} aria-hidden style={{ opacity: 0.7, flexShrink: 0 }}>🔒</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <StatusPill kind={pillKind} icon={<PillIcon size={14} />} size="sm">{statusLabel}</StatusPill>
          {isFresh && (
            <span style={{ fontSize: 10, fontWeight: 700, color: domain.primaryColor, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              {tCard('new_label')}
            </span>
          )}
        </div>
      </div>

      {/* Synthèse : lieu · remote · durée (budget exclu → relégué au pied) */}
      <div style={{ marginTop: 12 }}>
        <PublicationSynthesisLine pub={pub} size="sm" omit={['budget', 'contract', 'seniority', 'start']} />
      </div>

      {/* Compétences (max 3 + « +N ») */}
      {visibleSkills.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {visibleSkills.map((s) => (
            <span key={s} style={{ fontSize: 11, fontWeight: 600, color: 'var(--sk-accent-ink)', background: 'var(--sk-accent-soft)', padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }}>
              {s}
            </span>
          ))}
          {extraSkills > 0 && (
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--sk-muted)', background: 'var(--sk-surface-2)', border: '1px solid var(--sk-border)', padding: '3px 9px', borderRadius: 999 }}>
              {tc('more_skills', { count: extraSkills })}
            </span>
          )}
        </div>
      )}

      {/* Pied : budget + CTA */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--sk-border-soft)' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--sk-text)' }}>{budgetText ?? '—'}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', background: domain.primaryColor, color: '#fff', fontSize: 12.5, fontWeight: 700, borderRadius: 10, letterSpacing: '-0.1px' }}>
          {tc('see_application')}
          <span aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>→</span>
        </span>
      </div>
    </Link>
  )
}
