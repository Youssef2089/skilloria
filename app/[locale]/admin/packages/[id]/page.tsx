'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/packages/[id] — édition d'un package (prix mensuel/annuel, actif) et
 * de la VALEUR de chaque package_feature existante (entier >= 0 ou 'unlimited').
 * Mutation via POST /api/admin/update-package (snapshot package_history + valid.
 * serveur). Édition seule : pas de création/suppression ce lot.
 */

type Pkg = {
  id: string
  name: string
  slug: string
  target_role: string
  description: string | null
  price_monthly: number | null
  price_yearly: number | null
  currency: string
  is_default: boolean
  active: boolean
  scope: string
  max_seats: number | null
}
type Feature = {
  feature_code: string
  value: string
  reset_period: string | null
  name: string
  value_type: string | null
}

const cardStyle: React.CSSProperties = {
  background: 'var(--color-background-primary, #fff)',
  border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
  borderRadius: 12,
  padding: '18px 22px',
  marginBottom: 16,
}
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: 'var(--color-text-secondary, #64748b)',
  fontWeight: 500,
  marginBottom: 6,
}
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  fontSize: 13,
  border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
  borderRadius: 8,
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}
const sectionTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
  color: 'var(--color-text-secondary, #64748b)',
  marginBottom: 12,
}

export default function AdminPackageEditPage() {
  const t = useTranslations('admin_back_office')
  const params = useParams()
  const secureFetch = useSecureFetch()
  const packageId = (params?.id as string | undefined) ?? ''

  const [pkg, setPkg] = useState<Pkg | null>(null)
  const [features, setFeatures] = useState<Feature[]>([])
  const [priceMonthly, setPriceMonthly] = useState('')
  const [priceYearly, setPriceYearly] = useState('')
  const [active, setActive] = useState(true)
  const [featureValues, setFeatureValues] = useState<Record<string, string>>({})
  const [changeReason, setChangeReason] = useState('')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await secureFetch(`/api/admin/get-package/${packageId}`, { method: 'GET' })
      if (res.status === 404) {
        setError('not_found')
        return
      }
      if (res.status === 403) {
        setError(t('errors.forbidden'))
        return
      }
      if (!res.ok) {
        setError(t('errors.generic'))
        return
      }
      const json = (await res.json()) as { package: Pkg; features: Feature[] }
      setPkg(json.package)
      setFeatures(json.features ?? [])
      setPriceMonthly(json.package.price_monthly == null ? '' : String(json.package.price_monthly))
      setPriceYearly(json.package.price_yearly == null ? '' : String(json.package.price_yearly))
      setActive(json.package.active)
      const fv: Record<string, string> = {}
      for (const f of json.features ?? []) fv[f.feature_code] = f.value
      setFeatureValues(fv)
    } catch {
      setError(t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [packageId, t, secureFetch])

  useEffect(() => {
    if (packageId) void load()
  }, [packageId, load])

  async function save() {
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const body = {
        package_id: packageId,
        price_monthly: priceMonthly.trim() === '' ? null : priceMonthly.trim(),
        price_yearly: priceYearly.trim() === '' ? null : priceYearly.trim(),
        active,
        features: features.map((f) => ({ feature_code: f.feature_code, value: featureValues[f.feature_code] ?? f.value })),
        change_reason: changeReason.trim() || undefined,
      }
      const res = await secureFetch('/api/admin/update-package', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = (await res.json().catch(() => ({}))) as { code?: string; feature_code?: string }
      if (!res.ok) {
        if (payload.code === 'invalid_feature_value') {
          setSaveError(t('packages.err_invalid_feature_value', { code: payload.feature_code ?? '' }))
        } else if (payload.code === 'unknown_feature') {
          setSaveError(t('packages.err_unknown_feature', { code: payload.feature_code ?? '' }))
        } else if (payload.code === 'invalid_price') {
          setSaveError(t('packages.err_invalid_price'))
        } else {
          setSaveError(t('errors.generic'))
        }
        return
      }
      setSaved(true)
      setChangeReason('')
      await load()
    } catch {
      setSaveError(t('errors.generic'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 14 }}>{t('loading')}</div>
  }

  if (error === 'not_found') {
    return (
      <div>
        <Link href="/admin/packages" style={{ fontSize: 13, color: '#00B9FF', textDecoration: 'none', marginBottom: 16, display: 'inline-block' }}>
          {t('packages.back')}
        </Link>
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <h2 style={{ fontSize: 18, fontWeight: 500, color: 'var(--color-text-primary, #0f172a)' }}>{t('not_found_title')}</h2>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <Link href="/admin/packages" style={{ fontSize: 13, color: '#00B9FF', textDecoration: 'none', marginBottom: 16, display: 'inline-block' }}>
          {t('packages.back')}
        </Link>
        <div role="alert" style={{ padding: 16, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 13, borderRadius: 10 }}>
          {error}
        </div>
      </div>
    )
  }

  if (!pkg) return null

  return (
    <div>
      <Link href="/admin/packages" style={{ fontSize: 13, color: '#00B9FF', textDecoration: 'none', marginBottom: 16, display: 'inline-block' }}>
        {t('packages.back')}
      </Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: 'var(--color-text-primary, #0f172a)', margin: 0 }}>{pkg.name}</h1>
        <span style={{ fontSize: 12, color: 'var(--color-text-tertiary, #94a3b8)' }}>{pkg.slug}</span>
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #64748b)' }}>· {pkg.target_role}</span>
        {pkg.is_default && (
          <span style={{ fontSize: 11, padding: '2px 8px', background: '#DBEAFE', color: '#1e40af', borderRadius: 10 }}>
            {t('packages.default_badge')}
          </span>
        )}
      </div>

      {/* Pricing */}
      <section style={cardStyle}>
        <h2 style={sectionTitle}>{t('packages.section_pricing')}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 14 }}>
          <div>
            <label htmlFor="pm" style={labelStyle}>{t('packages.field_price_monthly')} ({pkg.currency})</label>
            <input id="pm" type="text" inputMode="decimal" value={priceMonthly} onChange={(e) => setPriceMonthly(e.target.value)} placeholder={t('packages.price_free')} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="py" style={labelStyle}>{t('packages.field_price_yearly')} ({pkg.currency})</label>
            <input id="py" type="text" inputMode="decimal" value={priceYearly} onChange={(e) => setPriceYearly(e.target.value)} placeholder={t('packages.price_free')} style={inputStyle} />
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-text-primary, #0f172a)', cursor: 'pointer' }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t('packages.field_active')}
        </label>
      </section>

      {/* Features */}
      <section style={cardStyle}>
        <h2 style={sectionTitle}>{t('packages.section_features')}</h2>
        <p style={{ fontSize: 12, color: 'var(--color-text-tertiary, #94a3b8)', margin: '0 0 14px' }}>{t('packages.feature_value_hint')}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {features.map((f) => (
            <div key={f.feature_code} style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 12, alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, color: 'var(--color-text-primary, #0f172a)' }}>{f.name}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary, #94a3b8)' }}>
                  {f.feature_code}{f.reset_period ? ` · ${f.reset_period}` : ''}
                </div>
              </div>
              <input
                type="text"
                value={featureValues[f.feature_code] ?? ''}
                onChange={(e) => setFeatureValues((prev) => ({ ...prev, [f.feature_code]: e.target.value }))}
                style={inputStyle}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Save */}
      <section style={cardStyle}>
        <label htmlFor="reason" style={labelStyle}>{t('packages.change_reason_label')}</label>
        <textarea id="reason" value={changeReason} onChange={(e) => setChangeReason(e.target.value)} placeholder={t('packages.change_reason_placeholder')} maxLength={200} rows={2} style={{ ...inputStyle, resize: 'vertical', marginBottom: 12 }} />

        {saveError && (
          <div role="alert" style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, borderRadius: 8, marginBottom: 12 }}>
            {saveError}
          </div>
        )}
        {saved && (
          <div style={{ padding: '8px 12px', background: '#DCFCE7', border: '1px solid #bbf7d0', color: '#166534', fontSize: 12, borderRadius: 8, marginBottom: 12 }}>
            {t('packages.saved')}
          </div>
        )}

        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          style={{
            padding: '10px 18px',
            background: '#00B9FF',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 500,
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.6 : 1,
            fontFamily: 'inherit',
          }}
        >
          {saving ? t('loading') : t('packages.save')}
        </button>
      </section>
    </div>
  )
}
