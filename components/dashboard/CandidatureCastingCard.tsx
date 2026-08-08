'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { IconTrophy, IconLockOpen, IconClock, IconX } from '@tabler/icons-react'
import Avatar from '@/components/ui/Avatar'
import StatusPill from '@/components/ui/StatusPill'
import { castingTheme } from '@/lib/casting-theme'
import type { CandidatureLifecycle } from '@/lib/candidatures/lifecycle'
import {
  lifecycleToPillKind,
  useCandidatureLifecycleLabel,
} from '@/lib/candidatures/use-lifecycle-label'
import { formatPublicationBudget, type PublicationSynthesisData } from './PublicationSynthesisLine'
import type { MissionCardData } from './MissionCard'

/**
 * CandidatureCastingCard — carte commerciale candidatures (rangée home).
 * Identique à MissionCastingCard MAIS la pastille score est remplacée par la
 * PASTILLE DE STATUT (le statut est le signal principal — pas de date d'âge).
 *
 * Vocabulaire expert PRÉSERVÉ via dashboard_{freelance,cdi} : « Mission
 * remportée » / « Poste décroché » pour 'selected' (jamais « Acceptée »).
 * Lien → page de DÉTAIL de la candidature (/candidatures/[id], Retour global).
 * Pill « Nouveau » via viewed_by_me,
 * décrément à l'ouverture du détail, pas au scroll. Confidential : Avatar
 * initiales + 🔒, nom masqué (bandeau reste teinté).
 *
 * Couleur DÉCORATIVE FIXE = lavande (castingTheme, ≠ accent useDomain).
 * En-tête pastel + CTA lavande plein + pill « Nouveau » douce ; la pastille
 * de STATUT garde ses couleurs sémantiques (StatusPill : vert « Échange
 * ouvert » / ambre / rouge — NON touchée). Tokens centralisés dans
 * lib/casting-theme — rien en dur ici.
 */

export type CandidatureCastingData = {
  id: string
  publication: (PublicationSynthesisData & { status?: string | null; published_at?: string | null }) | null
  org: MissionCardData['org']
  skills_required: string[]
  status: string
  viewed_by_me?: boolean
  /** État de vie dérivé serveur — source unique du libellé et de la teinte. */
  lifecycle?: CandidatureLifecycle | null
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
  // SITE DE RENDU 3/5 — le vocabulaire expert (« Mission remportée » / « Poste
  // décroché ») vit désormais dans candidature_lifecycle.expert, indexé par la
  // RAISON dérivée, plus par le statut brut sous dashboard_{freelance,cdi}.
  const lifecycleLabel = useCandidatureLifecycleLabel('expert')

  const { publication: pub, org, lifecycle, skills_required = [], viewed_by_me } = candidature
  if (!pub) return null

  const orgName = pub.confidential ? tCard('confidential_org') : org?.name ?? tCard('confidential_org')
  const logoUrl = pub.confidential ? null : org?.logo_url ?? null

  // « Close » = archivée au sens état de vie, pas au sens statut : un échange
  // dont la fenêtre est passée est clos même si son statut reste 'unlocked'.
  const isClosed = lifecycle?.bucket === 'archived'
  const isFresh = viewed_by_me === false && !isClosed

  const pillKind = lifecycle ? lifecycleToPillKind(lifecycle.reason) : 'neutral'
  const PillIcon = pillKind === 'won' ? IconTrophy : pillKind === 'open' ? IconLockOpen : pillKind === 'refused' ? IconX : IconClock
  const statusLabel = lifecycleLabel(lifecycle, pub.type)

  const workModeLabel = (() => {
    if (!pub.work_mode) return null
    const key = pub.work_mode.toLowerCase()
    try { return tPub(`form.work_mode_options.${key}` as 'form.work_mode_options.remote') }
    catch { return pub.work_mode }
  })()
  const metaParts = [pub.location, workModeLabel].filter(Boolean) as string[]

  const budgetUnit = pub.type === 'offre' ? tPub('budget_unit.year') : tPub('budget_unit.day')
  const budgetText = formatPublicationBudget(pub, budgetUnit)

  const visibleSkills = skills_required.slice(0, 3)
  const extraSkills = skills_required.length - visibleSkills.length

  return (
    <Link
      href={`/dashboard/${side}/candidatures/${candidature.id}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--sk-surface)',
        border: '1px solid var(--sk-border)',
        borderRadius: 16,
        overflow: 'hidden',
        textDecoration: 'none',
        color: 'inherit',
        boxShadow: '0 1px 2px rgba(15,23,42,0.05)',
        transition: 'box-shadow .15s, transform .15s',
      }}
    >
      {/* Bandeau lavande pastel : logo + pastille statut (sémantique) */}
      <div style={{ background: castingTheme.accentSoft, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ display: 'inline-flex', padding: 4, background: '#fff', border: `1px solid ${castingTheme.logoBorder}`, borderRadius: 11, boxShadow: '0 1px 3px rgba(15,23,42,0.12)' }}>
          <Avatar src={logoUrl} name={orgName} size={34} variant="neutral" />
        </span>
        <StatusPill kind={pillKind} icon={<PillIcon size={13} />} size="sm">{statusLabel}</StatusPill>
      </div>

      {/* Corps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '12px 14px', flex: 1 }}>
        {isFresh && (
          <span style={{ alignSelf: 'flex-start', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: castingTheme.pillSoftText, background: castingTheme.pillSoftBg, padding: '3px 8px', borderRadius: 999 }}>
            {tCard('new_label')}
          </span>
        )}

        <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--sk-text)', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {pub.title}
        </div>

        <div style={{ fontSize: 12.5, color: 'var(--sk-muted)', display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{orgName}</span>
          {pub.confidential && <span title={tCard('confidential_tooltip')} aria-hidden style={{ opacity: 0.7, flexShrink: 0 }}>🔒</span>}
        </div>

        {metaParts.length > 0 && (
          <div style={{ fontSize: 11.5, color: 'var(--sk-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {metaParts.join(' · ')}
          </div>
        )}

        {visibleSkills.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 1 }}>
            {visibleSkills.map((s) => (
              <span key={s} style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--sk-text)', background: 'var(--sk-surface-2)', border: '1px solid var(--sk-border)', padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>{s}</span>
            ))}
            {extraSkills > 0 && (
              <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--sk-muted)', padding: '2px 6px' }}>{tc('more_skills', { count: extraSkills })}</span>
            )}
          </div>
        )}

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--sk-text)' }}>{budgetText ?? '—'}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', background: castingTheme.ctaBg, color: castingTheme.ctaText, border: `1px solid ${castingTheme.ctaBorder}`, fontSize: 12, fontWeight: 700, borderRadius: 10, letterSpacing: '-0.1px' }}>
            {tc('see_application')}
            <span aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>→</span>
          </span>
        </div>
      </div>
    </Link>
  )
}
