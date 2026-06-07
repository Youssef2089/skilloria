'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import type { MissionCardData } from './MissionCard'
import PublicationSynthesisLine from './PublicationSynthesisLine'

/**
 * MissionMiniCard — variante compacte de MissionCard pour les sections
 * "Missions recommandées" / "Offres recommandées" des dashboards home
 * (freelance + cdi).
 *
 * Hiérarchie polish UX (Stripe/Linear) :
 *   1. Titre (compact, ellipsis)
 *   2. Entreprise (respect confidential) — ligne secondaire
 *   3. Chips synthèse 'sm' : budget + lieu + mode de travail (3-4 max)
 *   4. Badge score IA flottant à droite
 * Branche/spécialité retirées (pas pertinentes en mini).
 *
 * Pill "Nouveau" : prop `isNew` calculée par le parent (Lot global C2)
 * à partir du snapshot figé de `last_visited_at` de la section 'missions'.
 * Source unique alignée sur MissionCard.
 *
 * useDomain — aucune couleur en dur, var(--sk-*).
 */

export default function MissionMiniCard({
  mission,
  side = 'freelance',
  isNew = false,
}: {
  mission: MissionCardData
  side?: 'freelance' | 'cdi'
  /** Lot global C2 : voir MissionCard. */
  isNew?: boolean
}) {
  const tCard = useTranslations('missions.card')
  const domain = useDomain()

  const { publication: pub, org, ai_score } = mission
  const orgName = pub.confidential ? tCard('confidential_org') : org?.name ?? tCard('confidential_org')
  const isFresh = isNew

  return (
    <Link
      href={`/dashboard/${side}/missions/${pub.id}`}
      style={{
        display: 'block',
        background: 'var(--sk-surface)',
        border: isFresh ? `1.5px solid ${domain.primaryColor}` : '0.5px solid var(--sk-border)',
        borderRadius: 12,
        padding: '12px 14px',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'box-shadow .15s, border-color .15s',
      }}
    >
      {/* Header : title + score badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sk-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.35 }}>
            {pub.title}
          </div>
          <div style={{ fontSize: 12, color: 'var(--sk-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span>{orgName}</span>
            {pub.confidential && (
              <span title={tCard('confidential_tooltip')} aria-hidden style={{ opacity: 0.7 }}>🔒</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <span
            style={{
              padding: '3px 9px',
              background: `${domain.primaryColor}1A`,
              color: domain.primaryColor,
              fontSize: 11,
              fontWeight: 700,
              borderRadius: 10,
              whiteSpace: 'nowrap',
            }}
          >
            {Math.round(ai_score)}/10
          </span>
          {isFresh && (
            <span style={{ fontSize: 10, fontWeight: 600, color: domain.primaryColor, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              {tCard('new_label')}
            </span>
          )}
        </div>
      </div>

      {/* Synthèse parlante (chips compactes). Le composant filtre les nulls
          déjà — on ne s'embarrasse pas de l'ordre/limite ici, l'UX
          mobile-first gère le wrap. */}
      <PublicationSynthesisLine pub={pub} size="sm" />
    </Link>
  )
}
