'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import PublicationSynthesisLine, { type PublicationSynthesisData } from './PublicationSynthesisLine'

/**
 * Carte d'opportunité côté EXPERT.
 *
 * Diffère de l'AnnonceCard côté org : pas de compteurs candidatures, mais
 * affichage du score IA + reason ("pourquoi ça vous correspond"), masquage
 * de l'org si confidential, lien vers le détail.
 *
 * Pill "Nouveau" (Lot bascule "badges par item") : dérivée du champ
 * `match_status` ∈ {pending, notified, viewed, dismissed}. La pill apparaît
 * pour pending/notified (= match jamais ouvert) et disparaît dès que
 * l'expert ouvre le détail (flip vers 'viewed' côté serveur dans
 * /api/me/missions/[id]). Source unique côté DB — pas de logique 48h
 * ou last_visited.
 *
 * La synthèse publication (budget, lieu, work_mode, durée, démarrage,
 * séniorité, contrat) est rendue via <PublicationSynthesisLine> — source
 * de vérité unique partagée avec AnnonceCard et candidature expert inline.
 */

export type MissionCardData = {
  match_id: string
  match_status: string
  ai_score: number
  ai_reason: string | null
  matched_at: string
  /** PublicationSynthesis enrichi par /api/me/missions + published_at. */
  publication: PublicationSynthesisData & { published_at: string | null }
  org: { name: string | null; logo_url: string | null } | null
  /** Compétences requises (chips carte casting home). Additif — ignoré ici. */
  skills_required?: string[]
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

export default function MissionCard({
  mission,
  side = 'freelance',
}: {
  mission: MissionCardData
  /** SC7b Lot UX Finitions 2 : 'cdi' utilise /dashboard/cdi/missions/[id] */
  side?: 'freelance' | 'cdi'
}) {
  const t = useTranslations('missions.card')
  const tPub = useTranslations('publications')
  const locale = useLocale()
  const domain = useDomain()

  const { publication: pub, org, ai_score, ai_reason, match_status, matched_at } = mission
  void formatBudget
  void matched_at
  const orgName = pub.confidential ? t('confidential_org') : org?.name ?? t('confidential_org')
  // Lot bascule badges par item : "Nouveau" = match jamais ouvert par l'expert.
  // L'ouverture du détail flippe match.status → 'viewed' (cf. /api/me/missions/[id]),
  // donc la pill disparaît dès le retour sur la liste après consultation.
  const isUnread = match_status === 'pending' || match_status === 'notified'

  return (
    <Link
      href={`/dashboard/${side}/missions/${pub.id}?from=missions`}
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
      {/* Header : title + score badge + unread dot.
          Hiérarchie polish UX : title → ENTREPRISE (gros) → chips prioritaires
          → branche/spécialité reléguées en chip discret en fin. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--sk-text)', marginBottom: 4, lineHeight: 1.35 }}>
            {pub.title}
          </h3>
          <div style={{ fontSize: 13, color: 'var(--sk-muted)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, color: 'var(--sk-text)' }}>{orgName}</span>
            {pub.confidential && (
              <span title={t('confidential_tooltip')} aria-hidden style={{ opacity: 0.7 }}>🔒</span>
            )}
            {pub.published_at && (
              <>
                <span aria-hidden style={{ color: 'var(--sk-faint)' }}>·</span>
                <span style={{ color: 'var(--sk-faint)' }}>{tPub('dates.published_ago', { time: relativeFromNow(pub.published_at, locale) })}</span>
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

      {/* Synthèse parlante prioritaire (budget/contrat/lieu/work_mode/
          durée/démarrage/séniorité). */}
      <div style={{ marginBottom: 10 }}>
        <PublicationSynthesisLine pub={pub} size="sm" />
      </div>

      {/* Branche · spécialité — reléguées en ligne discrète bottom.
          Utiles pour le matching IA mais visuellement secondaires. */}
      {(pub.branch_label || pub.speciality_label) && (
        <div style={{ fontSize: 11, color: 'var(--sk-faint)', marginBottom: 10 }}>
          {[pub.branch_label, pub.speciality_label].filter(Boolean).join(' · ')}
        </div>
      )}

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
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#64748b', marginBottom: 4 }}>
            {t('why_match_label')}
          </div>
          <div>{ai_reason}</div>
        </div>
      )}

      {/* Lot global C4 : CTA explicite "Consulter la mission" / "Consulter
          l'offre". La carte entière reste cliquable (parent Link), le bouton
          est visuellement aligné à droite pour donner un point d'ancrage
          UX (Stripe/Linear). Libellé conditionnel par `side`. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            background: domain.primaryColor,
            color: '#fff',
            fontSize: 12.5,
            fontWeight: 700,
            borderRadius: 10,
            letterSpacing: '-0.1px',
          }}
        >
          {t(side === 'cdi' ? 'cta_consult_offre' : 'cta_consult_mission')}
          <span aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>→</span>
        </span>
      </div>
    </Link>
  )
}
