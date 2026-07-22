'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/packages/[id] — édition d'un package (prix mensuel/annuel, actif) et
 * de la VALEUR de chaque package_feature (entier >= 0 ou 'unlimited').
 * Mutation via POST /api/admin/update-package (snapshot package_history + valid.
 * serveur). Édition seule : pas de création/suppression ce lot.
 *
 * Refonte UX : formulaire structuré en 2 sections (Tarification / Limites),
 * LIBELLÉS HUMAINS par feature (jamais le code), case « Illimité » par limite,
 * confirmation inline avant enregistrement. Aucun snake_case à l'écran.
 *
 * Statut « par défaut » : en LECTURE (badge + explication). Le seul geste
 * possible est le TRANSFERT via POST /api/admin/set-default-package — jamais
 * une case à cocher libre, l'invariant (un défaut actif par cible) étant tenu
 * par le serveur.
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

// Mapping feature_code → clé i18n de libellé HUMAIN. Un code absent retombe sur
// le nom BDD (jamais le code brut).
const FEATURE_LABEL_KEYS: Record<string, string> = {
  publications_per_month: 'feature_label_publications_per_month',
  active_publications_max: 'feature_label_active_publications_max',
  revealed_candidates_per_publication: 'feature_label_revealed_candidates_per_publication',
  manual_unlocks_per_month: 'feature_label_manual_unlocks_per_month',
  seats_max: 'feature_label_seats_max',
}

const UNLIMITED = 'unlimited'

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
  const searchParams = useSearchParams()
  const secureFetch = useSecureFetch()
  const packageId = (params?.id as string | undefined) ?? ''
  const defaultRefusedOnCreate = searchParams?.get('default_refused') === '1'

  const [pkg, setPkg] = useState<Pkg | null>(null)
  const [features, setFeatures] = useState<Feature[]>([])
  const [name, setName] = useState('')
  const [priceMonthly, setPriceMonthly] = useState('')
  const [priceYearly, setPriceYearly] = useState('')
  const [active, setActive] = useState(true)
  const [featureValues, setFeatureValues] = useState<Record<string, string>>({})
  const [changeReason, setChangeReason] = useState('')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Transfert du défaut : nom de l'offre qui perdrait le statut (même cible),
  // confirmation inline, envoi, erreur/succès.
  const [previousDefaultName, setPreviousDefaultName] = useState<string | null>(null)
  const [confirmingDefault, setConfirmingDefault] = useState(false)
  const [settingDefault, setSettingDefault] = useState(false)
  const [defaultError, setDefaultError] = useState<string | null>(null)
  const [defaultDone, setDefaultDone] = useState(false)

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
      setName(json.package.name)
      setFeatures(json.features ?? [])
      setPriceMonthly(json.package.price_monthly == null ? '' : String(json.package.price_monthly))
      setPriceYearly(json.package.price_yearly == null ? '' : String(json.package.price_yearly))
      setActive(json.package.active)
      const fv: Record<string, string> = {}
      for (const f of json.features ?? []) fv[f.feature_code] = f.value
      setFeatureValues(fv)

      // Défaut actuel de la MÊME cible — sert à nommer l'offre qui perdrait le
      // statut dans la confirmation. Best-effort : la confirmation reste
      // affichable (variante sans nom) si la lecture échoue.
      setPreviousDefaultName(null)
      if (!json.package.is_default) {
        try {
          const listRes = await secureFetch('/api/admin/list-packages', { method: 'GET' })
          if (listRes.ok) {
            const listJson = (await listRes.json()) as {
              packages: { id: string; name: string; target_role: string; is_default: boolean }[]
            }
            const prev = (listJson.packages ?? []).find(
              (x) => x.target_role === json.package.target_role && x.is_default && x.id !== json.package.id,
            )
            setPreviousDefaultName(prev?.name ?? null)
          }
        } catch {
          /* best-effort — non bloquant */
        }
      }
    } catch {
      setError(t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [packageId, t, secureFetch])

  useEffect(() => {
    if (packageId) void load()
  }, [packageId, load])

  // Libellé HUMAIN d'une feature (jamais le code snake_case).
  function featureLabel(f: Feature): string {
    const key = FEATURE_LABEL_KEYS[f.feature_code]
    return key ? t(`packages.${key}`) : f.name
  }

  function isUnlimited(code: string): boolean {
    return (featureValues[code] ?? '').trim().toLowerCase() === UNLIMITED
  }

  function toggleUnlimited(code: string, next: boolean) {
    setFeatureValues((prev) => ({ ...prev, [code]: next ? UNLIMITED : '' }))
  }

  function setNumeric(code: string, raw: string) {
    setFeatureValues((prev) => ({ ...prev, [code]: raw }))
  }

  async function save() {
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const body = {
        package_id: packageId,
        name: name.trim(),
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
        } else if (payload.code === 'invalid_name') {
          setSaveError(t('packages.err_invalid_name'))
        } else {
          setSaveError(t('errors.generic'))
        }
        return
      }
      setSaved(true)
      setConfirming(false)
      setChangeReason('')
      await load()
    } catch {
      setSaveError(t('errors.generic'))
    } finally {
      setSaving(false)
    }
  }

  // TRANSFERT du défaut vers CE package. Invariant appliqué côté serveur.
  async function setAsDefault() {
    setSettingDefault(true)
    setDefaultError(null)
    setDefaultDone(false)
    try {
      const res = await secureFetch('/api/admin/set-default-package', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ package_id: packageId }),
      })
      const payload = (await res.json().catch(() => ({}))) as { code?: string; uncovered?: string[] }
      if (!res.ok) {
        if (payload.code === 'already_default') setDefaultError(t('packages.err_already_default'))
        else if (payload.code === 'package_inactive') setDefaultError(t('packages.err_package_inactive'))
        else if (payload.code === 'target_uncovered') {
          setDefaultError(
            t('packages.err_target_uncovered', {
              targets: (payload.uncovered ?? [])
                .map((r) => (r === 'cabinet' ? t('packages.target_cabinet') : t('packages.target_client')))
                .join(', '),
            }),
          )
        } else if (res.status === 403) setDefaultError(t('errors.forbidden'))
        else setDefaultError(t('errors.generic'))
        return
      }
      setConfirmingDefault(false)
      setDefaultDone(true)
      await load()
    } catch {
      setDefaultError(t('errors.generic'))
    } finally {
      setSettingDefault(false)
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

  const targetRoleLabel =
    pkg.target_role === 'all'
      ? t('packages.target_all')
      : pkg.target_role === 'cabinet'
        ? t('packages.target_cabinet')
        : t('packages.target_client')

  return (
    <div>
      <Link href="/admin/packages" style={{ fontSize: 13, color: '#00B9FF', textDecoration: 'none', marginBottom: 16, display: 'inline-block' }}>
        {t('packages.back')}
      </Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: 'var(--color-text-primary, #0f172a)', margin: 0 }}>{pkg.name}</h1>
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #64748b)' }}>
          {pkg.target_role === 'cabinet' ? t('packages.target_cabinet') : t('packages.target_client')}
        </span>
        {pkg.is_default && (
          <span style={{ fontSize: 11, padding: '2px 8px', background: '#DBEAFE', color: '#1e40af', borderRadius: 10 }}>
            {t('packages.default_badge')}
          </span>
        )}
      </div>

      {/* Créée depuis /admin/packages/new avec un statut « par défaut » refusé
          (couverture rompue) : l'offre existe, le statut n'a pas été appliqué. */}
      {defaultRefusedOnCreate && (
        <div
          role="alert"
          style={{ padding: '10px 14px', background: '#FEF3C7', border: '1px solid #fde68a', color: '#92400e', fontSize: 13, borderRadius: 10, marginBottom: 16 }}
        >
          {t('packages.created_default_refused', { targets: targetRoleLabel })}
        </div>
      )}

      {/* Package par défaut — LECTURE seule + transfert. Jamais de décoche :
          on ne peut que désigner une autre offre de la même cible. */}
      <section style={cardStyle}>
        <h2 style={sectionTitle}>{t('packages.section_default')}</h2>
        {pkg.is_default ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', margin: 0 }}>
            {t('packages.default_explain', { target: targetRoleLabel })}
          </p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', margin: '0 0 12px' }}>
              {previousDefaultName
                ? t('packages.confirm_set_default', { target: targetRoleLabel, previous: previousDefaultName })
                : t('packages.confirm_set_default_none', { target: targetRoleLabel })}
            </p>

            {defaultError && (
              <div role="alert" style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, borderRadius: 8, marginBottom: 12 }}>
                {defaultError}
              </div>
            )}
            {defaultDone && (
              <div style={{ padding: '8px 12px', background: '#DCFCE7', border: '1px solid #bbf7d0', color: '#166534', fontSize: 12, borderRadius: 8, marginBottom: 12 }}>
                {t('packages.default_set')}
              </div>
            )}

            {!pkg.active ? (
              // Un défaut doit être actif : on explique plutôt que d'exposer un
              // bouton que le serveur refuserait.
              <p style={{ fontSize: 12, color: 'var(--color-text-tertiary, #94a3b8)', margin: 0 }}>
                {t('packages.err_package_inactive')}
              </p>
            ) : confirmingDefault ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: 'var(--color-text-primary, #0f172a)' }}>
                  {t('packages.confirm_save')}
                </span>
                <button
                  type="button"
                  onClick={() => void setAsDefault()}
                  disabled={settingDefault}
                  style={{ padding: '9px 16px', background: '#00B9FF', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: settingDefault ? 'not-allowed' : 'pointer', opacity: settingDefault ? 0.6 : 1, fontFamily: 'inherit' }}
                >
                  {settingDefault ? t('loading') : t('packages.confirm_yes')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDefault(false)}
                  disabled={settingDefault}
                  style={{ padding: '9px 16px', background: 'transparent', color: 'var(--color-text-secondary, #64748b)', border: '0.5px solid var(--color-border-tertiary, #e5e7eb)', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  {t('packages.confirm_cancel')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setDefaultDone(false); setDefaultError(null); setConfirmingDefault(true) }}
                style={{ padding: '9px 16px', background: 'transparent', color: '#00B9FF', border: '0.5px solid #00B9FF', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {t('packages.action_set_default')}
              </button>
            )}
          </>
        )}
      </section>

      {/* Tarification */}
      <section style={cardStyle}>
        <h2 style={sectionTitle}>{t('packages.section_pricing')}</h2>

        {/* NOM : éditable. CIBLE : lecture seule (la changer retirerait leurs
            droits aux organisations déjà rattachées). */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 14 }}>
          <div>
            <label htmlFor="pkgname" style={labelStyle}>{t('packages.field_name')}</label>
            <input
              id="pkgname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              style={inputStyle}
            />
          </div>
          <div>
            <span style={labelStyle}>{t('packages.field_target')}</span>
            <div
              style={{
                ...inputStyle,
                background: 'var(--color-background-secondary, #f8fafc)',
                color: 'var(--color-text-secondary, #64748b)',
              }}
            >
              {targetRoleLabel}
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary, #94a3b8)', margin: '6px 0 0' }}>
              {t('packages.target_help')}
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 14 }}>
          <div>
            <label htmlFor="pm" style={labelStyle}>{t('packages.field_price_monthly')}</label>
            <div style={{ position: 'relative' }}>
              <input id="pm" type="number" min={0} step={1} inputMode="decimal" value={priceMonthly} onChange={(e) => setPriceMonthly(e.target.value)} placeholder={t('packages.price_free')} style={{ ...inputStyle, paddingRight: 46 }} />
              <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--color-text-tertiary, #94a3b8)', pointerEvents: 'none' }}>{pkg.currency}</span>
            </div>
          </div>
          <div>
            <label htmlFor="py" style={labelStyle}>{t('packages.field_price_yearly')}</label>
            <div style={{ position: 'relative' }}>
              <input id="py" type="number" min={0} step={1} inputMode="decimal" value={priceYearly} onChange={(e) => setPriceYearly(e.target.value)} placeholder={t('packages.price_free')} style={{ ...inputStyle, paddingRight: 46 }} />
              <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--color-text-tertiary, #94a3b8)', pointerEvents: 'none' }}>{pkg.currency}</span>
            </div>
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-text-primary, #0f172a)', cursor: 'pointer' }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t('packages.field_active')}
        </label>
        {/* Décocher remplace la suppression : retire de la vente sans casser
            les organisations rattachées. */}
        <p style={{ fontSize: 12, color: 'var(--color-text-tertiary, #94a3b8)', margin: '6px 0 0 24px' }}>
          {t('packages.active_help')}
        </p>
      </section>

      {/* Limites */}
      <section style={cardStyle}>
        <h2 style={sectionTitle}>{t('packages.section_limits')}</h2>
        <p style={{ fontSize: 12, color: 'var(--color-text-tertiary, #94a3b8)', margin: '0 0 14px' }}>{t('packages.limits_hint')}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {features.map((f) => {
            const unlimited = isUnlimited(f.feature_code)
            return (
              <div key={f.feature_code} style={{ display: 'grid', gridTemplateColumns: '1fr 130px auto', gap: 12, alignItems: 'center' }}>
                <label htmlFor={`f_${f.feature_code}`} style={{ fontSize: 13, color: 'var(--color-text-primary, #0f172a)' }}>
                  {featureLabel(f)}
                </label>
                <input
                  id={`f_${f.feature_code}`}
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={unlimited ? '' : (featureValues[f.feature_code] ?? '')}
                  onChange={(e) => setNumeric(f.feature_code, e.target.value)}
                  disabled={unlimited}
                  placeholder={unlimited ? '∞' : '0'}
                  style={{ ...inputStyle, background: unlimited ? 'var(--color-background-secondary, #f8fafc)' : '#fff', color: unlimited ? 'var(--color-text-tertiary, #94a3b8)' : 'inherit' }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-secondary, #64748b)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={unlimited} onChange={(e) => toggleUnlimited(f.feature_code, e.target.checked)} />
                  {t('packages.field_unlimited')}
                </label>
              </div>
            )
          })}
        </div>
      </section>

      {/* Enregistrement */}
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

        {confirming ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--color-text-primary, #0f172a)' }}>{t('packages.confirm_save')}</span>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              style={{ padding: '9px 16px', background: '#00B9FF', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, fontFamily: 'inherit' }}
            >
              {saving ? t('loading') : t('packages.confirm_yes')}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={saving}
              style={{ padding: '9px 16px', background: 'transparent', color: 'var(--color-text-secondary, #64748b)', border: '0.5px solid var(--color-border-tertiary, #e5e7eb)', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {t('packages.confirm_cancel')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setSaved(false); setSaveError(null); setConfirming(true) }}
            style={{ padding: '10px 18px', background: '#00B9FF', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {t('packages.save')}
          </button>
        )}
      </section>
    </div>
  )
}
