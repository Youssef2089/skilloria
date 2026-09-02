'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import Avatar from '@/components/ui/Avatar'
import { castingTheme } from '@/lib/casting-theme'
import { relativeTimeFromNow } from '@/lib/relative-time'
import { formatPublicationBudget } from './PublicationSynthesisLine'
import type { MissionCardData } from './MissionCard'

/**
 * MissionCastingCard — carte commerciale (rangée home « Missions
 * recommandées »). Bandeau teinté accent (--sk-accent-soft) + tuile logo
 * (Avatar, repli initiales) + pastille score ; corps : accroche
 * (« Nouveau » / « Top match » score≥9) · titre · entreprise · meta
 * (lieu · remote · fraîcheur) · chips compétences (max 3 + « +N ») · budget
 * + CTA accent plein.
 *
 * Confidential : org masquée → Avatar initiales + 🔒, nom masqué (bandeau
 * reste teinté). Pill « Nouveau » dérivée de match_status, décrément à
 * l'ouverture du détail (route [id]) — jamais au scroll.
 *
 * Couleur DÉCORATIVE FIXE = lavande (castingTheme, ≠ accent useDomain qui
 * reste pour le chrome). En-tête pastel + CTA lavande plein + pill accroche
 * douce ; la pastille score reste VERTE (signal sémantique, V1). Tokens
 * centralisés dans lib/casting-theme — rien en dur ici.
 */

const TOP_MATCH_THRESHOLD = 9

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
  const locale = useLocale()

  const { publication: pub, org, ai_score, match_status, skills_required = [] } = mission

  const orgName = pub.confidential ? tCard('confidential_org') : org?.name ?? tCard('confidential_org')
  const logoUrl = pub.confidential ? null : org?.logo_url ?? null
  const isFresh = match_status === 'pending' || match_status === 'notified'
  const isTopMatch = ai_score >= TOP_MATCH_THRESHOLD

  const workModeLabel = (() => {
    if (!pub.work_mode) return null
    const key = pub.work_mode.toLowerCase()
    try { return tPub(`form.work_mode_options.${key}` as 'form.work_mode_options.remote') }
    catch { return pub.work_mode }
  })()
  const freshness = relativeTimeFromNow(pub.published_at, locale)
  const zoneLabel = pub.work_zone_labels.length > 0
    ? pub.work_zone_labels.join(' · ')
    : pub.location_note
  const metaParts = [zoneLabel, workModeLabel, freshness].filter(Boolean) as string[]

  const budgetUnit = pub.type === 'offre' ? tPub('budget_unit.year') : tPub('budget_unit.day')
  const budgetText = formatPublicationBudget(pub, budgetUnit)

  const visibleSkills = skills_required.slice(0, 3)
  const extraSkills = skills_required.length - visibleSkills.length

  return (
    <Link
      href={`/dashboard/${side}/missions/${pub.id}`}
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
      {/* Bandeau lavande pastel : logo + pastille score */}
      <div style={{ background: castingTheme.accentSoft, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ display: 'inline-flex', padding: 4, background: '#fff', border: `1px solid ${castingTheme.logoBorder}`, borderRadius: 11, boxShadow: '0 1px 3px rgba(15,23,42,0.12)' }}>
          <Avatar src={logoUrl} name={orgName} size={34} variant="neutral" />
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 1, background: '#fff', padding: '4px 10px', borderRadius: 999, boxShadow: '0 1px 3px rgba(15,23,42,0.12)' }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: castingTheme.scoreGreen }}>{Math.round(ai_score)}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--sk-faint)' }}>/10</span>
        </span>
      </div>

      {/* Corps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '12px 14px', flex: 1 }}>
        {(isFresh || isTopMatch) && (
          <span style={{ alignSelf: 'flex-start', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: castingTheme.pillSoftText, background: castingTheme.pillSoftBg, padding: '3px 8px', borderRadius: 999 }}>
            {isFresh ? tCard('new_label') : tc('top_match')}
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
            {tc(pub.type === 'offre' ? 'see_offre' : 'see_mission')}
            <span aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>→</span>
          </span>
        </div>
      </div>
    </Link>
  )
}
