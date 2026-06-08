'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import Avatar from '@/components/ui/Avatar'
import PublicationSynthesisLine, { formatPublicationBudget } from './PublicationSynthesisLine'
import type { MissionCardData } from './MissionCard'

/**
 * MissionCastingCard — carte riche « direction B » pour le casting du home
 * (Missions recommandées / Suggestions).
 *
 * Contenu : tuile logo entreprise (Avatar, repli initiales) · titre + org ·
 * score IA en ANNEAU SVG (remplissage = score/10, vert success) · ligne
 * synthèse (lieu · remote · durée, budget exclu) · chips compétences (max 3
 * + « +N ») · pied budget + « Voir la mission/l'offre ».
 *
 * Confidential : org masquée → Avatar en initiales du libellé + 🔒.
 * Pill « Nouveau » : dérivée de match_status (pending/notified), décrément à
 * l'ouverture du détail (route [id]). Aucun marquage au scroll.
 *
 * useDomain — accent multi-tenant. Vert success = couleur sémantique (V1).
 */

const RING_GREEN = '#16A34A'

function ScoreRing({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(10, score))
  const size = 52
  const stroke = 5
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - clamped / 10)
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sk-surface-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={RING_GREEN}
          strokeWidth={stroke}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--sk-text)' }}>{Math.round(clamped)}</span>
        <span style={{ fontSize: 8.5, fontWeight: 600, color: 'var(--sk-faint)' }}>/10</span>
      </div>
    </div>
  )
}

export default function MissionCastingCard({
  mission,
  side = 'freelance',
}: {
  mission: MissionCardData
  side?: 'freelance' | 'cdi'
}) {
  const tCard = useTranslations('missions.card')
  const tc = useTranslations('missions.casting')
  const tPub = useTranslations('publications')
  const domain = useDomain()

  const { publication: pub, org, ai_score, match_status, skills_required = [] } = mission
  const orgName = pub.confidential ? tCard('confidential_org') : org?.name ?? tCard('confidential_org')
  const logoUrl = pub.confidential ? null : org?.logo_url ?? null
  const isFresh = match_status === 'pending' || match_status === 'notified'

  const budgetUnit = pub.type === 'offre' ? tPub('budget_unit.year') : tPub('budget_unit.day')
  const budgetText = formatPublicationBudget(pub, budgetUnit)

  const visibleSkills = skills_required.slice(0, 3)
  const extraSkills = skills_required.length - visibleSkills.length

  return (
    <Link
      href={`/dashboard/${side}/missions/${pub.id}`}
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
      {isFresh && (
        <span style={{ position: 'absolute', top: 10, right: 14, fontSize: 10, fontWeight: 700, color: domain.primaryColor, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          {tCard('new_label')}
        </span>
      )}

      {/* Header : logo + titre/org + anneau score */}
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
        <ScoreRing score={ai_score} />
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
          {tc(pub.type === 'offre' ? 'see_offre' : 'see_mission')}
          <span aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>→</span>
        </span>
      </div>
    </Link>
  )
}
