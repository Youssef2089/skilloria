'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { useDomain } from '@/context/DomainContext'

/**
 * /admin/organisations — liste des organisations à valider (B5c).
 *
 * 4 onglets (state local) : En attente · Validées · Refusées · Toutes.
 * Onglet par défaut "En attente". Compteur par onglet.
 *
 * Source : GET /api/admin/list-orgs?status=<filter>
 * Headers : Bearer (Supabase session) + x-subdomain + x-session-token
 *           (pattern projet, requireAdmin attend ces 3 headers).
 *
 * Tableau adaptatif :
 *   - pending/all : col_registered = created_at
 *   - approved/rejected : col_decided = verified_at
 *
 * Score IA coloré : rouge <5, ambre 5-8, vert >=9.
 */

type TabKey = 'pending' | 'approved' | 'rejected' | 'all'

type OrgRow = {
  id: string
  company_name: string | null
  logo_url: string | null
  siren: string | null
  org_type: string | null
  verification_status: string | null
  verification_data:
    | { score?: number; last_provider?: string; had_rejection?: boolean }
    | null
  verification_method: string | null
  created_at: string
  verified_at: string | null
  verified_by: string | null
  review_reason: string | null
}

function initialsOf(name: string | null | undefined): string {
  const cleaned = (name ?? '').trim()
  if (!cleaned) return '??'
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase()
}

function scoreColor(score: number | null | undefined): string {
  if (score == null) return 'var(--color-text-tertiary, #94a3b8)'
  if (score < 5) return '#dc2626'
  if (score < 9) return '#d97706'
  return '#16a34a'
}

export default function AdminOrgsListPage() {
  const t = useTranslations('admin_back_office')
  const locale = useLocale()
  const domain = useDomain()

  const [activeTab, setActiveTab] = useState<TabKey>('pending')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Compteurs : on fait 1 call par onglet n'est pas idéal. On fait à la place
  // 1 call "all" + comptage côté client par status. Petite optimisation V1.
  const [allOrgs, setAllOrgs] = useState<OrgRow[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        setError(t('errors.forbidden'))
        setLoading(false)
        return
      }
      const res = await fetch('/api/admin/list-orgs?status=all', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'x-subdomain': domain.subdomain,
        },
      })
      if (res.status === 403) {
        setError(t('errors.forbidden'))
        setLoading(false)
        return
      }
      if (!res.ok) {
        setError(t('errors.generic'))
        setLoading(false)
        return
      }
      const json = (await res.json()) as { orgs: OrgRow[] }
      setAllOrgs(json.orgs ?? [])
    } catch {
      setError(t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [t, domain.subdomain])

  useEffect(() => {
    void load()
  }, [load])

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, rejected: 0, all: allOrgs.length }
    for (const o of allOrgs) {
      if (o.verification_status === 'pending_admin_review') c.pending++
      else if (o.verification_status === 'approved') c.approved++
      else if (o.verification_status === 'rejected') c.rejected++
    }
    return c
  }, [allOrgs])

  // Tri par onglet : pending/all par created_at DESC,
  // approved/rejected par verified_at DESC.
  const filtered = useMemo(() => {
    let list = allOrgs.slice()
    if (activeTab === 'pending') {
      list = list.filter((o) => o.verification_status === 'pending_admin_review')
      list.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    } else if (activeTab === 'approved') {
      list = list.filter((o) => o.verification_status === 'approved')
      list.sort((a, b) => (b.verified_at ?? '').localeCompare(a.verified_at ?? ''))
    } else if (activeTab === 'rejected') {
      list = list.filter((o) => o.verification_status === 'rejected')
      list.sort((a, b) => (b.verified_at ?? '').localeCompare(a.verified_at ?? ''))
    } else {
      list.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    }
    return list
  }, [allOrgs, activeTab])

  const showDecidedColumn = activeTab === 'approved' || activeTab === 'rejected'

  const tabs: Array<{ key: TabKey; label: string; count: number; dot: string }> = [
    { key: 'pending', label: t('orgs.tab_pending'), count: counts.pending, dot: '#d97706' },
    { key: 'approved', label: t('orgs.tab_approved'), count: counts.approved, dot: '#16a34a' },
    { key: 'rejected', label: t('orgs.tab_rejected'), count: counts.rejected, dot: '#dc2626' },
    { key: 'all', label: t('orgs.tab_all'), count: counts.all, dot: '#94a3b8' },
  ]

  const emptyKey =
    activeTab === 'pending'
      ? 'empty_pending'
      : activeTab === 'approved'
        ? 'empty_approved'
        : activeTab === 'rejected'
          ? 'empty_rejected'
          : 'empty_pending'

  function formatDate(iso: string | null): string {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleDateString(locale, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    } catch {
      return iso.slice(0, 10)
    }
  }

  return (
    <div>
      <h1
        style={{
          fontSize: 22,
          fontWeight: 500,
          color: 'var(--color-text-primary, #0f172a)',
          marginBottom: 24,
        }}
      >
        {t('orgs.page_title')}
      </h1>

      {/* Onglets */}
      <div
        role="tablist"
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
          marginBottom: 20,
          overflowX: 'auto',
        }}
      >
        {tabs.map((tab) => {
          const active = tab.key === activeTab
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 14px 10px',
                background: 'transparent',
                border: 'none',
                borderBottom: active ? '2px solid #00B9FF' : '2px solid transparent',
                color: active
                  ? 'var(--color-text-primary, #0f172a)'
                  : 'var(--color-text-secondary, #64748b)',
                fontSize: 13,
                fontWeight: active ? 500 : 400,
                cursor: 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
            >
              <span
                aria-hidden
                style={{ width: 6, height: 6, borderRadius: '50%', background: tab.dot }}
              />
              {tab.label} ({Math.round(tab.count)})
            </button>
          )
        })}
      </div>

      {/* Contenu */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 14 }}>
          {t('loading')}
        </div>
      ) : error ? (
        <div
          role="alert"
          style={{
            padding: 16,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
            fontSize: 13,
            borderRadius: 10,
          }}
        >
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div
          style={{
            padding: 40,
            textAlign: 'center',
            color: 'var(--color-text-secondary, #64748b)',
            fontSize: 14,
            background: 'var(--color-background-primary, #fff)',
            border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
            borderRadius: 12,
          }}
        >
          {t(emptyKey)}
        </div>
      ) : (
        <div
          style={{
            background: 'var(--color-background-primary, #fff)',
            border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(220px, 2fr) 130px 130px 100px 120px',
              gap: 0,
              padding: '10px 18px',
              borderBottom: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
              background: 'var(--color-background-secondary, #f8fafc)',
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--color-text-secondary, #64748b)',
              textTransform: 'uppercase',
              letterSpacing: '.05em',
            }}
          >
            <span>{t('table.col_company')}</span>
            <span>{t('table.col_siren')}</span>
            <span>{t('table.col_type')}</span>
            <span>{t('table.col_score')}</span>
            <span>{showDecidedColumn ? t('table.col_decided') : t('table.col_registered')}</span>
          </div>

          {filtered.map((org) => {
            const initials = initialsOf(org.company_name)
            const score = org.verification_data?.score ?? null
            return (
              <Link
                key={org.id}
                href={`/admin/organisations/${org.id}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(220px, 2fr) 130px 130px 100px 120px',
                  gap: 0,
                  padding: '14px 18px',
                  borderBottom: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
                  textDecoration: 'none',
                  color: 'var(--color-text-primary, #0f172a)',
                  fontSize: 13,
                  alignItems: 'center',
                  transition: 'background .12s',
                }}
              >
                {/* Entreprise (avatar + nom) */}
                <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  {org.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={org.logo_url}
                      alt={org.company_name ?? ''}
                      width={32}
                      height={32}
                      style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                    />
                  ) : (
                    <span
                      aria-hidden
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        background: '#DBEAFE',
                        color: '#00B9FF',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        fontWeight: 500,
                        flexShrink: 0,
                      }}
                    >
                      {initials}
                    </span>
                  )}
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontWeight: 500,
                    }}
                  >
                    {org.company_name ?? '—'}
                  </span>
                </span>

                <span style={{ color: 'var(--color-text-secondary, #64748b)' }}>
                  {org.siren ?? '—'}
                </span>

                <span style={{ color: 'var(--color-text-secondary, #64748b)' }}>
                  {org.org_type ?? '—'}
                </span>

                <span style={{ color: scoreColor(score), fontWeight: 500 }}>
                  {score == null ? '—' : Math.round(score)}
                </span>

                <span style={{ color: 'var(--color-text-secondary, #64748b)' }}>
                  {formatDate(showDecidedColumn ? org.verified_at : org.created_at)}
                </span>
              </Link>
            )
          })}
        </div>
      )}

      {/* Bouton refresh discret en bas */}
      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <button
          type="button"
          onClick={() => void load()}
          style={{
            padding: '6px 12px',
            background: 'transparent',
            border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--color-text-secondary, #64748b)',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          ↻
        </button>
      </div>
    </div>
  )
}
