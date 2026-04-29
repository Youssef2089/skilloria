'use client'

import { useTranslations } from 'next-intl'

export type CdiStatus = 'employed' | 'open_to_work' | 'actively_searching'

const STATUS_COLORS: Record<CdiStatus, string> = {
  employed: '#94a3b8',
  open_to_work: '#10b981',
  actively_searching: '#f97316',
}

const STATUS_ICONS: Record<CdiStatus, string> = {
  employed: '💼',
  open_to_work: '👀',
  actively_searching: '🚀',
}

const OPTIONS: CdiStatus[] = ['employed', 'open_to_work', 'actively_searching']

type Props = {
  value: CdiStatus | null
  onChange: (next: CdiStatus) => void | Promise<void>
  disabled?: boolean
}

export default function CdiStatusToggle({ value, onChange, disabled }: Props) {
  const t = useTranslations('dashboard_cdi.market_status_card')

  return (
    <div
      role="radiogroup"
      aria-label={t('title')}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 12,
      }}
    >
      {OPTIONS.map(opt => {
        const active = value === opt
        const color = STATUS_COLORS[opt]
        return (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(opt)}
            style={{
              textAlign: 'left',
              background: active ? `${color}10` : '#fff',
              border: `2px solid ${active ? color : '#e2e8f0'}`,
              borderRadius: 14,
              padding: '14px 16px',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.6 : 1,
              transition: 'all 0.2s ease',
              fontFamily: 'inherit',
              outline: 'none',
              boxShadow: active ? `0 4px 14px ${color}33` : 'none',
            }}
          >
            <div style={{ fontSize: 22, marginBottom: 6 }} aria-hidden>
              {STATUS_ICONS[opt]}
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: active ? color : '#0f172a',
                marginBottom: 4,
                letterSpacing: '-0.2px',
              }}
            >
              {t(`${opt}_label` as 'employed_label' | 'open_to_work_label' | 'actively_searching_label')}
            </div>
            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
              {t(`${opt}_hint` as 'employed_hint' | 'open_to_work_hint' | 'actively_searching_hint')}
            </div>
          </button>
        )
      })}
    </div>
  )
}
