'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/packages — catalogue commerce (liste). Édition seule via [id].
 * Source : GET /api/admin/list-packages (service-role).
 *
 * Refonte UX : tableau lisible (pattern listes admin), libellés HUMAINS —
 * aucun feature_code snake_case à l'écran. Résumé des limites en langage clair.
 */

type Feature = { feature_code: string; value: string; reset_period: string | null }
type Package = {
  id: string
  name: string
  slug: string
  target_role: string
  price_monthly: number | null
  price_yearly: number | null
  currency: string
  is_default: boolean
  active: boolean
  scope: string
  features: Feature[]
}

// Ordre d'affichage stable des limites dans le résumé + clé i18n plurielle.
const SUMMARY_ORDER: { code: string; key: string }[] = [
  { code: 'publications_per_month', key: 'summary_publications' },
  { code: 'active_publications_max', key: 'summary_active' },
  { code: 'revealed_candidates_per_publication', key: 'summary_revealed' },
  { code: 'manual_unlocks_per_month', key: 'summary_unlocks' },
  { code: 'seats_max', key: 'summary_seats' },
]

export default function AdminPackagesPage() {
  const t = useTranslations('admin_back_office')
  const secureFetch = useSecureFetch()

  const [packages, setPackages] = useState<Package[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await secureFetch('/api/admin/list-packages', { method: 'GET' })
      if (res.status === 403) {
        setError(t('errors.forbidden'))
        return
      }
      if (!res.ok) {
        setError(t('errors.generic'))
        return
      }
      const json = (await res.json()) as { packages: Package[] }
      setPackages(json.packages ?? [])
    } catch {
      setError(t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [t, secureFetch])

  useEffect(() => {
    void load()
  }, [load])

  function formatPrice(p: Package): string {
    if (p.price_monthly == null || p.price_monthly === 0) return t('packages.price_free')
    return t('packages.price_monthly_format', { price: p.price_monthly, currency: p.currency })
  }

  function targetLabel(role: string): string {
    return role === 'cabinet' ? t('packages.target_cabinet') : t('packages.target_client')
  }

  // Résumé COURT en langage clair : les limites finies listées ("2 publications/mois
  // · 1 candidat dévoilé…"), puis « reste illimité » si au moins une limite l'est.
  // Tout illimité → un seul libellé.
  function summarizeLimits(features: Feature[]): string {
    const byCode = new Map(features.map((f) => [f.feature_code, f.value]))
    const parts: string[] = []
    let anyUnlimited = false
    for (const { code, key } of SUMMARY_ORDER) {
      const raw = byCode.get(code)
      if (raw == null) continue
      if (raw.trim().toLowerCase() === 'unlimited') {
        anyUnlimited = true
        continue
      }
      const n = parseInt(raw, 10)
      if (!Number.isFinite(n)) continue
      parts.push(t(`packages.${key}`, { count: n }))
    }
    if (parts.length === 0) return t('packages.summary_all_unlimited')
    if (anyUnlimited) parts.push(t('packages.summary_rest_unlimited'))
    return parts.join(' · ')
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 14 }}>
        {t('loading')}
      </div>
    )
  }

  if (error) {
    return (
      <div role="alert" style={{ padding: 16, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 13, borderRadius: 10 }}>
        {error}
      </div>
    )
  }

  const thStyle: React.CSSProperties = {
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 500,
    textTransform: 'uppercase',
    letterSpacing: '.06em',
    color: 'var(--color-text-tertiary, #94a3b8)',
    padding: '14px 14px 10px',
    whiteSpace: 'nowrap',
  }
  const tdStyle: React.CSSProperties = {
    fontSize: 13,
    color: 'var(--color-text-primary, #0f172a)',
    padding: '14px',
    borderTop: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
    verticalAlign: 'middle',
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500, color: 'var(--color-text-primary, #0f172a)', margin: '0 0 4px' }}>
        {t('packages.page_title')}
      </h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', margin: '0 0 20px' }}>
        {t('packages.subtitle')}
      </p>

      <div
        style={{
          background: 'var(--color-background-primary, #fff)',
          border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
          borderRadius: 12,
          overflowX: 'auto',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr>
              <th style={thStyle}>{t('packages.col_offer')}</th>
              <th style={thStyle}>{t('packages.col_target')}</th>
              <th style={thStyle}>{t('packages.col_price')}</th>
              <th style={thStyle}>{t('packages.col_status')}</th>
              <th style={thStyle}>{t('packages.col_limits')}</th>
              <th style={thStyle} aria-label={t('packages.action_edit')} />
            </tr>
          </thead>
          <tbody>
            {(packages ?? []).map((p) => (
              <tr key={p.id}>
                <td style={tdStyle}>
                  <span style={{ fontWeight: 500 }}>{p.name}</span>
                </td>
                <td style={{ ...tdStyle, color: 'var(--color-text-secondary, #64748b)' }}>
                  {targetLabel(p.target_role)}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatPrice(p)}</td>
                <td style={tdStyle}>
                  <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                    <span
                      style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        borderRadius: 10,
                        background: p.active ? '#DCFCE7' : '#F1F5F9',
                        color: p.active ? '#166534' : '#64748b',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.active ? t('packages.active_yes') : t('packages.active_no')}
                    </span>
                    {p.is_default && (
                      <span style={{ fontSize: 11, padding: '2px 8px', background: '#DBEAFE', color: '#1e40af', borderRadius: 10, whiteSpace: 'nowrap' }}>
                        {t('packages.default_badge')}
                      </span>
                    )}
                  </span>
                </td>
                <td style={{ ...tdStyle, color: 'var(--color-text-secondary, #64748b)', minWidth: 240 }}>
                  {summarizeLimits(p.features)}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <Link
                    href={`/admin/packages/${p.id}`}
                    style={{
                      display: 'inline-block',
                      padding: '7px 14px',
                      fontSize: 12,
                      fontWeight: 500,
                      color: '#00B9FF',
                      border: '0.5px solid #00B9FF',
                      borderRadius: 8,
                      textDecoration: 'none',
                    }}
                  >
                    {t('packages.action_edit')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
