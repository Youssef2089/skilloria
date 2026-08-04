'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/taxonomie/[id] (D7 — édition d'une branche + ses spécialités).
 * Gère aussi la CRÉATION : params.id === 'new'.
 *
 * FR = colonne `name` (base). EN/ES/DE optionnels → public.translations
 * (résolution tBDD avec repli FR). Garde-fous : désactivation d'une branche/
 * spécialité utilisée → confirmation chiffrée ; suppression désactivée tant que
 * l'usage > 0 (défense en profondeur côté serveur : 409 in_use).
 *
 * Détail hors ADMIN_NAV_SECTIONS → le bouton Retour global apparaît seul.
 */

type Translations = { en?: string; es?: string; de?: string }

type Speciality = {
  id: string
  name: string
  slug: string
  active: boolean
  sort_order: number
  profiles: number
  publications: number
  translations: Translations
}

type Branch = {
  id: string
  domain_id: string
  ecosystem: string | null
  name: string
  slug: string
  description: string | null
  active: boolean
  sort_order: number
  profiles: number
  publications: number
  translations: Translations
}

type DomainOpt = { id: string; name: string; slug: string; active: boolean }

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
const btnPrimary: React.CSSProperties = {
  padding: '9px 16px', background: '#00B9FF', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
}
const btnGhost: React.CSSProperties = {
  padding: '9px 16px', background: 'transparent', color: 'var(--color-text-secondary, #64748b)', border: '0.5px solid var(--color-border-tertiary, #e5e7eb)', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
}

// Formulaire de traductions FR (base) + EN/ES/DE. Réutilisé branche & spécialité.
type SpecForm = { name: string; en: string; es: string; de: string; slug: string; active: boolean }

export default function AdminTaxonomieDetailPage() {
  const t = useTranslations('admin_taxonomie')
  const tAdmin = useTranslations('admin_back_office')
  const params = useParams()
  const router = useRouter()
  const secureFetch = useSecureFetch()

  const rawId = (params?.id as string | undefined) ?? ''
  const isNew = rawId === 'new'

  // ── État branche ────────────────────────────────────────────────────────────
  const [branch, setBranch] = useState<Branch | null>(null)
  const [specialities, setSpecialities] = useState<Speciality[]>([])
  const [name, setName] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [nameEs, setNameEs] = useState('')
  const [nameDe, setNameDe] = useState('')
  const [slug, setSlug] = useState('')
  const [active, setActive] = useState(true)

  // Création : sélecteur d'écosystème.
  const [domains, setDomains] = useState<DomainOpt[]>([])
  const [domainId, setDomainId] = useState('')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Enregistrement branche
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Suppression branche
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // ── Spécialités : édition/création/suppression inline ───────────────────────
  const [editingSpecId, setEditingSpecId] = useState<string | null>(null) // 'new' | id | null
  const [specForm, setSpecForm] = useState<SpecForm>({ name: '', en: '', es: '', de: '', slug: '', active: true })
  const [specBusy, setSpecBusy] = useState(false)
  const [specError, setSpecError] = useState<string | null>(null)
  const [confirmDeactivateSpec, setConfirmDeactivateSpec] = useState<string | null>(null)
  const [confirmDeleteSpec, setConfirmDeleteSpec] = useState<string | null>(null)
  const [reorderBusy, setReorderBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (isNew) {
        // Sélecteur d'écosystème (obligatoire à la création).
        const dRes = await secureFetch('/api/admin/list-domains', { method: 'GET' })
        if (dRes.status === 403) {
          setError(tAdmin('errors.forbidden'))
          return
        }
        if (!dRes.ok) {
          setError(tAdmin('errors.generic'))
          return
        }
        const dJson = (await dRes.json()) as { domains: DomainOpt[] }
        setDomains(dJson.domains ?? [])
        return
      }

      const res = await secureFetch(`/api/admin/get-branch/${rawId}`, { method: 'GET' })
      if (res.status === 404) {
        setError('not_found')
        return
      }
      if (res.status === 403) {
        setError(tAdmin('errors.forbidden'))
        return
      }
      if (!res.ok) {
        setError(tAdmin('errors.generic'))
        return
      }
      const jsonBody = (await res.json()) as { branch: Branch; specialities: Speciality[] }
      const b = jsonBody.branch
      setBranch(b)
      setSpecialities(jsonBody.specialities ?? [])
      setName(b.name)
      setNameEn(b.translations?.en ?? '')
      setNameEs(b.translations?.es ?? '')
      setNameDe(b.translations?.de ?? '')
      setSlug(b.slug)
      setActive(b.active)
    } catch {
      setError(tAdmin('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [isNew, rawId, tAdmin, secureFetch])

  useEffect(() => {
    void load()
  }, [load])

  function mapSaveError(code: string | undefined, status: number): string {
    if (code === 'invalid_name') return t('err_invalid_name')
    if (code === 'invalid_slug') return t('err_invalid_slug')
    if (code === 'slug_taken') return t('err_slug_taken')
    if (code === 'invalid_domain') return t('err_invalid_domain')
    if (status === 403) return tAdmin('errors.forbidden')
    return tAdmin('errors.generic')
  }

  async function saveBranch() {
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const translations = { en: nameEn.trim(), es: nameEs.trim(), de: nameDe.trim() }
      if (isNew) {
        if (!domainId) {
          setSaveError(t('err_invalid_domain'))
          return
        }
        const res = await secureFetch('/api/admin/create-branch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            domain_id: domainId,
            name: name.trim(),
            slug: slug.trim() || undefined,
            active,
            translations,
          }),
        })
        const payload = (await res.json().catch(() => ({}))) as { code?: string; branch_id?: string }
        if (!res.ok || !payload.branch_id) {
          setSaveError(mapSaveError(payload.code, res.status))
          return
        }
        router.replace(`/admin/taxonomie/${payload.branch_id}`)
        return
      }

      const res = await secureFetch('/api/admin/update-branch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: rawId, name: name.trim(), slug: slug.trim(), active, translations }),
      })
      const payload = (await res.json().catch(() => ({}))) as { code?: string }
      if (!res.ok) {
        setSaveError(mapSaveError(payload.code, res.status))
        return
      }
      setSaved(true)
      setConfirming(false)
      await load()
    } catch {
      setSaveError(tAdmin('errors.generic'))
    } finally {
      setSaving(false)
    }
  }

  async function deleteBranch() {
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await secureFetch('/api/admin/delete-branch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: rawId }),
      })
      const payload = (await res.json().catch(() => ({}))) as { code?: string; profiles?: number; publications?: number; specialities?: number }
      if (!res.ok) {
        if (payload.code === 'in_use') {
          setDeleteError(
            t('err_branch_in_use', {
              profiles: payload.profiles ?? 0,
              publications: payload.publications ?? 0,
              specialities: payload.specialities ?? 0,
            }),
          )
        } else {
          setDeleteError(res.status === 403 ? tAdmin('errors.forbidden') : tAdmin('errors.generic'))
        }
        return
      }
      router.replace('/admin/taxonomie')
    } catch {
      setDeleteError(tAdmin('errors.generic'))
    } finally {
      setDeleting(false)
    }
  }

  // ── Spécialités ─────────────────────────────────────────────────────────────
  function openSpecCreate() {
    setSpecError(null)
    setEditingSpecId('new')
    setSpecForm({ name: '', en: '', es: '', de: '', slug: '', active: true })
  }
  function openSpecEdit(s: Speciality) {
    setSpecError(null)
    setEditingSpecId(s.id)
    setSpecForm({ name: s.name, en: s.translations?.en ?? '', es: s.translations?.es ?? '', de: s.translations?.de ?? '', slug: s.slug, active: s.active })
  }

  function mapSpecError(code: string | undefined, status: number): string {
    if (code === 'invalid_name') return t('err_invalid_name')
    if (code === 'invalid_slug') return t('err_invalid_slug')
    if (code === 'slug_taken') return t('err_slug_taken')
    if (status === 403) return tAdmin('errors.forbidden')
    return tAdmin('errors.generic')
  }

  async function saveSpec() {
    setSpecBusy(true)
    setSpecError(null)
    try {
      const translations = { en: specForm.en.trim(), es: specForm.es.trim(), de: specForm.de.trim() }
      if (editingSpecId === 'new') {
        const res = await secureFetch('/api/admin/create-speciality', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ branch_id: rawId, name: specForm.name.trim(), slug: specForm.slug.trim() || undefined, active: specForm.active, translations }),
        })
        const payload = (await res.json().catch(() => ({}))) as { code?: string }
        if (!res.ok) {
          setSpecError(mapSpecError(payload.code, res.status))
          return
        }
      } else {
        const res = await secureFetch('/api/admin/update-speciality', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: editingSpecId, name: specForm.name.trim(), slug: specForm.slug.trim(), active: specForm.active, translations }),
        })
        const payload = (await res.json().catch(() => ({}))) as { code?: string }
        if (!res.ok) {
          setSpecError(mapSpecError(payload.code, res.status))
          return
        }
      }
      setEditingSpecId(null)
      await load()
    } catch {
      setSpecError(tAdmin('errors.generic'))
    } finally {
      setSpecBusy(false)
    }
  }

  // Activer/désactiver rapide. Une désactivation avec usage>0 passe par confirm.
  async function toggleSpecActive(s: Speciality) {
    setSpecBusy(true)
    setSpecError(null)
    try {
      const res = await secureFetch('/api/admin/update-speciality', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: s.id, active: !s.active }),
      })
      if (!res.ok) {
        setSpecError(res.status === 403 ? tAdmin('errors.forbidden') : tAdmin('errors.generic'))
        return
      }
      setConfirmDeactivateSpec(null)
      await load()
    } catch {
      setSpecError(tAdmin('errors.generic'))
    } finally {
      setSpecBusy(false)
    }
  }

  async function deleteSpec(s: Speciality) {
    setSpecBusy(true)
    setSpecError(null)
    try {
      const res = await secureFetch('/api/admin/delete-speciality', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: s.id }),
      })
      const payload = (await res.json().catch(() => ({}))) as { code?: string; profiles?: number; publications?: number }
      if (!res.ok) {
        if (payload.code === 'in_use') {
          setSpecError(t('err_spec_in_use', { profiles: payload.profiles ?? 0, publications: payload.publications ?? 0 }))
        } else {
          setSpecError(res.status === 403 ? tAdmin('errors.forbidden') : tAdmin('errors.generic'))
        }
        return
      }
      setConfirmDeleteSpec(null)
      await load()
    } catch {
      setSpecError(tAdmin('errors.generic'))
    } finally {
      setSpecBusy(false)
    }
  }

  async function reorderSpec(s: Speciality, direction: 'up' | 'down') {
    const ordered = [...specialities].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    const idx = ordered.findIndex((x) => x.id === s.id)
    const neighbor = direction === 'up' ? ordered[idx - 1] : ordered[idx + 1]
    if (!neighbor) return
    setReorderBusy(true)
    setSpecError(null)
    try {
      const a = s.sort_order
      const b = neighbor.sort_order
      const newSelf = a === b ? (direction === 'up' ? b - 1 : b + 1) : b
      const newNeighbor = a
      const r1 = await secureFetch('/api/admin/update-speciality', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: s.id, sort_order: Math.max(0, newSelf) }),
      })
      const r2 = await secureFetch('/api/admin/update-speciality', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: neighbor.id, sort_order: Math.max(0, newNeighbor) }),
      })
      if (!r1.ok || !r2.ok) {
        setSpecError(tAdmin('errors.generic'))
        return
      }
      await load()
    } catch {
      setSpecError(tAdmin('errors.generic'))
    } finally {
      setReorderBusy(false)
    }
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 14 }}>{tAdmin('loading')}</div>
  }

  if (error === 'not_found') {
    return (
      <div>
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <h2 style={{ fontSize: 18, fontWeight: 500, color: 'var(--color-text-primary, #0f172a)' }}>{t('not_found_title')}</h2>
        </div>
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

  const branchUsage = (branch?.profiles ?? 0) + (branch?.publications ?? 0)
  const willDeactivateBranch = !isNew && !!branch?.active && !active
  const orderedSpecs = [...specialities].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  // Suppression branche possible seulement à usage 0 ET sans spécialité.
  const canDeleteBranch = !isNew && branchUsage === 0 && specialities.length === 0

  const langNote = (
    <p style={{ fontSize: 12, color: 'var(--color-text-tertiary, #94a3b8)', margin: '10px 0 0' }}>
      {t('lang_fallback_note')}
    </p>
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: 'var(--color-text-primary, #0f172a)', margin: 0 }}>
          {isNew ? t('new_title') : branch?.name}
        </h1>
        {!isNew && branch?.ecosystem && (
          <span style={{ fontSize: 10.5, fontWeight: 700, color: '#3730a3', background: '#eef2ff', border: '0.5px solid #c7d2fe', borderRadius: 6, padding: '1px 7px', whiteSpace: 'nowrap' }}>
            {branch.ecosystem}
          </span>
        )}
      </div>

      {/* ── Identité de la branche ─────────────────────────────────────────── */}
      <section style={cardStyle}>
        <h2 style={sectionTitle}>{t('section_branch')}</h2>

        {/* Écosystème : sélectionnable UNIQUEMENT à la création. */}
        {isNew ? (
          <div style={{ marginBottom: 14 }}>
            <label htmlFor="eco" style={labelStyle}>{tAdmin('ecosystem_label')}</label>
            <select id="eco" value={domainId} onChange={(e) => setDomainId(e.target.value)} style={inputStyle}>
              <option value="">{t('ecosystem_placeholder')}</option>
              {domains.map((d) => (
                <option key={d.id} value={d.id}>{d.name}{d.active ? '' : ` (${t('status_inactive')})`}</option>
              ))}
            </select>
          </div>
        ) : (
          <div style={{ marginBottom: 14 }}>
            <span style={labelStyle}>{tAdmin('ecosystem_label')}</span>
            <div style={{ ...inputStyle, background: 'var(--color-background-secondary, #f8fafc)', color: 'var(--color-text-secondary, #64748b)' }}>
              {branch?.ecosystem ?? '—'}
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary, #94a3b8)', margin: '6px 0 0' }}>{t('ecosystem_locked_hint')}</p>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 14 }}>
          <div>
            <label htmlFor="bname" style={labelStyle}>{t('field_name_fr')}</label>
            <input id="bname" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} style={inputStyle} placeholder={t('field_name_fr_placeholder')} />
          </div>
          <div>
            <label htmlFor="bslug" style={labelStyle}>{t('field_slug')}</label>
            <input id="bslug" value={slug} onChange={(e) => setSlug(e.target.value)} maxLength={50} style={inputStyle} placeholder={t('field_slug_placeholder')} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          <div>
            <label htmlFor="ben" style={labelStyle}>{t('field_name_en')}</label>
            <input id="ben" value={nameEn} onChange={(e) => setNameEn(e.target.value)} maxLength={100} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="bes" style={labelStyle}>{t('field_name_es')}</label>
            <input id="bes" value={nameEs} onChange={(e) => setNameEs(e.target.value)} maxLength={100} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="bde" style={labelStyle}>{t('field_name_de')}</label>
            <input id="bde" value={nameDe} onChange={(e) => setNameDe(e.target.value)} maxLength={100} style={inputStyle} />
          </div>
        </div>
        {langNote}

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-text-primary, #0f172a)', cursor: 'pointer', marginTop: 16 }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t('field_active')}
        </label>

        {willDeactivateBranch && branchUsage > 0 && (
          <div role="alert" style={{ marginTop: 12, padding: '10px 14px', background: '#FEF3C7', border: '1px solid #fde68a', color: '#92400e', fontSize: 12, borderRadius: 8 }}>
            {t('deactivate_branch_warning', { profiles: branch?.profiles ?? 0, publications: branch?.publications ?? 0 })}
          </div>
        )}

        {saveError && (
          <div role="alert" style={{ marginTop: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, borderRadius: 8 }}>
            {saveError}
          </div>
        )}
        {saved && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: '#DCFCE7', border: '1px solid #bbf7d0', color: '#166534', fontSize: 12, borderRadius: 8 }}>
            {t('saved')}
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          {confirming ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--color-text-primary, #0f172a)' }}>{t('confirm_save')}</span>
              <button type="button" onClick={() => void saveBranch()} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}>
                {saving ? tAdmin('loading') : t('confirm_yes')}
              </button>
              <button type="button" onClick={() => setConfirming(false)} disabled={saving} style={btnGhost}>{t('confirm_cancel')}</button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setSaved(false); setSaveError(null); setConfirming(true) }}
              disabled={!name.trim() || (isNew && !domainId)}
              style={{ ...btnPrimary, opacity: !name.trim() || (isNew && !domainId) ? 0.5 : 1, cursor: !name.trim() || (isNew && !domainId) ? 'not-allowed' : 'pointer' }}
            >
              {isNew ? t('action_create_branch') : t('save')}
            </button>
          )}
        </div>
      </section>

      {/* ── Spécialités (édition seule après création de la branche) ────────── */}
      {!isNew && (
        <section style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <h2 style={{ ...sectionTitle, marginBottom: 0 }}>{t('section_specialities')}</h2>
            {editingSpecId !== 'new' && (
              <button type="button" onClick={openSpecCreate} style={{ ...btnPrimary, padding: '7px 14px', fontSize: 12 }}>
                {t('action_new_speciality')}
              </button>
            )}
          </div>

          {specError && (
            <div role="alert" style={{ marginBottom: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, borderRadius: 8 }}>
              {specError}
            </div>
          )}

          {/* Formulaire de création */}
          {editingSpecId === 'new' && (
            <div style={{ border: '0.5px solid var(--color-border-tertiary, #e5e7eb)', borderRadius: 10, padding: 16, marginBottom: 14, background: 'var(--color-background-secondary, #f8fafc)' }}>
              <SpecEditor form={specForm} setForm={setSpecForm} t={t} langNote={langNote} />
              <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => void saveSpec()} disabled={specBusy || !specForm.name.trim()} style={{ ...btnPrimary, padding: '8px 14px', fontSize: 12, opacity: specBusy || !specForm.name.trim() ? 0.5 : 1, cursor: specBusy || !specForm.name.trim() ? 'not-allowed' : 'pointer' }}>
                  {specBusy ? tAdmin('loading') : t('confirm_yes')}
                </button>
                <button type="button" onClick={() => setEditingSpecId(null)} disabled={specBusy} style={{ ...btnGhost, padding: '8px 14px', fontSize: 12 }}>{t('confirm_cancel')}</button>
              </div>
            </div>
          )}

          {orderedSpecs.length === 0 && editingSpecId !== 'new' ? (
            <div style={{ padding: '28px 16px', textAlign: 'center', border: '1px dashed var(--color-border-tertiary, #e5e7eb)', borderRadius: 10 }}>
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', margin: '0 0 4px' }}>{t('spec_empty_title')}</p>
              <p style={{ fontSize: 12, color: 'var(--color-text-tertiary, #94a3b8)', margin: 0 }}>{t('spec_empty_hint')}</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {orderedSpecs.map((s, i) => {
                const usage = s.profiles + s.publications
                const editing = editingSpecId === s.id
                return (
                  <div key={s.id} style={{ border: '0.5px solid var(--color-border-tertiary, #e5e7eb)', borderRadius: 10, padding: editing ? 16 : '10px 14px', background: editing ? 'var(--color-background-secondary, #f8fafc)' : 'transparent' }}>
                    {editing ? (
                      <>
                        <SpecEditor form={specForm} setForm={setSpecForm} t={t} langNote={langNote} />
                        <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                          <button type="button" onClick={() => void saveSpec()} disabled={specBusy || !specForm.name.trim()} style={{ ...btnPrimary, padding: '8px 14px', fontSize: 12, opacity: specBusy || !specForm.name.trim() ? 0.5 : 1, cursor: specBusy || !specForm.name.trim() ? 'not-allowed' : 'pointer' }}>
                            {specBusy ? tAdmin('loading') : t('confirm_yes')}
                          </button>
                          <button type="button" onClick={() => setEditingSpecId(null)} disabled={specBusy} style={{ ...btnGhost, padding: '8px 14px', fontSize: 12 }}>{t('confirm_cancel')}</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                            <span style={{ display: 'inline-flex', gap: 4 }}>
                              <button type="button" onClick={() => void reorderSpec(s, 'up')} disabled={i === 0 || reorderBusy} aria-label={t('reorder_up')} title={t('reorder_up')} style={{ ...iconBtnSmall, opacity: i === 0 || reorderBusy ? 0.4 : 1, cursor: i === 0 || reorderBusy ? 'not-allowed' : 'pointer' }}>↑</button>
                              <button type="button" onClick={() => void reorderSpec(s, 'down')} disabled={i === orderedSpecs.length - 1 || reorderBusy} aria-label={t('reorder_down')} title={t('reorder_down')} style={{ ...iconBtnSmall, opacity: i === orderedSpecs.length - 1 || reorderBusy ? 0.4 : 1, cursor: i === orderedSpecs.length - 1 || reorderBusy ? 'not-allowed' : 'pointer' }}>↓</button>
                            </span>
                            <span style={{ minWidth: 0 }}>
                              <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary, #0f172a)' }}>{s.name}</span>
                              <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-tertiary, #94a3b8)', marginTop: 2 }}>
                                {s.slug} · {t('usage_summary', { profiles: s.profiles, publications: s.publications })}
                              </span>
                            </span>
                            <span style={{ flexShrink: 0, fontSize: 11, padding: '2px 8px', borderRadius: 10, background: s.active ? '#DCFCE7' : '#F1F5F9', color: s.active ? '#166534' : '#64748b' }}>
                              {s.active ? t('status_active') : t('status_inactive')}
                            </span>
                          </span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                            <button type="button" onClick={() => openSpecEdit(s)} style={linkBtn}>{t('action_edit')}</button>
                            <button
                              type="button"
                              onClick={() => {
                                // Désactivation avec usage → confirmation chiffrée.
                                if (s.active && usage > 0) { setConfirmDeactivateSpec(s.id); setConfirmDeleteSpec(null) }
                                else void toggleSpecActive(s)
                              }}
                              style={linkBtn}
                            >
                              {s.active ? t('action_deactivate') : t('action_activate')}
                            </button>
                            <button
                              type="button"
                              onClick={() => { setConfirmDeleteSpec(s.id); setConfirmDeactivateSpec(null); setSpecError(null) }}
                              disabled={usage > 0}
                              title={usage > 0 ? t('delete_disabled_hint') : undefined}
                              style={{ ...linkBtn, color: usage > 0 ? 'var(--color-text-tertiary, #94a3b8)' : '#b91c1c', cursor: usage > 0 ? 'not-allowed' : 'pointer' }}
                            >
                              {t('action_delete')}
                            </button>
                          </span>
                        </div>

                        {confirmDeactivateSpec === s.id && (
                          <div style={{ marginTop: 10, padding: '10px 14px', background: '#FEF3C7', border: '1px solid #fde68a', borderRadius: 8 }}>
                            <p style={{ fontSize: 12, color: '#92400e', margin: '0 0 10px' }}>
                              {t('deactivate_spec_warning', { profiles: s.profiles, publications: s.publications })}
                            </p>
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                              <button type="button" onClick={() => void toggleSpecActive(s)} disabled={specBusy} style={{ ...btnPrimary, padding: '7px 13px', fontSize: 12 }}>{t('confirm_yes')}</button>
                              <button type="button" onClick={() => setConfirmDeactivateSpec(null)} disabled={specBusy} style={{ ...btnGhost, padding: '7px 13px', fontSize: 12 }}>{t('confirm_cancel')}</button>
                            </div>
                          </div>
                        )}

                        {confirmDeleteSpec === s.id && (
                          <div style={{ marginTop: 10, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8 }}>
                            <p style={{ fontSize: 12, color: '#b91c1c', margin: '0 0 10px' }}>{t('confirm_delete_spec')}</p>
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                              <button type="button" onClick={() => void deleteSpec(s)} disabled={specBusy} style={{ padding: '7px 13px', background: '#b91c1c', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>{t('confirm_yes')}</button>
                              <button type="button" onClick={() => setConfirmDeleteSpec(null)} disabled={specBusy} style={{ ...btnGhost, padding: '7px 13px', fontSize: 12 }}>{t('confirm_cancel')}</button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}

      {/* ── Suppression de la branche ──────────────────────────────────────── */}
      {!isNew && (
        <section style={cardStyle}>
          <h2 style={sectionTitle}>{t('section_danger')}</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', margin: '0 0 12px' }}>
            {canDeleteBranch ? t('delete_branch_explain') : t('delete_branch_blocked')}
          </p>

          {deleteError && (
            <div role="alert" style={{ marginBottom: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, borderRadius: 8 }}>
              {deleteError}
            </div>
          )}

          {confirmDelete ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--color-text-primary, #0f172a)' }}>{t('confirm_delete_branch')}</span>
              <button type="button" onClick={() => void deleteBranch()} disabled={deleting} style={{ padding: '9px 16px', background: '#b91c1c', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1, fontFamily: 'inherit' }}>
                {deleting ? tAdmin('loading') : t('confirm_yes')}
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting} style={btnGhost}>{t('confirm_cancel')}</button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setDeleteError(null); setConfirmDelete(true) }}
              disabled={!canDeleteBranch}
              title={!canDeleteBranch ? t('delete_disabled_hint') : undefined}
              style={{ padding: '9px 16px', background: 'transparent', color: canDeleteBranch ? '#b91c1c' : 'var(--color-text-tertiary, #94a3b8)', border: `0.5px solid ${canDeleteBranch ? '#fecaca' : 'var(--color-border-tertiary, #e5e7eb)'}`, borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: canDeleteBranch ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}
            >
              {t('action_delete_branch')}
            </button>
          )}
        </section>
      )}
    </div>
  )
}

const iconBtnSmall: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24,
  border: '0.5px solid var(--color-border-tertiary, #e5e7eb)', borderRadius: 6, background: 'transparent',
  color: 'var(--color-text-secondary, #64748b)', fontFamily: 'inherit', fontSize: 12, lineHeight: 1,
}
const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, fontSize: 12, fontFamily: 'inherit',
  color: 'var(--color-text-secondary, #64748b)', textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer',
}

// Éditeur de libellés d'une spécialité (FR base + EN/ES/DE + slug + actif).
function SpecEditor({
  form,
  setForm,
  t,
  langNote,
}: {
  form: SpecForm
  setForm: React.Dispatch<React.SetStateAction<SpecForm>>
  t: ReturnType<typeof useTranslations>
  langNote: React.ReactNode
}) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>{t('field_name_fr')}</label>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={100} style={inputStyle} placeholder={t('field_name_fr_placeholder')} />
        </div>
        <div>
          <label style={labelStyle}>{t('field_slug')}</label>
          <input value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} maxLength={50} style={inputStyle} placeholder={t('field_slug_placeholder')} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <div>
          <label style={labelStyle}>{t('field_name_en')}</label>
          <input value={form.en} onChange={(e) => setForm((f) => ({ ...f, en: e.target.value }))} maxLength={100} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>{t('field_name_es')}</label>
          <input value={form.es} onChange={(e) => setForm((f) => ({ ...f, es: e.target.value }))} maxLength={100} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>{t('field_name_de')}</label>
          <input value={form.de} onChange={(e) => setForm((f) => ({ ...f, de: e.target.value }))} maxLength={100} style={inputStyle} />
        </div>
      </div>
      {langNote}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-text-primary, #0f172a)', cursor: 'pointer', marginTop: 12 }}>
        <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
        {t('field_active')}
      </label>
    </div>
  )
}
