'use client'

import type { ReactNode } from 'react'

/**
 * StatusPill — pill sémantique (échange ouvert / en attente / refusée /
 * neutre). Couleur dérive de tokens, jamais d'inline color.
 *
 * Sémantique alignée Lot finitions UX (Point 4) :
 *   open   → unlocked + status='open'                → vert
 *   wait   → received / in_review / shortlisted      → ambre
 *   refused→ rejected / withdrawn                    → rouge
 *   neutral→ archived / autres états neutres         → gris
 */
export type StatusPillKind = 'open' | 'wait' | 'refused' | 'neutral' | 'accent'

const styleMap: Record<StatusPillKind, { bg: string; color: string }> = {
  open:    { bg: 'var(--sk-success-soft)', color: 'var(--sk-success-ink)' },
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
}: {
  kind: StatusPillKind
  icon?: ReactNode
  children: ReactNode
  size?: 'sm' | 'md'
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
        borderRadius: 999,
        background: s.bg,
        color: s.color,
        whiteSpace: 'nowrap',
        lineHeight: 1,
      }}
    >
      {icon && <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center' }}>{icon}</span>}
      {children}
    </span>
  )
}
