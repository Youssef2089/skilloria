'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'

/**
 * CandidatureMiniCard — variante compacte pour la section "Vos candidatures
 * (3 dernières)" des dashboards home (freelance + cdi).
 *
 * Hiérarchie : Titre publi → Status pill (couleur sémantique) → Score IA.
 * useDomain — aucune couleur en dur.
 *
 * Lien vers /dashboard/{side}/candidatures (vue complète tracking).
 */

export type CandidatureMiniItem = {
  id: string
  publication_id: string
  publication: { id: string; type: string; title: string; status: string } | null
  status: string
  ai_match_score: number | null
  conversation_id: string | null
  created_at: string
  /** Lot bascule badges par item : true si déjà consultée par cet user. */
  viewed_by_me?: boolean
}

function statusVisual(status: string, accent: string): { bg: string; color: string } {
  // Lot état 'selected' : palette dorée (cf. StatusPill.won).
  if (status === 'selected') return { bg: '#FEF3C7', color: '#92400E' }
  if (status === 'unlocked') return { bg: 'var(--sk-success-soft)', color: 'var(--sk-success)' }
  if (status === 'rejected') return { bg: 'var(--sk-red-soft)', color: 'var(--sk-red)' }
  return { bg: 'var(--sk-amber-soft)', color: accent }
}

export default function CandidatureMiniCard({
  candidature,
  side = 'freelance',
}: {
  candidature: CandidatureMiniItem
  side?: 'freelance' | 'cdi'
}) {
  const domain = useDomain()
  // i18n : freelance home utilise dashboard_freelance.cards.your_candidatures ;
  // cdi home utilise dashboard_cdi.applications_section. Les deux ont la même
  // shape { ai_score, status.{received,...} }.
  const t = useTranslations(
    side === 'cdi'
      ? 'dashboard_cdi.applications_section'
      : 'dashboard_freelance.cards.your_candidatures',
  )
  // Source unique pour la pill "Nouveau" (Lot bascule badges par item) —
  // alignée avec CandidatureCard, MissionCard, MissionMiniCard,
  // CandidaturesTrackingView. Avant ce fix on appelait t('new_label')
  // dans un namespace qui n'a pas la clé → next-intl rendait la clé brute
  // (ex. "DASHBOARD_FREELANCE.CARDS.YOUR_CANDIDATURES.NEW_LABEL").
  const tCandCard = useTranslations('candidatures.card')

  const sv = statusVisual(candidature.status, domain.primaryColor)
  const detailHref = `/dashboard/${side}/candidatures`
  // Lot bascule badges par item : pill "Nouveau" + bordure accentuée si
  // la candidature n'a pas encore été consultée par l'user courant.
  const isUnviewed = candidature.viewed_by_me === false
  const isClosed = candidature.status === 'rejected' || candidature.status === 'withdrawn' || candidature.status === 'archived'
  const showFresh = isUnviewed && !isClosed

  return (
    <Link
      href={detailHref}
      style={{
        display: 'block',
        background: 'var(--sk-surface)',
        border: showFresh ? `1.5px solid ${domain.primaryColor}` : '0.5px solid var(--sk-border)',
        borderRadius: 12,
        padding: '12px 14px',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'box-shadow .15s, border-color .15s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sk-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.35 }}>
            {candidature.publication?.title ?? '—'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '3px 9px',
                background: sv.bg,
                color: sv.color,
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 999,
                textTransform: 'uppercase',
                letterSpacing: '.04em',
              }}
            >
              {(() => {
                try {
                  // Label conditionnel par type publication pour 'selected'.
                  if (candidature.status === 'selected') {
                    const pubType = candidature.publication?.type
                    return t(pubType === 'mission' ? 'status_selected_mission' : 'status_selected_offre')
                  }
                  return t(`status.${candidature.status}` as 'status.received')
                } catch { return candidature.status }
              })()}
            </span>
            {candidature.ai_match_score != null && (
              <span style={{ fontSize: 11.5, color: 'var(--sk-muted)' }}>
                {t('ai_score', { score: Math.round(candidature.ai_match_score) })}
              </span>
            )}
            {showFresh && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: domain.primaryColor,
                  textTransform: 'uppercase',
                  letterSpacing: '.05em',
                }}
              >
                {tCandCard('new_label')}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}
