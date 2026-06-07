'use client'

import { useTranslations } from 'next-intl'

/**
 * Bandeau statut vérification expert (Lot vérif expert).
 *
 * États affichés :
 *   - pending              → bleu "Vérification en cours"
 *   - pending_admin_review → amber "En cours de validation par notre équipe"
 *   - rejected             → rouge "Votre demande de vérification n'a pas
 *                            abouti" + motif (review_reason)
 *   - null                 → gris "Soumettez votre profil pour le vérifier"
 *
 * État NON affiché :
 *   - approved             → return null. Le statut "vérifié" est déjà
 *                            reflété par le badge "Profil Vérifié" sous
 *                            le "Bonjour" et par la pastille à côté du
 *                            nom dans la sidebar. Un bandeau redondant
 *                            ajoutait du bruit visuel (Lot cosmétique).
 *
 * Le bandeau est conçu pour s'afficher SOUS le menu top et avant le contenu
 * principal du dashboard freelance.
 */

type Props = {
  status: string | null
  reviewReason: string | null
}

export default function VerificationBanner({ status, reviewReason }: Props) {
  const t = useTranslations('expert_verification.banner')

  // Lot cosmétique : profil approuvé → pas de bandeau (redondant avec le
  // badge "Profil Vérifié" et la pastille sidebar).
  if (status === 'approved') {
    return null
  }

  if (status === 'pending') {
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

  if (status === 'pending_admin_review') {
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

  if (status === 'rejected') {
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
      </div>
    )
  }

  // null / autre → invitation
  return (
    <div role="status" style={{ background: '#f1f5f9', border: '0.5px solid #cbd5e1', color: '#475569', padding: '12px 18px', borderRadius: 10, fontSize: 13, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
      <span aria-hidden style={{ fontSize: 16 }}>ℹ️</span>
      <div>
        <div style={{ fontWeight: 700, color: '#0f172a' }}>{t('none_title')}</div>
        <div style={{ fontSize: 12 }}>{t('none_body')}</div>
      </div>
    </div>
  )
}
