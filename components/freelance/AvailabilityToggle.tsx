'use client'

import { useTranslations } from 'next-intl'

/**
 * AvailabilityToggle — sélecteur disponibilité FREELANCE (home dashboard).
 *
 * Miroir exact de [components/cdi/CdiStatusToggle.tsx](../cdi/CdiStatusToggle.tsx)
 * pour le côté freelance.
 *
 * V1 : 2 états seulement.
 *  - 'available'      : "Disponible 🟢" — l'expert reçoit les matchs.
 *  - 'do_not_disturb' : "Ne pas déranger 🔕" — barrière SERVEUR :
 *                        exclu du matching (loadEligibleProfiles) et de
 *                        son propre feed (/api/me/missions). Non
 *                        contournable côté client.
 *
 * Les anciens 'busy_soon' / 'unavailable' sont migrés via SQL et le type
 * TS ne les accepte plus.
 *
 * i18n : namespace `dashboard_freelance.availability_card`.
 */

export type AvailabilityStatus = 'available' | 'do_not_disturb'

const STATUS_COLORS: Record<AvailabilityStatus, string> = {
  available: '#22c55e',
  do_not_disturb: '#ef4444',
}

const STATUS_ICONS: Record<AvailabilityStatus, string> = {
  available: '🟢',
  do_not_disturb: '🔕',
}

const OPTIONS: AvailabilityStatus[] = ['available', 'do_not_disturb']

type Props = {
  value: AvailabilityStatus | null
  onChange: (next: AvailabilityStatus) => void | Promise<void>
  disabled?: boolean
}

export default function AvailabilityToggle({ value, onChange, disabled }: Props) {
  const t = useTranslations('dashboard_freelance.availability_card')

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
              {t(`${opt}_label` as 'available_label' | 'do_not_disturb_label')}
            </div>
            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
              {t(`${opt}_hint` as 'available_hint' | 'do_not_disturb_hint')}
            </div>
          </button>
        )
      })}
    </div>
  )
}
