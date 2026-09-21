'use client'

import { useTranslations } from 'next-intl'

/**
 * CdiStatusToggle — sélecteur statut écoute marché CDI.
 *
 * Lot disponibilité : 2 états seulement.
 *  - 'employed'     : "Ne pas déranger 🔕" — l'expert n'apparaît PAS dans
 *                     le matching ni dans son propre feed (barrière
 *                     serveur). Valeur DB `employed` conservée pour
 *                     compat (relabel UI uniquement).
 *  - 'open_to_work' : "À l'écoute du marché" — matché + reçoit propositions.
 *
 * 'actively_searching' retiré (V1) : valeur migrée vers 'open_to_work'
 * via SQL (cf. récap commit). Le type TS exclut désormais cette valeur.
 */

export type CdiStatus = 'employed' | 'open_to_work'

const STATUS_COLORS: Record<CdiStatus, string> = {
  employed: 'var(--sk-red)',
  open_to_work: 'var(--sk-success)',
}

const STATUS_ICONS: Record<CdiStatus, string> = {
  employed: '🔕',
  open_to_work: '👀',
}

const OPTIONS: CdiStatus[] = ['open_to_work', 'employed']

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
              background: active ? `color-mix(in srgb, ${color} 6%, transparent)` : 'var(--sk-surface)',
              border: `2px solid ${active ? color : 'var(--sk-border)'}`,
              borderRadius: 14,
              padding: '14px 16px',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.6 : 1,
              transition: 'all 0.2s ease',
              fontFamily: 'inherit',
              outline: 'none',
              boxShadow: active ? `0 4px 14px color-mix(in srgb, ${color} 20%, transparent)` : 'none',
            }}
          >
            <div style={{ fontSize: 22, marginBottom: 6 }} aria-hidden>
              {STATUS_ICONS[opt]}
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: active ? color : 'var(--sk-text)',
                marginBottom: 4,
                letterSpacing: '-0.2px',
              }}
            >
              {t(`${opt}_label` as 'employed_label' | 'open_to_work_label')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--sk-muted)', lineHeight: 1.5 }}>
              {t(`${opt}_hint` as 'employed_hint' | 'open_to_work_hint')}
            </div>
          </button>
        )
      })}
    </div>
  )
}
