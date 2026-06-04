'use client'

import type { ReactNode } from 'react'

/**
 * TimelineStep — étape de timeline (suivi candidature, etc.). Empile
 * verticalement via un conteneur parent ; le trait vertical entre étapes
 * "done" est posé en absolute via le pseudo before sur l'icône.
 */
export default function TimelineStep({
  icon,
  label,
  sub,
  state = 'done',
  isLast = false,
}: {
  icon: ReactNode
  label: string
  sub?: string | ReactNode
  state?: 'done' | 'pending' | 'failed'
  isLast?: boolean
}) {
  const colorMap = {
    done:    { bg: 'var(--sk-success-soft)', fg: 'var(--sk-success)',    rail: 'var(--sk-success-soft)' },
    pending: { bg: 'var(--sk-surface-2)',    fg: 'var(--sk-muted)',      rail: 'var(--sk-border-soft)' },
    failed:  { bg: 'var(--sk-red-soft)',     fg: 'var(--sk-red)',        rail: 'var(--sk-red-soft)' },
  }
  const s = colorMap[state]

  return (
    <div style={{ display: 'flex', gap: 13, position: 'relative', paddingBottom: isLast ? 0 : 18 }}>
      <span
        style={{
          width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: s.bg, color: s.fg, fontSize: 16, zIndex: 1,
        }}
        aria-hidden
      >
        {icon}
      </span>
      {!isLast && (
        <span
          aria-hidden
          style={{
            position: 'absolute', left: 14, top: 30, bottom: 0,
            width: 2, background: s.rail,
          }}
        />
      )}
      <div style={{ paddingTop: 3 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--sk-text)' }}>{label}</div>
        {sub && <div style={{ color: 'var(--sk-muted)', fontSize: 12.5, marginTop: 1, lineHeight: 1.45 }}>{sub}</div>}
      </div>
    </div>
  )
}
