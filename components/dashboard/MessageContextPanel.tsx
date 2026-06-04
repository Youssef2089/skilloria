'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import {
  IconCircleCheck,
  IconExternalLink,
  IconCoin,
  IconMapPin,
  IconClock,
  IconCalendarEvent,
} from '@tabler/icons-react'

/**
 * MessageContextPanel — 3ᵉ zone de la messagerie (Lot refonte UX commit B/C,
 * enrichi SC4 du Lot UX Finitions 2 avec méta inline budget/lieu/durée/début/
 * compétences).
 *
 * Affiche les méta de la mission/annonce associée à la conversation
 * sélectionnée + lien "Voir la mission" / "Voir l'annonce". Reçoit la
 * publication enrichie en prop depuis MessagesInbox (qui dispose des champs
 * via /api/me/conversations).
 *
 * Scope strict : la conv est forcément unlocked + non expirée (RLS +
 * /api/me/conversations filtre). Aucune fuite de messagerie libre.
 */

export type MessageContextPublication = {
  id: string
  type: string
  title: string
  budget_min: number | null
  budget_max: number | null
  location: string | null
  duration: string | null
  start_date: string | null
  skills_required: string[] | null
}

function formatBudget(min: number | null, max: number | null, unit: string): string | null {
  if (min == null && max == null) return null
  const fmt = (v: number) => `${v.toLocaleString('fr-FR')} €`
  if (min != null && max != null && min !== max) return `${fmt(min)} – ${fmt(max)}${unit}`
  const v = (min ?? max) as number
  return `${fmt(v)}${unit}`
}

function formatDate(iso: string | null, locale: string): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

export default function MessageContextPanel({
  publication,
  side,
  locale,
}: {
  publication: MessageContextPublication | null
  side: 'freelance' | 'entreprise' | 'cdi'
  locale?: string
}) {
  const t = useTranslations('messages.context')
  const tPub = useTranslations('publications')

  if (!publication) {
    return (
      <aside style={{ background: 'var(--sk-surface)', borderLeft: '1px solid var(--sk-border)', padding: '20px 18px', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>
        <div style={{ textAlign: 'center', color: 'var(--sk-muted)', fontSize: 13 }}>
          {t('no_publication')}
        </div>
      </aside>
    )
  }

  const isCdi = publication.type === 'offre'
  const budgetUnit = isCdi ? tPub('budget_unit.year') : tPub('budget_unit.day')
  const budgetText = formatBudget(publication.budget_min, publication.budget_max, ` ${budgetUnit}`)
  const startText = formatDate(publication.start_date, locale ?? 'fr-FR')
  const skills = (publication.skills_required ?? []).filter((s) => typeof s === 'string' && s.trim().length > 0).slice(0, 8)

  const missionHref = side === 'freelance'
    ? `/dashboard/freelance/missions/${publication.id}`
    : side === 'cdi'
      ? `/dashboard/cdi/missions/${publication.id}`
      : `/dashboard/entreprise/annonces/${publication.id}/candidatures`

  const ctaLabel = side === 'entreprise' ? t('view_annonce') : t('view_mission')

  const metaRow = (icon: React.ReactNode, label: string, value: string) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderTop: '1px solid var(--sk-border)' }}>
      <span style={{ color: 'var(--sk-faint)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
        {icon}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 11, color: 'var(--sk-faint)', fontWeight: 600, letterSpacing: '0.3px', textTransform: 'uppercase' }}>{label}</div>
        <div style={{ fontSize: 13, color: 'var(--sk-text)', marginTop: 2, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{value}</div>
      </div>
    </div>
  )

  return (
    <aside style={{ background: 'var(--sk-surface)', borderLeft: '1px solid var(--sk-border)', padding: '20px 18px', overflowY: 'auto', minWidth: 0 }}>
      <div style={{ color: 'var(--sk-faint)', fontSize: 11, fontWeight: 600, letterSpacing: '0.4px', textTransform: 'uppercase', marginBottom: 12 }}>
        {t('about_label')}
      </div>

      <div style={{ border: '1px solid var(--sk-border)', borderRadius: 'var(--sk-r-lg)', padding: 16, background: 'var(--sk-surface)' }}>
        <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.35, letterSpacing: '-0.2px', color: 'var(--sk-text)' }}>
          {publication.title}
        </div>
        <div style={{ color: 'var(--sk-muted)', fontSize: 12.5, marginTop: 5 }}>
          {tPub(`type.${publication.type}`)}
        </div>

        <div style={{ marginTop: 14 }}>
          {budgetText && metaRow(<IconCoin size={15} stroke={1.8} />, isCdi ? t('budget_label') : t('tjm_label'), budgetText)}
          {publication.location && metaRow(<IconMapPin size={15} stroke={1.8} />, t('location_label'), publication.location)}
          {publication.duration && metaRow(<IconClock size={15} stroke={1.8} />, t('duration_label'), publication.duration)}
          {startText && metaRow(<IconCalendarEvent size={15} stroke={1.8} />, t('start_label'), startText)}
        </div>

        {skills.length > 0 && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--sk-border)' }}>
            <div style={{ fontSize: 11, color: 'var(--sk-faint)', fontWeight: 600, letterSpacing: '0.3px', textTransform: 'uppercase', marginBottom: 8 }}>
              {t('skills_label')}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {skills.map((s) => (
                <span
                  key={s}
                  style={{
                    fontSize: 11.5,
                    padding: '4px 9px',
                    borderRadius: 999,
                    background: 'var(--sk-surface-2)',
                    color: 'var(--sk-muted)',
                    border: '1px solid var(--sk-border)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Indicateur "Profil débloqué" — toute conv visible ici est forcément
            issue d'une candidature unlocked (RLS scope strict). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontSize: 13, fontWeight: 600, color: 'var(--sk-success)' }}>
          <IconCircleCheck size={16} stroke={2} />
          {side === 'entreprise' ? t('exchange_open_org') : t('exchange_open_expert')}
        </div>

        <Link
          href={missionHref}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            marginTop: 14, width: '100%', textAlign: 'center',
            padding: '11px 0', borderRadius: 11,
            background: 'var(--sk-accent)', color: '#fff', textDecoration: 'none',
            fontSize: 13.5, fontWeight: 600,
          }}
        >
          <IconExternalLink size={15} stroke={2} />
          {ctaLabel}
        </Link>
      </div>
    </aside>
  )
}
