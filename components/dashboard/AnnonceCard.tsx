'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { Annonce, AnnonceStatus } from '@/types/annonce'

/**
 * Carte d'annonce du dashboard organisation (B3.5).
 *
 * Affiche : titre, sous-titre (publication/clôture + budget), badge statut,
 * 5 compteurs candidatures, lien d'action selon le statut.
 *
 * Réutilise le type partagé `Annonce` (types/annonce.ts).
 *
 * Le lien d'action est un `<Link>` next-intl (préfixe locale automatique).
 *
 * TODO B4+ : le titre d'annonce (annonce.title) sera multilingue et nécessitera
 * tBDD() — cf. types/annonce.ts pour la stratégie (route API ou Server Component).
 */

type Props = {
  annonce: Annonce
  // B3.5.fix : un seul dashboard org. basePath restreint pour interdire
  // toute régression vers une URL secondaire.
  basePath: '/dashboard/entreprise'
}

const STATUS_STYLES: Record<
  AnnonceStatus,
  { bg: string; color: string; dot: string }
> = {
  published: { bg: '#DBEAFE', color: '#1E40AF', dot: '#1E40AF' },
  in_discussion: { bg: '#DCFCE7', color: '#166534', dot: '#16A34A' },
  closed: {
    bg: 'var(--color-background-secondary, #f1f5f9)',
    color: 'var(--color-text-secondary, #64748b)',
    dot: 'var(--color-text-tertiary, #94a3b8)',
  },
}

function IconUsers({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
      <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      <path d="M16 11a4 4 0 0 0 0-8" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.85" />
    </svg>
  )
}

function formatBudget(min: number | null, max: number | null, unit: Annonce['budget_unit']): string {
  if (min == null && max == null) return ''
  const unitSuffix =
    unit === 'day' ? '/j' : unit === 'month' ? '/mois' : unit === 'year' ? '/an' : ''
  if (min != null && max != null) return `${Math.round(min)}-${Math.round(max)}€${unitSuffix}`
  if (min != null) return `${Math.round(min)}€${unitSuffix}`
  if (max != null) return `${Math.round(max)}€${unitSuffix}`
  return ''
}

/**
 * Distance approximative en "il y a X" (FR uniquement V1).
 * Format simple sans dépendance externe (pas de dayjs/date-fns).
 */
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
    locale === 'fr'
      ? { d: 'j', h: 'h', m: 'min' }
      : locale === 'es'
        ? { d: 'd', h: 'h', m: 'min' }
        : locale === 'de'
          ? { d: 'T', h: 'h', m: 'min' }
          : { d: 'd', h: 'h', m: 'min' }
  if (day >= 1) return `${day}${labels.d}`
  if (hr >= 1) return `${hr}${labels.h}`
  if (min >= 1) return `${min}${labels.m}`
  return locale === 'fr' ? "à l'instant" : 'just now'
}

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return iso.slice(0, 10)
  }
}

export default function AnnonceCard({ annonce, basePath }: Props) {
  const t = useTranslations('dashboard_entreprise')

  const statusStyle = STATUS_STYLES[annonce.status]
  const isClosed = annonce.status === 'closed'

  const budgetText = formatBudget(annonce.budget_min, annonce.budget_max, annonce.budget_unit)

  // Sous-titre : "Publiée il y a X · YYY-ZZZ€/j" ou "Clôturée le X · ..."
  // On lit la locale courante via document (pas d'access serveur ici).
  const locale =
    typeof document !== 'undefined' ? document.documentElement.lang || 'fr' : 'fr'
  const subtitle = isClosed
    ? `${t('closed_on', { date: formatDate(annonce.closed_at, locale) })}${budgetText ? ' · ' + budgetText : ''}`
    : `${t('published_ago', { time: relativeFromNow(annonce.published_at, locale) })}${budgetText ? ' · ' + budgetText : ''}`

  const statusLabel =
    annonce.status === 'published'
      ? t('status_published')
      : annonce.status === 'in_discussion'
        ? t('status_in_discussion')
        : t('status_closed')

  const c = annonce.candidatures
  const counters: Array<{ key: string; label: string; value: number; color?: string }> = [
    { key: 'recues', label: t('counter_recues'), value: Math.round(c.recues) },
    { key: 'nouvelles', label: t('counter_nouvelles'), value: Math.round(c.nouvelles), color: '#00B9FF' },
    { key: 'en_discussion', label: t('counter_en_discussion'), value: Math.round(c.en_discussion) },
    { key: 'retenues', label: t('counter_retenues'), value: Math.round(c.retenues), color: '#16A34A' },
    { key: 'refusees', label: t('counter_refusees'), value: Math.round(c.refusees) },
  ]

  return (
    <article
      style={{
        background: 'var(--color-background-primary, #fff)',
        border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
        borderRadius: 12,
        padding: '14px 18px',
        opacity: isClosed ? 0.7 : 1,
        transition: 'opacity .15s, box-shadow .2s',
      }}
    >
      {/* Header : titre + sous-titre + badge statut */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--color-text-primary, #0f172a)',
              marginBottom: 4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {annonce.title}
          </h3>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #64748b)' }}>
            {subtitle}
          </div>
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            background: statusStyle.bg,
            color: statusStyle.color,
            fontSize: 11,
            fontWeight: 500,
            borderRadius: 12,
            flexShrink: 0,
          }}
        >
          <span
            aria-hidden
            style={{ width: 6, height: 6, borderRadius: '50%', background: statusStyle.dot }}
          />
          {statusLabel}
        </span>
      </div>

      {/* Section candidatures */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, color: 'var(--color-text-secondary, #64748b)' }}>
        <IconUsers size={12} />
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '.08em',
          }}
        >
          {t('candidatures_label')}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 14 }}>
        {counters.map((cnt) => {
          const isZero = cnt.value === 0
          const valueColor = isZero
            ? 'var(--color-text-tertiary, #94a3b8)'
            : cnt.color ?? 'var(--color-text-primary, #0f172a)'
          return (
            <div key={cnt.key} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 500, color: valueColor, lineHeight: 1 }}>
                {cnt.value}
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-text-secondary, #64748b)', marginTop: 4 }}>
                {cnt.label}
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer : lien d'action */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Link
          href={`${basePath}/annonces/${annonce.id}`}
          style={{
            fontSize: 12,
            color: '#00B9FF',
            fontWeight: 500,
            textDecoration: 'none',
          }}
        >
          {isClosed ? t('view_detail') : t('manage_annonce')}
        </Link>
      </div>
    </article>
  )
}
