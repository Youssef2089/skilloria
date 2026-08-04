'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/taxonomie (D7 — administration de la taxonomie, LISTE).
 *
 * Source : GET /api/admin/list-branches (service-role, TOUS écosystèmes,
 * actives ET inactives). Édition/création via [id]. Réordonnancement inline
 * (↑/↓) par écosystème via POST /api/admin/update-branch (sort_order).
 *
 * Sous le tableau : panneau « Spécialités hors référentiel » — valeurs libres
 * saisies via « Autre » (GET /api/admin/list-other-specialities), triées par
 * fréquence décroissante = priorité d'intégration.
 *
 * Page de MENU (dérivée de ADMIN_NAV_SECTIONS) → aucun bouton Retour.
 */

type Branch = {
  id: string
  domain_id: string
  ecosystem: string | null
  name: string
  slug: string
  active: boolean
  sort_order: number
  speciality_count: number
  profiles: number
  publications: number
}

type OtherItem = { value: string; count: number; domain_name: string | null }

export default function AdminTaxonomiePage() {
  const t = useTranslations('admin_taxonomie')
  const tAdmin = useTranslations('admin_back_office')
  const secureFetch = useSecureFetch()

  const [branches, setBranches] = useState<Branch[] | null>(null)
  const [others, setOthers] = useState<OtherItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reorderingId, setReorderingId] = useState<string | null>(null)

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      setError(null)
      try {
        const res = await secureFetch('/api/admin/list-branches', { method: 'GET' })
        if (res.status === 403) {
          setError(tAdmin('errors.forbidden'))
          return
        }
        if (!res.ok) {
          setError(tAdmin('errors.generic'))
          return
        }
        const jsonBody = (await res.json()) as { branches: Branch[] }
        setBranches(jsonBody.branches ?? [])

        // Panneau « hors référentiel » : best-effort, ne bloque pas la liste.
        try {
          const oRes = await secureFetch('/api/admin/list-other-specialities', { method: 'GET' })
          if (oRes.ok) {
            const oJson = (await oRes.json()) as { items: OtherItem[] }
            setOthers(oJson.items ?? [])
          } else {
            setOthers([])
          }
        } catch {
          setOthers([])
        }
      } catch {
        setError(tAdmin('errors.generic'))
      } finally {
        setLoading(false)
      }
    },
    [tAdmin, secureFetch],
  )

  useEffect(() => {
    void load()
  }, [load])

  // Réordonnancement : échange le sort_order avec le voisin (même écosystème).
  async function reorder(branch: Branch, direction: 'up' | 'down') {
    const list = branches ?? []
    const sameEco = list
      .filter((b) => b.domain_id === branch.domain_id)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    const idx = sameEco.findIndex((b) => b.id === branch.id)
    const neighbor = direction === 'up' ? sameEco[idx - 1] : sameEco[idx + 1]
    if (!neighbor) return

    setReorderingId(branch.id)
    setError(null)
    try {
      // Deux mises à jour : on échange les sort_order. Si les valeurs sont
      // égales (seed), on force un ordre distinct autour du voisin.
      const a = branch.sort_order
      const b = neighbor.sort_order
      const newBranchOrder = a === b ? (direction === 'up' ? b - 1 : b + 1) : b
      const newNeighborOrder = a === b ? branch.sort_order : a

      const r1 = await secureFetch('/api/admin/update-branch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: branch.id, sort_order: Math.max(0, newBranchOrder) }),
      })
      const r2 = await secureFetch('/api/admin/update-branch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: neighbor.id, sort_order: Math.max(0, newNeighborOrder) }),
      })
      if (!r1.ok || !r2.ok) {
        setError(tAdmin('errors.generic'))
        return
      }
      await load(true)
    } catch {
      setError(tAdmin('errors.generic'))
    } finally {
      setReorderingId(null)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 14 }}>
        {tAdmin('loading')}
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
  const iconBtn: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 26,
    height: 26,
    border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
    borderRadius: 7,
    background: 'transparent',
    color: 'var(--color-text-secondary, #64748b)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 13,
    lineHeight: 1,
  }

  const list = branches ?? []
  // Voisinage par écosystème pour désactiver ↑/↓ aux extrémités.
  const orderByEco = new Map<string, Branch[]>()
  for (const b of list) {
    const arr = orderByEco.get(b.domain_id) ?? []
    arr.push(b)
    orderByEco.set(b.domain_id, arr)
  }
  for (const arr of orderByEco.values()) {
    arr.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  }
  const isFirst = (b: Branch) => (orderByEco.get(b.domain_id) ?? [])[0]?.id === b.id
  const isLast = (b: Branch) => {
    const arr = orderByEco.get(b.domain_id) ?? []
    return arr[arr.length - 1]?.id === b.id
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 500, color: 'var(--color-text-primary, #0f172a)', margin: '0 0 4px' }}>
            {t('page_title')}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', margin: 0 }}>
            {t('subtitle')}
          </p>
        </div>
        <Link
          href="/admin/taxonomie/new"
          style={{
            padding: '9px 16px',
            background: '#00B9FF',
            color: '#fff',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 500,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {t('action_new_branch')}
        </Link>
      </div>

      {list.length === 0 ? (
        <div
          style={{
            background: 'var(--color-background-primary, #fff)',
            border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
            borderRadius: 12,
            padding: '40px 24px',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary, #64748b)', margin: '0 0 4px' }}>
            {t('empty_title')}
          </p>
          <p style={{ fontSize: 13, color: 'var(--color-text-tertiary, #94a3b8)', margin: 0 }}>
            {t('empty_hint')}
          </p>
        </div>
      ) : (
        <div
          style={{
            background: 'var(--color-background-primary, #fff)',
            border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
            borderRadius: 12,
            overflowX: 'auto',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr>
                <th style={thStyle}>{tAdmin('ecosystem_label')}</th>
                <th style={thStyle}>{t('col_branch')}</th>
                <th style={thStyle}>{t('col_specialities')}</th>
                <th style={thStyle}>{t('col_status')}</th>
                <th style={thStyle}>{t('col_usage')}</th>
                <th style={thStyle} aria-label={t('col_reorder')} />
                <th style={thStyle} aria-label={t('action_edit')} />
              </tr>
            </thead>
            <tbody>
              {list.map((b) => (
                <tr key={b.id}>
                  <td style={{ ...tdStyle }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: '#3730a3', background: '#eef2ff', border: '0.5px solid #c7d2fe', borderRadius: 6, padding: '1px 7px', whiteSpace: 'nowrap' }}>
                      {b.ecosystem ?? '—'}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ display: 'block', fontWeight: 500 }}>{b.name}</span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-tertiary, #94a3b8)', marginTop: 2 }}>
                      {b.slug}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--color-text-secondary, #64748b)', whiteSpace: 'nowrap' }}>
                    {t('speciality_count', { count: b.speciality_count })}
                  </td>
                  <td style={tdStyle}>
                    <span
                      style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        borderRadius: 10,
                        background: b.active ? '#DCFCE7' : '#F1F5F9',
                        color: b.active ? '#166534' : '#64748b',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {b.active ? t('status_active') : t('status_inactive')}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--color-text-secondary, #64748b)', whiteSpace: 'nowrap' }}>
                    {t('usage_summary', { profiles: b.profiles, publications: b.publications })}
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => void reorder(b, 'up')}
                        disabled={isFirst(b) || reorderingId !== null}
                        aria-label={t('reorder_up')}
                        title={t('reorder_up')}
                        style={{ ...iconBtn, opacity: isFirst(b) || reorderingId !== null ? 0.4 : 1, cursor: isFirst(b) || reorderingId !== null ? 'not-allowed' : 'pointer' }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => void reorder(b, 'down')}
                        disabled={isLast(b) || reorderingId !== null}
                        aria-label={t('reorder_down')}
                        title={t('reorder_down')}
                        style={{ ...iconBtn, opacity: isLast(b) || reorderingId !== null ? 0.4 : 1, cursor: isLast(b) || reorderingId !== null ? 'not-allowed' : 'pointer' }}
                      >
                        ↓
                      </button>
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Link
                      href={`/admin/taxonomie/${b.id}`}
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
                      {t('action_edit')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Spécialités hors référentiel ─────────────────────────────────────── */}
      <section
        style={{
          background: 'var(--color-background-primary, #fff)',
          border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
          borderRadius: 12,
          padding: '18px 22px',
          marginTop: 20,
        }}
      >
        <h2 style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--color-text-secondary, #64748b)', marginBottom: 6 }}>
          {t('other_title')}
        </h2>
        <p style={{ fontSize: 12, color: 'var(--color-text-tertiary, #94a3b8)', margin: '0 0 14px' }}>
          {t('other_hint')}
        </p>

        {(others ?? []).length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', margin: 0 }}>
            {t('other_empty')}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(others ?? []).map((o, i) => (
              <div
                key={`${o.domain_name ?? ''}-${o.value}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '10px 14px',
                  border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
                  borderRadius: 8,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  {o.domain_name && (
                    <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: '#3730a3', background: '#eef2ff', border: '0.5px solid #c7d2fe', borderRadius: 6, padding: '1px 7px', whiteSpace: 'nowrap' }}>
                      {o.domain_name}
                    </span>
                  )}
                  <span style={{ fontSize: 13, color: 'var(--color-text-primary, #0f172a)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {o.value}
                  </span>
                </span>
                <span style={{ flexShrink: 0, fontSize: 12, color: 'var(--color-text-secondary, #64748b)', whiteSpace: 'nowrap' }}>
                  {t('other_count', { count: o.count })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
