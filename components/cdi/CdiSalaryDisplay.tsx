'use client'

import { useLocale, useTranslations } from 'next-intl'

type Props = {
  min: number | null
  max: number | null
  variablePct: number | null
}

function formatNumber(n: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(n)
  } catch {
    return String(n)
  }
}

export default function CdiSalaryDisplay({ min, max, variablePct }: Props) {
  const t = useTranslations('cdi_profile_view.labels')
  const tEmpty = useTranslations('cdi_profile_view.empty_states')
  const locale = useLocale()

  const hasSalary = min != null || max != null
  const hasVariable = variablePct != null

  if (!hasSalary && !hasVariable) {
    return (
      <div style={{ fontSize: 14, color: '#94a3b8', fontStyle: 'italic' }}>
        {tEmpty('no_compensation')}
      </div>
    )
  }

  let salaryText: string | null = null
  if (min != null && max != null) {
    salaryText = t('salary_range', {
      min: formatNumber(min, locale),
      max: formatNumber(max, locale),
    })
  } else if (min != null) {
    salaryText = t('salary_range_min_only', { min: formatNumber(min, locale) })
  } else if (max != null) {
    salaryText = t('salary_range_max_only', { max: formatNumber(max, locale) })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {salaryText && (
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: '#0f172a',
            letterSpacing: '-0.3px',
          }}
        >
          {salaryText}
        </div>
      )}
      {hasVariable && (
        <div style={{ fontSize: 13, color: '#64748b' }}>
          {t('variable_pct', { pct: variablePct as number })}
        </div>
      )}
    </div>
  )
}
