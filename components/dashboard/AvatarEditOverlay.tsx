'use client'

import { useTranslations } from 'next-intl'

/**
 * AvatarEditOverlay — bouton "Modifier la photo" superposé sur l'avatar de
 * la page Mon profil (Lot global C3). Posté en absolute en bas-droite du
 * conteneur parent (qui doit être `position: relative`).
 *
 * Usage :
 *   <div style={{ position: 'relative', display: 'inline-block' }}>
 *     <img src={photo_url} ... />
 *     <AvatarEditOverlay onClick={() => setAvatarModalOpen(true)} />
 *   </div>
 *
 * i18n : namespace `dashboard_freelance.avatar_modal.edit_overlay_cta`
 * (cross-namespace côté CDI accepté, cf. AvatarUploadModal qui utilise déjà
 * le même namespace pour les 2 sides).
 */

type Props = {
  onClick: () => void
  ariaLabel?: string
}

export default function AvatarEditOverlay({ onClick, ariaLabel }: Props) {
  const t = useTranslations('dashboard_freelance.avatar_modal')
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? t('edit_overlay_cta')}
      title={t('edit_overlay_cta')}
      style={{
        position: 'absolute',
        bottom: -4,
        right: -4,
        width: 36,
        height: 36,
        borderRadius: '50%',
        background: '#fff',
        border: '1.5px solid var(--sk-border)',
        boxShadow: '0 4px 12px rgba(15, 23, 42, 0.12)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--sk-text)',
        transition: 'transform .15s, box-shadow .15s',
        padding: 0,
        fontFamily: 'inherit',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'scale(1.08)'
        e.currentTarget.style.boxShadow = '0 6px 18px rgba(15, 23, 42, 0.18)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'scale(1)'
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(15, 23, 42, 0.12)'
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
      </svg>
    </button>
  )
}
