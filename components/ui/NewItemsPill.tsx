'use client'

import { useTranslations } from 'next-intl'
import { IconArrowUp } from '@tabler/icons-react'

/**
 * <NewItemsPill> — pastille sticky top exposée par useLiveResource quand
 * `holdNewItems=true` et que de nouveaux items sont retenus.
 *
 * Position : sticky top du conteneur scrollable parent (rendu juste avant
 * la liste, pas en position fixed). Animation fade-in/slide-down.
 * Click → applyPending() (à passer par le parent via onApply).
 *
 * UX Stripe/Linear : neutre, var(--sk-accent-soft) + var(--sk-accent-ink).
 * Mobile-first : prend toute la largeur, espacement aéré.
 */

export default function NewItemsPill({
  count,
  onApply,
  variant = 'missions',
}: {
  count: number
  onApply: () => void
  /** Détermine le libellé : 'conversations' / 'missions' / 'offres' / 'generic'. */
  variant?: 'conversations' | 'missions' | 'offres' | 'generic'
}) {
  const t = useTranslations('common.new_items_pill')
  if (count <= 0) return null

  const label = (() => {
    try { return t(`${variant}_label`, { count }) }
    catch { return t('generic_label', { count }) }
  })()

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 5,
        display: 'flex',
        justifyContent: 'center',
        padding: '8px 0',
        background: 'transparent',
        pointerEvents: 'none',
      }}
    >
      <button
        type="button"
        onClick={onApply}
        style={{
          pointerEvents: 'auto',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          borderRadius: 999,
          background: 'var(--sk-accent-soft)',
          color: 'var(--sk-accent-ink)',
          border: '1px solid var(--sk-accent)',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
          boxShadow: '0 8px 20px rgba(0, 0, 0, 0.08)',
          animation: 'sk-pill-in 240ms ease-out',
        }}
        aria-live="polite"
      >
        <IconArrowUp size={15} stroke={2} />
        {label}
      </button>
      <style>{`
        @keyframes sk-pill-in {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
