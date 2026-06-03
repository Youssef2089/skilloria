'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { Annonce, AnnonceStatus } from '@/types/annonce'

/**
 * Carte d'annonce du dashboard organisation.
 *
 * Lot 1b.1 :
 *   - Couvre les 7 statuts BDD via un STATUS_STYLES exhaustif
 *   - Badge "Score IA {score}/10" si verification_score non nul
 *   - Affiche type (Mission/Offre), branch · speciality, budget avec unité
 *     dérivée du type (mission → /jour, offre → /an) côté DTO server-side
 *
 * Les compteurs candidatures sont à 0 tant que le Lot 2 n'a pas branché
 * l'agrégat depuis la table `candidatures`.
 */

type Props = {
  annonce: Annonce
  basePath: '/dashboard/entreprise'
}

type StatusVisual = { bg: string; color: string; dot: string }

const STATUS_STYLES: Record<AnnonceStatus, StatusVisual> = {
  // Brouillon : neutre
  draft: {
    bg: 'var(--color-background-secondary, #f1f5f9)',
    color: 'var(--color-text-secondary, #475569)',
    dot: 'var(--color-text-tertiary, #94a3b8)',
  },
  // En revue : amber warning
  pending_review: { bg: '#FEF9C3', color: '#854D0E', dot: '#CA8A04' },
  // Publiée : vert succès
  published: { bg: '#DCFCE7', color: '#166534', dot: '#16A34A' },
  // Suspendue / expirée / archivée : neutre
  suspended: {
    bg: 'var(--color-background-secondary, #f1f5f9)',
    color: 'var(--color-text-secondary, #475569)',
    dot: 'var(--color-text-tertiary, #94a3b8)',
  },
  expired: {
    bg: 'var(--color-background-secondary, #f1f5f9)',
    color: 'var(--color-text-secondary, #475569)',
    dot: 'var(--color-text-tertiary, #94a3b8)',
  },
  archived: {
    bg: 'var(--color-background-secondary, #f1f5f9)',
    color: 'var(--color-text-secondary, #475569)',
    dot: 'var(--color-text-tertiary, #94a3b8)',
  },
  // Refusée : rouge danger
  rejected: { bg: '#FEE2E2', color: '#991B1B', dot: '#DC2626' },
}

const FADED_STATUSES: readonly AnnonceStatus[] = ['suspended', 'expired', 'archived', 'rejected']
const ACTIONABLE_STATUSES: readonly AnnonceStatus[] = ['draft', 'pending_review', 'published']
// Statuts pour lesquels le lien pointe vers le formulaire d'édition.
// Aligné sur EDITABLE_STATUSES de PATCH /api/publications/[id].
const EDITABLE_STATUSES: readonly AnnonceStatus[] = ['draft', 'suspended', 'archived']

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

function formatBudget(
  min: number | null,
  max: number | null,
  unit: Annonce['budget_unit'],
  unitSuffixes: { day: string; month: string; year: string; mission: string },
): string {
  if (min == null && max == null) return ''
  const suffix = unitSuffixes[unit] ?? ''
  if (min != null && max != null) return `${Math.round(min)}-${Math.round(max)}€${suffix}`
  if (min != null) return `${Math.round(min)}€${suffix}`
  if (max != null) return `${Math.round(max)}€${suffix}`
  return ''
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

export default function AnnonceCard({ annonce, basePath }: Props) {
  const t = useTranslations('dashboard_entreprise')
  const tPub = useTranslations('publications')
  const locale = useLocale()

  const statusStyle = STATUS_STYLES[annonce.status]
  const faded = (FADED_STATUSES as readonly string[]).includes(annonce.status)
  const actionable = (ACTIONABLE_STATUSES as readonly string[]).includes(annonce.status)

  const unitSuffixes = {
    day: tPub('budget_unit.day'),
    month: tPub('budget_unit.month'),
    year: tPub('budget_unit.year'),
    mission: tPub('budget_unit.mission'),
  }
  const budgetText = formatBudget(annonce.budget_min, annonce.budget_max, annonce.budget_unit, unitSuffixes)

  // Sous-titre : date relative selon le statut.
  // - 'published'      → date de publication
  // - 'draft'/autres   → date de création
  const dateIso = annonce.status === 'published' ? annonce.published_at : annonce.created_at
  const dateLabel =
    annonce.status === 'published'
      ? tPub('dates.published_ago', { time: relativeFromNow(dateIso, locale) })
      : tPub('dates.created_ago', { time: relativeFromNow(dateIso, locale) })
  const subtitle = budgetText ? `${dateLabel} · ${budgetText}` : dateLabel

  const statusLabel = tPub(`status.${annonce.status}`)
  const typeLabel = tPub(`type.${annonce.type}`)

  // Ligne meta : Type · Branch · Speciality (jointe au "·")
  const metaParts: string[] = [typeLabel]
  if (annonce.branch_label) metaParts.push(annonce.branch_label)
  if (annonce.speciality_label) metaParts.push(annonce.speciality_label)
  const metaLine = metaParts.join(' · ')

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
        opacity: faded ? 0.7 : 1,
        transition: 'opacity .15s, box-shadow .2s',
      }}
    >
      {/* Header : titre + sous-titre + badges (statut + score IA) */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 10 }}>
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {annonce.verification_score != null && (
            <span
              title={tPub('badges.ai_score_tooltip')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '4px 10px',
                background: 'var(--color-background-secondary, #f1f5f9)',
                color: 'var(--color-text-secondary, #475569)',
                fontSize: 11,
                fontWeight: 500,
                borderRadius: 12,
              }}
            >
              {tPub('badges.ai_score', { score: Math.round(annonce.verification_score) })}
            </span>
          )}
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
            }}
          >
            <span
              aria-hidden
              style={{ width: 6, height: 6, borderRadius: '50%', background: statusStyle.dot }}
            />
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Ligne meta : Type · Branch · Speciality */}
      <div
        style={{
          fontSize: 12,
          color: 'var(--color-text-tertiary, #94a3b8)',
          marginBottom: 14,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {metaLine}
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

      {/* Footer : lien d'action.
          - Statuts éditables (draft / suspended / archived) → page d'édition.
          - Statut 'published'                             → vue candidatures
            (Lot 2c) — c'est l'écran de gestion des candidatures reçues.
          - Autres (pending_review / expired / rejected)   → page détail
            (lecture, à construire — pointe vers chemin générique). */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Link
          href={
            (EDITABLE_STATUSES as readonly string[]).includes(annonce.status)
              ? `${basePath}/annonces/${annonce.id}/modifier`
              : annonce.status === 'published'
                ? `${basePath}/annonces/${annonce.id}/candidatures`
                : `${basePath}/annonces/${annonce.id}`
          }
          style={{
            fontSize: 12,
            color: 'var(--color-text-secondary, #475569)',
            fontWeight: 500,
            textDecoration: 'none',
          }}
        >
          {actionable ? t('manage_annonce') : t('view_detail')}
        </Link>
      </div>
    </article>
  )
}
