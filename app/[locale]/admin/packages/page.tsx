'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/packages — catalogue commerce (liste). Édition seule via [id].
 * Source : GET /api/admin/list-packages (service-role).
 * Pattern admin existant (RSC-like client + useSecureFetch + cartes sobres).
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
    return `${p.price_monthly} ${p.currency}`
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

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 500, color: 'var(--color-text-primary, #0f172a)', margin: '0 0 4px' }}>
        {t('packages.page_title')}
      </h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', margin: '0 0 20px' }}>
        {t('packages.subtitle')}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {(packages ?? []).map((p) => (
          <Link
            key={p.id}
            href={`/admin/packages/${p.id}`}
            style={{
              display: 'block',
              textDecoration: 'none',
              background: 'var(--color-background-primary, #fff)',
              border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
              borderRadius: 12,
              padding: '16px 20px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--color-text-primary, #0f172a)' }}>
                {p.name}
              </span>
              <span style={{ fontSize: 12, color: 'var(--color-text-tertiary, #94a3b8)' }}>{p.slug}</span>
              <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #64748b)' }}>· {p.target_role}</span>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary, #0f172a)' }}>
                {formatPrice(p)}
              </span>
              {p.is_default && (
                <span style={{ fontSize: 11, padding: '2px 8px', background: '#DBEAFE', color: '#1e40af', borderRadius: 10 }}>
                  {t('packages.default_badge')}
                </span>
              )}
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 10,
                  background: p.active ? '#DCFCE7' : '#F1F5F9',
                  color: p.active ? '#166534' : '#64748b',
                }}
              >
                {p.active ? t('packages.active_yes') : t('packages.active_no')}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {p.features.map((f) => (
                <span
                  key={f.feature_code}
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    background: 'var(--color-background-secondary, #f8fafc)',
                    color: 'var(--color-text-secondary, #64748b)',
                    borderRadius: 8,
                  }}
                >
                  {f.feature_code}: <strong style={{ fontWeight: 500 }}>{f.value}</strong>
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
