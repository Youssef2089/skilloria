'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'

/**
 * Carte d'opportunité côté EXPERT (Lot 2b).
 *
 * Diffère de l'AnnonceCard côté org : pas de compteurs candidatures, mais
 * affichage du score IA + reason ("pourquoi ça vous correspond"), masquage
 * de l'org si confidential, lien vers le détail.
 */

export type MissionCardData = {
  match_id: string
  match_status: string
  ai_score: number
  ai_reason: string | null
  matched_at: string
  publication: {
    id: string
    type: string
    title: string
    budget_min: number | null
    budget_max: number | null
    branch_label: string | null
    speciality_label: string | null
    confidential: boolean
    published_at: string | null
  }
  org: { name: string | null; logo_url: string | null } | null
}

function formatBudget(min: number | null, max: number | null, type: string, locale: string): string {
  if (min == null && max == null) return ''
  const unitMap: Record<string, Record<string, string>> = {
    fr: { mission: '/jour', offre: '/an' },
    en: { mission: '/day', offre: '/year' },
    es: { mission: '/día', offre: '/año' },
    de: { mission: '/Tag', offre: '/Jahr' },
  }
  const unit = unitMap[locale]?.[type] ?? unitMap.fr[type] ?? ''
  if (min != null && max != null) return `${Math.round(min)}-${Math.round(max)}€${unit}`
  if (min != null) return `${Math.round(min)}€${unit}`
  return `${Math.round(max!)}€${unit}`
}

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

function scoreColor(score: number, domainPrimary: string): string {
  if (score >= 9) return '#16A34A'
  if (score >= 7) return domainPrimary
  if (score >= 5) return '#CA8A04'
  return '#94a3b8'
}

export default function MissionCard({ mission }: { mission: MissionCardData }) {
  const t = useTranslations('missions.card')
  const tPub = useTranslations('publications')
  const locale = useLocale()
  const domain = useDomain()

  const { publication: pub, org, ai_score, ai_reason, match_status } = mission
  const budgetText = formatBudget(pub.budget_min, pub.budget_max, pub.type, locale)
  const orgName = pub.confidential ? t('confidential_org') : org?.name ?? t('confidential_org')
  const isUnread = match_status === 'notified' || match_status === 'pending'

  return (
    <Link
      href={`/dashboard/freelance/missions/${pub.id}`}
      style={{
        display: 'block',
        background: '#fff',
        border: isUnread ? `1.5px solid ${domain.primaryColor}` : '0.5px solid #e5e7eb',
        borderRadius: 14,
        padding: '18px 20px',
        textDecoration: 'none',
        color: 'inherit',
        position: 'relative',
        transition: 'box-shadow .15s, transform .15s',
      }}
    >
      {/* Header : title + score badge + unread dot */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 4, lineHeight: 1.35 }}>
            {pub.title}
          </h3>
          <div style={{ fontSize: 12, color: '#64748b', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 500 }}>{tPub(`type.${pub.type}`)}</span>
            <span aria-hidden>·</span>
            <span>{orgName}</span>
            {pub.confidential && (
              <span title={t('confidential_tooltip')} aria-hidden>🔒</span>
            )}
            {pub.published_at && (
              <>
                <span aria-hidden>·</span>
                <span>{tPub('dates.published_ago', { time: relativeFromNow(pub.published_at, locale) })}</span>
              </>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          <span
            title={t('ai_score_tooltip')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              background: `${scoreColor(ai_score, domain.primaryColor)}1A`,
              color: scoreColor(ai_score, domain.primaryColor),
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 12,
            }}
          >
            <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: scoreColor(ai_score, domain.primaryColor) }} />
            {t('ai_score', { score: Math.round(ai_score) })}
          </span>
          {isUnread && (
            <span style={{ fontSize: 10, fontWeight: 600, color: domain.primaryColor, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              {t('new_label')}
            </span>
          )}
        </div>
      </div>

      {/* Meta : branch · spec · budget */}
      <div style={{ fontSize: 12, color: '#475569', marginBottom: 12 }}>
        {[pub.branch_label, pub.speciality_label, budgetText].filter(Boolean).join(' · ')}
      </div>

      {/* AI reason — "Pourquoi ça vous correspond" */}
      {ai_reason && (
        <div
          style={{
            background: 'var(--color-background-secondary, #f8fafc)',
            border: '0.5px solid #e5e7eb',
            borderRadius: 10,
            padding: '10px 12px',
            fontSize: 12,
            color: '#334155',
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#64748b', marginBottom: 4 }}>
            {t('why_match_label')}
          </div>
          <div>{ai_reason}</div>
        </div>
      )}
    </Link>
  )
}
