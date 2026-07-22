'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/packages/new — création d'une offre.
 *
 * CONTRÔLE TOTAL DE L'ADMIN : tous les champs sont saisis ici et rien n'est
 * imposé — nom, slug, cible, prix, les 5 limites, offre active ou non, offre
 * par défaut ou non. « Copier les limites depuis » pré-remplit seulement : les
 * valeurs restent modifiables avant création.
 *
 * Cible « Tous » = UNE seule offre (target_role='all') couvrant clients ET
 * cabinets — jamais deux lignes. Le statut par défaut passe par l'invariant de
 * couverture côté serveur (lib/package-default.ts).
 */

type Feature = { feature_code: string; value: string; reset_period: string | null }
type Package = {
  id: string
  name: string
  slug: string
  target_role: string
  is_default: boolean
  active: boolean
  features: Feature[]
}

// Les 5 limites du catalogue, dans l'ordre d'affichage, avec leur libellé HUMAIN.
const LIMIT_CODES: { code: string; labelKey: string }[] = [
  { code: 'publications_per_month', labelKey: 'feature_label_publications_per_month' },
  { code: 'active_publications_max', labelKey: 'feature_label_active_publications_max' },
  { code: 'revealed_candidates_per_publication', labelKey: 'feature_label_revealed_candidates_per_publication' },
  { code: 'manual_unlocks_per_month', labelKey: 'feature_label_manual_unlocks_per_month' },
  { code: 'seats_max', labelKey: 'feature_label_seats_max' },
]

const UNLIMITED = 'unlimited'
const TARGETS = ['client', 'cabinet', 'all'] as const

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
  background: 'var(--color-background-primary, #fff)',
  color: 'var(--color-text-primary, #0f172a)',
}
const sectionTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
  color: 'var(--color-text-secondary, #64748b)',
  marginBottom: 12,
}
const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text-tertiary, #94a3b8)',
  margin: '6px 0 0',
}

/** Slugifie côté client (le serveur refait le calcul et gère les collisions). */
function slugify(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

export default function AdminPackageNewPage() {
  const t = useTranslations('admin_back_office')
  const secureFetch = useSecureFetch()
  const router = useRouter()

  const [packages, setPackages] = useState<Package[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // ── État du formulaire — tout est saisi par l'admin ────────────────────────
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [targetRole, setTargetRole] = useState<(typeof TARGETS)[number]>('all')
  const [priceMonthly, setPriceMonthly] = useState('')
  const [priceYearly, setPriceYearly] = useState('')
  const [active, setActive] = useState(true)
  const [isDefault, setIsDefault] = useState(false)
  const [copyFrom, setCopyFrom] = useState('')
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(LIMIT_CODES.map((l) => [l.code, ''])),
  )

  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await secureFetch('/api/admin/list-packages', { method: 'GET' })
      if (res.status === 403) {
        setLoadError(t('errors.forbidden'))
        return
      }
      if (!res.ok) {
        setLoadError(t('errors.generic'))
        return
      }
      const json = (await res.json()) as { packages: Package[] }
      const list = json.packages ?? []
      setPackages(list)
      // Modèle proposé par défaut : l'offre free si présente, sinon la première.
      const model = list.find((p) => p.slug.startsWith('free')) ?? list[0]
      if (model) {
        setCopyFrom(model.id)
        applyModel(model)
      }
    } catch {
      setLoadError(t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [t, secureFetch])

  useEffect(() => {
    void load()
  }, [load])

  /** Pré-remplit les limites depuis une offre modèle (valeurs restent éditables). */
  function applyModel(model: Package) {
    const byCode = new Map(model.features.map((f) => [f.feature_code, f.value]))
    setValues(Object.fromEntries(LIMIT_CODES.map((l) => [l.code, byCode.get(l.code) ?? ''])))
  }

  function onCopyFromChange(id: string) {
    setCopyFrom(id)
    const model = packages.find((p) => p.id === id)
    if (model) applyModel(model)
  }

  function onNameChange(v: string) {
    setName(v)
    if (!slugTouched) setSlug(slugify(v))
  }

  function isUnlimited(code: string): boolean {
    return (values[code] ?? '').trim().toLowerCase() === UNLIMITED
  }
  function toggleUnlimited(code: string, next: boolean) {
    setValues((prev) => ({ ...prev, [code]: next ? UNLIMITED : '' }))
  }

  const targetLabel = useMemo(() => {
    if (targetRole === 'all') return t('packages.target_all')
    if (targetRole === 'cabinet') return t('packages.target_cabinet')
    return t('packages.target_client')
  }, [targetRole, t])

  async function create() {
    setSaving(true)
    setSaveError(null)
    try {
      const body = {
        name: name.trim(),
        slug: slug.trim() || undefined,
        target_role: targetRole,
        price_monthly: priceMonthly.trim() === '' ? null : priceMonthly.trim(),
        price_yearly: priceYearly.trim() === '' ? null : priceYearly.trim(),
        active,
        is_default: isDefault,
        // Seules les limites renseignées sont créées : un champ vide = feature
        // absente = illimité côté entitlements.
        features: LIMIT_CODES.filter((l) => (values[l.code] ?? '').trim() !== '').map((l) => ({
          feature_code: l.code,
          value: values[l.code].trim(),
        })),
      }
      const res = await secureFetch('/api/admin/create-package', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = (await res.json().catch(() => ({}))) as {
        code?: string
        package_id?: string
        default_applied?: boolean
        default_refused_code?: string
        uncovered?: string[]
      }
      if (!res.ok) {
        if (payload.code === 'invalid_name') setSaveError(t('packages.err_invalid_name'))
        else if (payload.code === 'default_requires_active') setSaveError(t('packages.err_default_requires_active'))
        else if (payload.code === 'invalid_price') setSaveError(t('packages.err_invalid_price'))
        else if (payload.code === 'invalid_feature_value') setSaveError(t('packages.err_invalid_feature_value', { code: '' }))
        else if (res.status === 403) setSaveError(t('errors.forbidden'))
        else setSaveError(t('errors.generic'))
        return
      }
      // Le statut par défaut peut être refusé sans invalider la création :
      // on redirige vers la fiche en portant l'information.
      const query =
        payload.default_refused_code === 'target_uncovered' ? '?default_refused=1' : ''
      router.push(`/admin/packages/${payload.package_id}${query}`)
    } catch {
      setSaveError(t('errors.generic'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 14 }}>{t('loading')}</div>
  }

  const nameMissing = name.trim() === ''

  return (
    <div>
      <Link href="/admin/packages" style={{ fontSize: 13, color: '#00B9FF', textDecoration: 'none', marginBottom: 16, display: 'inline-block' }}>
        {t('packages.back')}
      </Link>

      <h1 style={{ fontSize: 22, fontWeight: 500, color: 'var(--color-text-primary, #0f172a)', margin: '0 0 4px' }}>
        {t('packages.new_title')}
      </h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', margin: '0 0 20px' }}>
        {t('packages.new_subtitle')}
      </p>

      {loadError && (
        <div role="alert" style={{ padding: 16, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 13, borderRadius: 10, marginBottom: 16 }}>
          {loadError}
        </div>
      )}

      {/* Identité */}
      <section style={cardStyle}>
        <h2 style={sectionTitle}>{t('packages.col_offer')}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          <div>
            <label htmlFor="name" style={labelStyle}>{t('packages.field_name')}</label>
            <input
              id="name"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              maxLength={100}
              aria-invalid={nameMissing}
              style={{ ...inputStyle, borderColor: nameMissing && confirming ? '#fecaca' : undefined }}
            />
          </div>
          <div>
            <label htmlFor="slug" style={labelStyle}>{t('packages.field_slug')}</label>
            <input
              id="slug"
              value={slug}
              onChange={(e) => { setSlugTouched(true); setSlug(e.target.value) }}
              maxLength={50}
              style={inputStyle}
            />
            <p style={hintStyle}>{t('packages.slug_hint')}</p>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <span style={labelStyle}>{t('packages.field_target')}</span>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {TARGETS.map((tr) => (
              <label key={tr} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--color-text-primary, #0f172a)', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="target_role"
                  value={tr}
                  checked={targetRole === tr}
                  onChange={() => setTargetRole(tr)}
                />
                {tr === 'all' ? t('packages.target_all') : tr === 'cabinet' ? t('packages.target_cabinet') : t('packages.target_client')}
              </label>
            ))}
          </div>
        </div>
      </section>

      {/* Tarification */}
      <section style={cardStyle}>
        <h2 style={sectionTitle}>{t('packages.section_pricing')}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          <div>
            <label htmlFor="pm" style={labelStyle}>{t('packages.field_price_monthly')}</label>
            <input id="pm" type="number" min={0} step={1} inputMode="decimal" value={priceMonthly} onChange={(e) => setPriceMonthly(e.target.value)} placeholder={t('packages.price_free')} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="py" style={labelStyle}>{t('packages.field_price_yearly')}</label>
            <input id="py" type="number" min={0} step={1} inputMode="decimal" value={priceYearly} onChange={(e) => setPriceYearly(e.target.value)} placeholder={t('packages.price_free')} style={inputStyle} />
          </div>
        </div>
      </section>

      {/* Limites */}
      <section style={cardStyle}>
        <h2 style={sectionTitle}>{t('packages.section_limits')}</h2>

        <div style={{ marginBottom: 16 }}>
          <label htmlFor="copyfrom" style={labelStyle}>{t('packages.field_copy_from')}</label>
          <select
            id="copyfrom"
            value={copyFrom}
            onChange={(e) => onCopyFromChange(e.target.value)}
            style={{ ...inputStyle, maxWidth: 320 }}
          >
            {packages.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <p style={hintStyle}>{t('packages.copy_from_hint')}</p>
        </div>

        <p style={{ ...hintStyle, margin: '0 0 14px' }}>{t('packages.limits_hint')}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {LIMIT_CODES.map((l) => {
            const unlimited = isUnlimited(l.code)
            return (
              <div key={l.code} style={{ display: 'grid', gridTemplateColumns: '1fr 130px auto', gap: 12, alignItems: 'center' }}>
                <label htmlFor={`f_${l.code}`} style={{ fontSize: 13, color: 'var(--color-text-primary, #0f172a)' }}>
                  {t(`packages.${l.labelKey}`)}
                </label>
                <input
                  id={`f_${l.code}`}
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={unlimited ? '' : (values[l.code] ?? '')}
                  onChange={(e) => setValues((prev) => ({ ...prev, [l.code]: e.target.value }))}
                  disabled={unlimited}
                  placeholder={unlimited ? '∞' : '0'}
                  style={{ ...inputStyle, background: unlimited ? 'var(--color-background-secondary, #f8fafc)' : undefined, color: unlimited ? 'var(--color-text-tertiary, #94a3b8)' : undefined }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-secondary, #64748b)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={unlimited} onChange={(e) => toggleUnlimited(l.code, e.target.checked)} />
                  {t('packages.field_unlimited')}
                </label>
              </div>
            )
          })}
        </div>
      </section>

      {/* Mise en vente : active + par défaut, cochables DÈS la création */}
      <section style={cardStyle}>
        <h2 style={sectionTitle}>{t('packages.col_status')}</h2>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-text-primary, #0f172a)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => {
              setActive(e.target.checked)
              // Une offre par défaut doit être active : on lève la case plutôt
              // que de laisser l'admin buter sur un refus serveur.
              if (!e.target.checked) setIsDefault(false)
            }}
          />
          {t('packages.field_active')}
        </label>
        <p style={{ ...hintStyle, marginLeft: 24 }}>{t('packages.active_help')}</p>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-text-primary, #0f172a)', cursor: active ? 'pointer' : 'not-allowed', marginTop: 14, opacity: active ? 1 : 0.5 }}>
          <input
            type="checkbox"
            checked={isDefault}
            disabled={!active}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          {t('packages.field_is_default')}
        </label>
        <p style={{ ...hintStyle, marginLeft: 24 }}>
          {active ? t('packages.is_default_hint', { target: targetLabel }) : t('packages.err_default_requires_active')}
        </p>
      </section>

      {/* Création */}
      <section style={cardStyle}>
        {saveError && (
          <div role="alert" style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, borderRadius: 8, marginBottom: 12 }}>
            {saveError}
          </div>
        )}
        {confirming && nameMissing && (
          <div role="alert" style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, borderRadius: 8, marginBottom: 12 }}>
            {t('packages.err_invalid_name')}
          </div>
        )}

        {confirming && !nameMissing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--color-text-primary, #0f172a)' }}>{t('packages.confirm_create')}</span>
            <button
              type="button"
              onClick={() => void create()}
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
            onClick={() => { setSaveError(null); setConfirming(true) }}
            style={{ padding: '10px 18px', background: '#00B9FF', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {t('packages.create')}
          </button>
        )}
      </section>
    </div>
  )
}
