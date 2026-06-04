'use client'

import type { ReactNode } from 'react'

/**
 * EmptyState — état vide cohérent (icône + titre + body) sur fond surface.
 * Utilisé par les listes (candidatures, missions, messages) et les empty
 * states de détail.
 */
export default function EmptyState({
  icon,
  title,
  body,
  action,
  surface = 'card',
}: {
  icon?: ReactNode
  title: string
  body?: string | ReactNode
  action?: ReactNode
  /** 'card' = fond surface bordé ; 'plain' = pas de fond (centré simple). */
  surface?: 'card' | 'plain'
}) {
  const inner = (
    <>
      {icon && <div style={{ fontSize: 32, marginBottom: 10, color: 'var(--sk-faint)' }} aria-hidden>{icon}</div>}
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--sk-text)', marginBottom: body ? 6 : 0 }}>{title}</div>
      {body && (
        <div style={{ fontSize: 13, color: 'var(--sk-muted)', lineHeight: 1.55, maxWidth: 360, margin: '0 auto' }}>
          {body}
        </div>
      )}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </>
  )

  if (surface === 'plain') {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center' }}>{inner}</div>
    )
  }
  return (
    <div
      style={{
        background: 'var(--sk-surface)',
        border: '1px solid var(--sk-border)',
        borderRadius: 'var(--sk-r-lg)',
        padding: '40px 24px',
        textAlign: 'center',
      }}
    >
      {inner}
    </div>
  )
}
