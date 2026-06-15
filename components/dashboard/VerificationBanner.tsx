'use client'

import { useTranslations } from 'next-intl'
import { deriveVerificationUiState } from '@/lib/verification-state'

/**
 * Bandeau statut vérification expert — source unique partagée par les
 * dashboards freelance ET CDI (fini le bandeau figé "analyse IA en cours").
 *
 * L'état est déduit via deriveVerificationUiState({ visible, status }) :
 *   - draft        → gris  "Profil en brouillon — publiez-le pour lancer la vérification"
 *   - pending      → bleu  "Vérification en cours"
 *   - admin_review → amber "En attente de validation"
 *   - approved     → vert  "Profil vérifié"
 *   - rejected     → rouge "Profil refusé" + motif (review_reason)
 *
 * CTA optionnel (onCta + ctaLabel) : affiché uniquement sur les états
 * actionnables (draft, rejected) pour inviter à compléter / re-déposer le CV.
 */

type Props = {
  visible: boolean | null
  status: string | null
  reviewReason: string | null
  ctaLabel?: string
  onCta?: () => void
}

export default function VerificationBanner({
  visible,
  status,
  reviewReason,
  ctaLabel,
  onCta,
}: Props) {
  const t = useTranslations('expert_verification.banner')
  const state = deriveVerificationUiState({ visible, verificationStatus: status })

  const showCta = !!onCta && !!ctaLabel && (state === 'draft' || state === 'rejected')
  const cta = showCta ? (
    <button
      type="button"
      onClick={onCta}
      style={{
        marginTop: 12,
        fontSize: 13,
        fontWeight: 600,
        padding: '9px 16px',
        borderRadius: 8,
        background: '#fff',
        border: '1px solid currentColor',
        color: 'inherit',
        cursor: 'pointer',
      }}
    >
      {ctaLabel}
    </button>
  ) : null

  if (state === 'approved') {
    return (
      <div role="status" style={{ background: '#DCFCE7', border: '1px solid #BBF7D0', color: '#15803D', padding: '12px 18px', borderRadius: 10, fontSize: 13, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span aria-hidden style={{ fontSize: 16 }}>✓</span>
        <div>
          <div style={{ fontWeight: 700 }}>{t('approved_title')}</div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>{t('approved_body')}</div>
        </div>
      </div>
    )
  }

  if (state === 'pending') {
    return (
      <div role="status" style={{ background: '#DBEAFE', border: '1px solid #93C5FD', color: '#1E40AF', padding: '12px 18px', borderRadius: 10, fontSize: 13, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span aria-hidden style={{ fontSize: 16 }}>⏳</span>
        <div>
          <div style={{ fontWeight: 700 }}>{t('pending_title')}</div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>{t('pending_body')}</div>
        </div>
      </div>
    )
  }

  if (state === 'admin_review') {
    return (
      <div role="status" style={{ background: '#FEF9C3', border: '1px solid #FACC15', color: '#854D0E', padding: '12px 18px', borderRadius: 10, fontSize: 13, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span aria-hidden style={{ fontSize: 16 }}>🛡️</span>
        <div>
          <div style={{ fontWeight: 700 }}>{t('admin_review_title')}</div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>{t('admin_review_body')}</div>
        </div>
      </div>
    )
  }

  if (state === 'rejected') {
    return (
      <div role="alert" style={{ background: '#FEE2E2', border: '1px solid #FECACA', color: '#991B1B', padding: '14px 18px', borderRadius: 10, fontSize: 13, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: reviewReason ? 6 : 0 }}>
          <span aria-hidden style={{ fontSize: 16 }}>✕</span>
          <div style={{ fontWeight: 700 }}>{t('rejected_title')}</div>
        </div>
        {reviewReason ? (
          <div style={{ fontSize: 12, paddingLeft: 26, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
            <strong>{t('rejected_reason_label')} </strong>{reviewReason}
          </div>
        ) : (
          <div style={{ fontSize: 12, paddingLeft: 26 }}>{t('rejected_body')}</div>
        )}
        {cta}
      </div>
    )
  }

  // draft → invitation à publier pour lancer la vérification
  return (
    <div role="status" style={{ background: '#f1f5f9', border: '0.5px solid #cbd5e1', color: '#475569', padding: '12px 18px', borderRadius: 10, fontSize: 13, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span aria-hidden style={{ fontSize: 16 }}>📝</span>
        <div>
          <div style={{ fontWeight: 700, color: '#0f172a' }}>{t('draft_title')}</div>
          <div style={{ fontSize: 12 }}>{t('draft_body')}</div>
        </div>
      </div>
      {cta}
    </div>
  )
}
