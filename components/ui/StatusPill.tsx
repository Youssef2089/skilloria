'use client'

import type { ReactNode } from 'react'

/**
 * StatusPill — pill sémantique (échange ouvert / en attente / refusée /
 * neutre / retenu). Couleur dérive de tokens, jamais d'inline color.
 *
 * Sémantique alignée Lot finitions UX (Point 4) :
 *   open   → unlocked                                 → vert
 *   won    → selected (Lot état retenu)               → doré
 *   wait   → received / in_review / shortlisted      → ambre
 *   refused→ rejected / withdrawn                    → rouge
 *   neutral→ archived / autres états neutres         → gris
 */
export type StatusPillKind = 'open' | 'won' | 'wait' | 'refused' | 'neutral' | 'accent'

const styleMap: Record<StatusPillKind, { bg: string; color: string }> = {
  open:    { bg: 'var(--sk-success-soft)', color: 'var(--sk-success-ink)' },
  // Lot état 'selected' : palette dorée. Pas de token dédié en V1 → on
  // inline les hex (amber 100 / amber 800) plutôt que de polluer le
  // theming. Si le token --sk-gold-* est introduit plus tard, basculer ici.
  won:     { bg: 'var(--sk-amber-soft)',                 color: 'var(--sk-amber)' },
  wait:    { bg: 'var(--sk-amber-soft)',   color: 'var(--sk-amber)' },
  refused: { bg: 'var(--sk-red-soft)',     color: 'var(--sk-red)' },
  neutral: { bg: 'var(--sk-surface-2)',    color: 'var(--sk-muted)' },
  accent:  { bg: 'var(--sk-accent-soft)',  color: 'var(--sk-accent-ink)' },
}

export default function StatusPill({
  kind,
  icon,
  children,
  size = 'md',
  wrap = false,
}: {
  kind: StatusPillKind
  icon?: ReactNode
  children: ReactNode
  size?: 'sm' | 'md'
  /**
   * Le libellé peut-il passer à la ligne ? Une pastille d'ÉTAT DE VIE porte une date (« Échange ouvert jusqu'au
   * 17 octobre ») : sur une ligne, dans une carte étroite qui coupe ce qui déborde, la fin de la date disparaissait
   * (lot alertes). Les pastilles courtes gardent une seule ligne.
   */
  wrap?: boolean
}) {
  const s = styleMap[kind]
  const isSm = size === 'sm'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: isSm ? 11 : 11.5,
        fontWeight: 600,
        padding: isSm ? '4px 9px' : '5px 11px',
        borderRadius: wrap ? 12 : 999,
        background: s.bg,
        color: s.color,
        whiteSpace: wrap ? 'normal' : 'nowrap',
        lineHeight: wrap ? 1.3 : 1,
        maxWidth: '100%',
        minWidth: 0,
      }}
    >
      {icon && <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>}
      {children}
    </span>
  )
}
