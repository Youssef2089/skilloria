'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useRelativeTime } from '@/lib/use-relative-time'
import { Link } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import type { Annonce, AnnonceStatus } from '@/types/annonce'
import PublicationSynthesisLine, { type PublicationSynthesisData } from './PublicationSynthesisLine'

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
  /** Base du dashboard courant ('/dashboard/entreprise' | '/dashboard/freelance' | '/dashboard/cdi'). */
  basePath: string
  /** Lien d'action explicite (override). Fourni côté sous-traitance (une seule
   *  page de détail) ; absent → logique entreprise par statut (édition /
   *  candidatures / fiche). */
  href?: string
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

export default function AnnonceCard({ annonce, basePath, href }: Props) {
  const t = useTranslations('dashboard_entreprise')
  const tPub = useTranslations('publications')
  const locale = useLocale()
  const relTime = useRelativeTime()
  const domain = useDomain()

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
      ? tPub('dates.published_ago', { time: relTime(dateIso) })
      : tPub('dates.created_ago', { time: relTime(dateIso) })
  const subtitle = budgetText ? `${dateLabel} · ${budgetText}` : dateLabel

  const statusLabel = tPub(`status.${annonce.status}`)
  const typeLabel = tPub(`type.${annonce.type}`)

  // Ligne meta : Type · Branch · Speciality (jointe au "·")
  const metaParts: string[] = [typeLabel]
  if (annonce.branch_label) metaParts.push(annonce.branch_label)
  if (annonce.speciality_label) metaParts.push(annonce.speciality_label)
  const metaLine = metaParts.join(' · ')

  // Lot refonte entonnoir : 4 buckets EXCLUSIFS qui s'additionnent au total.
  // - À consulter en accent useDomain (action requise côté org)
  // - Acceptées en vert succès
  // - Refusées en rouge tertiaire (faible visibilité, c'est un état clos)
  // Codes DB intacts ; libellés via i18n dashboard_entreprise.funnel.*.
  // Lot compteurs : on affiche l'entonnoir ACTIF, dérivé serveur (état de vie).
  // Sur une annonce expirée ou clôturée, les candidatures basculent en archivé
  // et la carte tombe à 0 — exactement ce que montre l'onglet « Actives » de la
  // page candidatures. Le client ne recalcule rien : il lit le bucket servi.
  const c = annonce.candidatures.active
  const counters: Array<{ key: string; label: string; value: number; color?: string }> = [
    { key: 'to_review', label: t('funnel.to_review'), value: Math.round(c.to_review), color: domain.primaryColor },
    { key: 'in_progress', label: t('funnel.in_progress'), value: Math.round(c.in_progress) },
    { key: 'accepted', label: t('funnel.accepted'), value: Math.round(c.accepted), color: '#16A34A' },
    { key: 'rejected', label: t('funnel.rejected'), value: Math.round(c.rejected) },
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
          marginBottom: 10,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {metaLine}
      </div>

      {/* Lot synthèse parlante — chips (budget/lieu/work_mode/durée/début/séniorité/contrat). */}
      {(() => {
        const synthData: PublicationSynthesisData = {
          id: annonce.id,
          type: annonce.type,
          title: annonce.title,
          budget_min: annonce.budget_min,
          budget_max: annonce.budget_max,
          budget_unit: annonce.type === 'offre' ? 'year' : 'day',
          location: annonce.location,
          work_mode: annonce.work_mode,
          duration: annonce.duration,
          start_date: annonce.start_date,
          seniority: annonce.seniority,
          branch_label: annonce.branch_label,
          speciality_label: annonce.speciality_label,
          confidential: annonce.confidential,
        }
        return (
          <div style={{ marginBottom: 14 }}>
            <PublicationSynthesisLine pub={synthData} size="sm" />
          </div>
        )
      })()}

      {/* Section candidatures — chiffre lead (total) + 4 buckets exclusifs */}
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
        {/* Total en lead */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-text-primary, #0f172a)', lineHeight: 1, letterSpacing: '-0.5px' }}>
            {Math.round(c.total)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--color-text-secondary, #64748b)', fontWeight: 500 }}>
            {t('funnel.total_suffix')}
          </span>
        </div>

        {/* 4 buckets */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, flex: 1, minWidth: 220 }}>
          {counters.map((cnt) => {
            const isZero = cnt.value === 0
            const valueColor = isZero
              ? 'var(--color-text-tertiary, #94a3b8)'
              : cnt.color ?? 'var(--color-text-primary, #0f172a)'
            return (
              <div key={cnt.key} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: valueColor, lineHeight: 1 }}>
                  {cnt.value}
                </div>
                <div style={{ fontSize: 10, color: 'var(--color-text-secondary, #64748b)', marginTop: 4 }}>
                  {cnt.label}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Footer : lien d'action.
          - Statuts éditables (draft / suspended / archived) → page d'édition.
          - Statut 'published'                              → vue candidatures
            (casting) — c'est l'écran de gestion des candidatures reçues.
          - Autres (pending_review / expired / rejected)    → fiche détail
            (lecture seule de l'annonce, page créée au Lot refonte dashboard). */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Link
          href={
            href ?? (
              (EDITABLE_STATUSES as readonly string[]).includes(annonce.status)
                ? `${basePath}/annonces/${annonce.id}/modifier`
                : annonce.status === 'published'
                  ? `${basePath}/annonces/${annonce.id}/candidatures`
                  : `${basePath}/annonces/${annonce.id}`
            )
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
