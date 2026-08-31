'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { Link, usePathname, useRouter } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/utilisateurs — LE PARC DE COMPTES.
 *
 * Page de MENU : aucun bouton Retour (règle projet). Le Retour vit sur la
 * fiche, qui est la page de détail.
 *
 * Cet écran ne redit pas ce que disent Organisations et Experts : ceux-là sont
 * des files de VALIDATION, pilotées par le verification_status d'une entité
 * métier. Ici on décrit le COMPTE — identité, accès, session, rattachement —
 * pour une population plus large : un compte entreprise, un membre invité, un
 * administrateur ou un expert sans profil n'apparaissaient nulle part ailleurs.
 *
 * FILTRES DANS L'URL (`?type=`, `?status=`, `?domain_id=`, `?verification=`,
 * `?q=`, `?page=`) — même mécanisme que les onglets de « Mes annonces » et les
 * facettes de candidatures. Une recherche d'administration est partageable,
 * doit résister au rechargement, et le retour depuis une fiche doit ramener à
 * la MÊME page de résultats.
 *
 * PAGINATION RÉELLE. `total` est un count exact sur la requête filtrée : le
 * « 50 sur 1 248 » ne peut pas mentir, et il n'y a aucune troncature muette.
 */

type ApiUser = {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  user_type: string | null
  status: string | null
  email_verified: boolean
  phone_verified: boolean
  is_verified: boolean
  last_login_at: string | null
  created_at: string
  deletion_scheduled_at: string | null
  anonymized_at: string | null
  ecosystem: { id: string; name: string | null; slug: string | null } | null
  organization: {
    id: string
    company_name: string | null
    org_type: string | null
    role_in_org: string
  } | null
  profile_verification_status: string | null
}

type Payload = {
  users: ApiUser[]
  page: number
  per_page: number
  total: number
  has_more: boolean
}

type DomainOption = { id: string; name: string | null; slug: string | null }

const USER_TYPES = ['expert_freelance', 'expert_cdi', 'client', 'cabinet', 'admin'] as const
const STATUSES = ['draft', 'active', 'in_review', 'suspended', 'rejected', 'archived'] as const
const VERIFICATIONS = ['approved', 'pending_admin_review', 'rejected'] as const

const GRID = 'minmax(220px, 2.2fr) 130px 120px minmax(120px, 1fr) minmax(140px, 1.2fr) 140px'

/** Teinte du statut de compte. 'suspended' est le seul état d'alerte. */
function statusStyle(status: string | null): { bg: string; fg: string; dot: string } {
  switch (status) {
    case 'active':
      return { bg: '#DCFCE7', fg: '#166534', dot: '#16A34A' }
    case 'suspended':
      return { bg: '#FEE2E2', fg: '#991B1B', dot: '#DC2626' }
    case 'in_review':
      return { bg: '#FEF9C3', fg: '#854D0E', dot: '#CA8A04' }
    default:
      return { bg: '#f1f5f9', fg: '#475569', dot: '#94a3b8' }
  }
}

export default function AdminUsersListPage() {
  const t = useTranslations('admin_back_office.users')
  const tErr = useTranslations('admin_back_office.errors')
  const locale = useLocale()
  const secureFetch = useSecureFetch()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()

  const typeFilter = searchParams.get('type') ?? ''
  const statusFilter = searchParams.get('status') ?? ''
  const domainFilter = searchParams.get('domain_id') ?? ''
  const verificationFilter = searchParams.get('verification') ?? ''
  const q = searchParams.get('q') ?? ''
  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1)

  const [data, setData] = useState<Payload | null>(null)
  const [domains, setDomains] = useState<DomainOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Champ de recherche local : on n'écrit dans l'URL qu'à la validation, sinon
  // chaque frappe déclencherait une requête et une entrée d'historique.
  const [searchDraft, setSearchDraft] = useState(q)
  useEffect(() => { setSearchDraft(q) }, [q])

  /** Écrit les filtres dans l'URL. Tout changement de filtre revient page 1. */
  const setParams = useCallback(
    (next: Record<string, string | null>, opts?: { keepPage?: boolean }) => {
      const sp = new URLSearchParams(searchParams.toString())
      for (const [k, v] of Object.entries(next)) {
        if (v === null || v === '') sp.delete(k)
        else sp.set(k, v)
      }
      if (!opts?.keepPage) sp.delete('page')
      const qs = sp.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams()
      if (typeFilter) sp.set('type', typeFilter)
      if (statusFilter) sp.set('status', statusFilter)
      if (domainFilter) sp.set('domain_id', domainFilter)
      if (verificationFilter) sp.set('verification', verificationFilter)
      if (q) sp.set('q', q)
      sp.set('page', String(page))
      const res = await secureFetch(`/api/admin/list-users?${sp.toString()}`, { method: 'GET' })
      if (res.status === 403) { setError(tErr('forbidden')); return }
      if (!res.ok) { setError(tErr('generic')); return }
      setData((await res.json()) as Payload)
    } catch {
      setError(tErr('generic'))
    } finally {
      setLoading(false)
    }
  }, [secureFetch, tErr, typeFilter, statusFilter, domainFilter, verificationFilter, q, page])

  useEffect(() => { void load() }, [load])

  // Écosystèmes pour le filtre — JAMAIS de slug en dur (règle multi-écosystème).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await secureFetch('/api/admin/list-domains', { method: 'GET' })
        if (!res.ok) return
        const payload = (await res.json()) as { domains?: DomainOption[] }
        if (!cancelled) setDomains(payload.domains ?? [])
      } catch { /* le filtre écosystème reste simplement absent */ }
    })()
    return () => { cancelled = true }
  }, [secureFetch])

  const users = data?.users ?? []
  const total = data?.total ?? 0
  const hasFilters = !!(typeFilter || statusFilter || domainFilter || verificationFilter || q)

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }),
    [locale],
  )

  const selectStyle: React.CSSProperties = {
    padding: '8px 10px',
    borderRadius: 9,
    border: '1px solid var(--color-border-tertiary, #e5e7eb)',
    background: 'var(--color-background-primary, #fff)',
    color: 'var(--color-text-primary, #0f172a)',
    fontSize: 13,
    fontFamily: 'inherit',
  }

  return (
    <div style={{ padding: '24px 26px 40px', fontFamily: 'inherit' }}>
      <style>{`
        .sk-users-row:hover { background: var(--color-background-secondary, #f8fafc); }
        @media (max-width: 900px) {
          /* Mobile-first : le tableau devient une pile de cartes lisibles. */
          .sk-users-head { display: none !important; }
          .sk-users-row {
            grid-template-columns: 1fr !important;
            min-width: 0 !important;
            gap: 6px !important;
            padding: 14px 16px !important;
          }
          .sk-users-meta { display: flex !important; flex-wrap: wrap; gap: 8px; }
        }
      `}</style>

      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary, #0f172a)', margin: 0, letterSpacing: '-0.2px' }}>
          {t('title')}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', margin: '4px 0 0', lineHeight: 1.55 }}>
          {t('subtitle')}
        </p>
      </header>

      {/* ── Recherche + filtres ─────────────────────────────────────────── */}
      <form
        onSubmit={(e) => { e.preventDefault(); setParams({ q: searchDraft.trim() || null }) }}
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}
      >
        <input
          type="search"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder={t('search_placeholder')}
          aria-label={t('search_placeholder')}
          style={{ ...selectStyle, flex: '1 1 260px', minWidth: 200 }}
        />
        <select aria-label={t('filter_type')} value={typeFilter} onChange={(e) => setParams({ type: e.target.value || null })} style={selectStyle}>
          <option value="">{t('filter_type')} · {t('filter_all')}</option>
          {USER_TYPES.map((v) => (
            <option key={v} value={v}>{t(`type_${v}` as 'type_admin')}</option>
          ))}
        </select>
        <select aria-label={t('filter_status')} value={statusFilter} onChange={(e) => setParams({ status: e.target.value || null })} style={selectStyle}>
          <option value="">{t('filter_status')} · {t('filter_all')}</option>
          {STATUSES.map((v) => (
            <option key={v} value={v}>{t(`status_${v}` as 'status_active')}</option>
          ))}
        </select>
        {domains.length > 0 && (
          <select aria-label={t('filter_ecosystem')} value={domainFilter} onChange={(e) => setParams({ domain_id: e.target.value || null })} style={selectStyle}>
            <option value="">{t('filter_ecosystem')} · {t('filter_all')}</option>
            {domains.map((d) => (
              <option key={d.id} value={d.id}>{d.name ?? d.slug ?? d.id}</option>
            ))}
          </select>
        )}
        <select aria-label={t('filter_verification')} value={verificationFilter} onChange={(e) => setParams({ verification: e.target.value || null })} style={selectStyle}>
          <option value="">{t('filter_verification')} · {t('filter_all')}</option>
          {VERIFICATIONS.map((v) => (
            <option key={v} value={v}>{t(`verif_${v}` as 'verif_approved')}</option>
          ))}
        </select>
        {hasFilters && (
          <button
            type="button"
            onClick={() => setParams({ type: null, status: null, domain_id: null, verification: null, q: null })}
            style={{ ...selectStyle, cursor: 'pointer', fontWeight: 600, color: 'var(--color-text-secondary, #64748b)' }}
          >
            {t('filter_reset')}
          </button>
        )}
      </form>

      {/* Compteur : décrit la requête FILTRÉE, jamais la table entière. */}
      <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary, #64748b)', marginBottom: 10 }}>
        {loading ? t('loading') : t('count_total', { count: total })}
      </div>

      {error ? (
        <div role="alert" style={{ padding: '28px 20px', textAlign: 'center', background: '#FEE2E2', color: '#991B1B', borderRadius: 12, fontSize: 14 }}>
          {error}
        </div>
      ) : !loading && users.length === 0 ? (
        <div style={{ padding: '48px 24px', textAlign: 'center', background: 'var(--color-background-primary, #fff)', border: '0.5px solid var(--color-border-tertiary, #e5e7eb)', borderRadius: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary, #0f172a)', marginBottom: 6 }}>{t('empty_title')}</div>
          <div style={{ fontSize: 13.5, color: 'var(--color-text-secondary, #64748b)' }}>{t('empty_body')}</div>
        </div>
      ) : (
        <div style={{ background: 'var(--color-background-primary, #fff)', border: '0.5px solid var(--color-border-tertiary, #e5e7eb)', borderRadius: 12, overflowX: 'auto' }}>
          <div
            className="sk-users-head"
            style={{
              display: 'grid', gridTemplateColumns: GRID, minWidth: 880,
              padding: '10px 18px', borderBottom: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
              background: 'var(--color-background-secondary, #f8fafc)', fontSize: 11, fontWeight: 500,
              color: 'var(--color-text-secondary, #64748b)', textTransform: 'uppercase', letterSpacing: '.05em',
            }}
          >
            <span>{t('col_user')}</span>
            <span>{t('col_type')}</span>
            <span>{t('col_status')}</span>
            <span>{t('col_ecosystem')}</span>
            <span>{t('col_organization')}</span>
            <span>{t('col_last_login')}</span>
          </div>

          {users.map((u) => {
            const st = statusStyle(u.status)
            const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
            return (
              <Link
                key={u.id}
                href={`/admin/utilisateurs/${u.id}`}
                className="sk-users-row"
                style={{
                  display: 'grid', gridTemplateColumns: GRID, minWidth: 880,
                  padding: '13px 18px', borderBottom: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
                  textDecoration: 'none', color: 'var(--color-text-primary, #0f172a)',
                  fontSize: 13, alignItems: 'center', transition: 'background .12s',
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {fullName || '—'}
                  </span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-secondary, #64748b)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.email ?? '—'}
                  </span>
                </span>
                <span className="sk-users-meta" style={{ fontSize: 12.5, color: 'var(--color-text-secondary, #475569)' }}>
                  {u.user_type ? t(`type_${u.user_type}` as 'type_admin') : '—'}
                </span>
                <span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 12, background: st.bg, color: st.fg, fontSize: 11, fontWeight: 600 }}>
                    <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: st.dot }} />
                    {u.status ? t(`status_${u.status}` as 'status_active') : '—'}
                  </span>
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary, #475569)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.ecosystem?.name ?? u.ecosystem?.slug ?? '—'}
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary, #475569)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.organization
                    ? `${u.organization.company_name ?? '—'} (${t(`role_${u.organization.role_in_org}` as 'role_admin')})`
                    : t('no_organization')}
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary, #64748b)' }}>
                  {u.last_login_at ? dateFmt.format(new Date(u.last_login_at)) : t('never_logged_in')}
                </span>
              </Link>
            )
          })}
        </div>
      )}

      {/* ── Pagination : « X sur Y » exact, jamais de troncature muette ─── */}
      {!error && total > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary, #64748b)' }}>
            {t('showing', { shown: users.length, total })} · {t('page_of', { page })}
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setParams({ page: String(page - 1) }, { keepPage: true })}
              style={{ ...selectStyle, cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.45 : 1, fontWeight: 600 }}
            >
              {t('prev')}
            </button>
            <button
              type="button"
              disabled={!data?.has_more || loading}
              onClick={() => setParams({ page: String(page + 1) }, { keepPage: true })}
              style={{ ...selectStyle, cursor: !data?.has_more ? 'not-allowed' : 'pointer', opacity: !data?.has_more ? 0.45 : 1, fontWeight: 600 }}
            >
              {t('next')}
            </button>
          </span>
        </div>
      )}
    </div>
  )
}
