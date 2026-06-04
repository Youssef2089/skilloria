'use client'

/**
 * StatsStrip — barre de cartes métriques (n + label, color optionnelle).
 * Pattern : 4 cartes côte-à-côte sur desktop, 2x2 sur mobile, fond surface.
 */
export type Stat = {
  value: string | number | null   // null → "—" (loading / pas dispo)
  label: string
  emphasis?: 'default' | 'success' | 'amber' | 'red'
}

const colorMap: Record<NonNullable<Stat['emphasis']>, string> = {
  default: 'var(--sk-text)',
  success: 'var(--sk-success-ink)',
  amber:   'var(--sk-amber)',
  red:     'var(--sk-red)',
}

export default function StatsStrip({ stats }: { stats: Stat[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.max(2, Math.min(stats.length, 4))}, 1fr)`,
        gap: 12,
        padding: '14px 26px 16px',
      }}
      className="sk-stats-strip"
    >
      <style>{`
        @media (max-width: 640px) {
          .sk-stats-strip { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
      {stats.map((s, i) => {
        const display = s.value == null ? '—' : s.value
        const color = colorMap[s.emphasis ?? 'default']
        return (
          <div
            key={i}
            style={{
              background: 'var(--sk-surface)',
              border: '1px solid var(--sk-border)',
              borderRadius: 'var(--sk-r-lg)',
              padding: '13px 16px',
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.5px', color, lineHeight: 1.1 }}>
              {display}
            </div>
            <div style={{ color: 'var(--sk-muted)', fontSize: 12.5, marginTop: 4 }}>{s.label}</div>
          </div>
        )
      })}
    </div>
  )
}
