'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'
import { summarizeLimitParts } from '@/lib/packages-display'

/**
 * /admin/collaboration — ESPACE COMMERCE de la collaboration entre experts.
 *
 * Deux sections, une seule page :
 *   1. OFFRES — les packages de cible 'collaboration' : limites, statut, offre
 *      par défaut (transfert inline), création, édition.
 *   2. EXPERTS RATTACHÉS — chaque organisation PERSONNELLE d'expert, nommée par
 *      SON EXPERT, avec son offre effective et sa consommation réelle.
 *
 * ┌─ POURQUOI CET ÉCRAN EXISTE ─────────────────────────────────────────────┐
 * │ Les organisations personnelles sont volontairement absentes de           │
 * │ /admin/organisations (ce ne sont pas des entreprises à vérifier). Sans   │
 * │ cet écran, l'admin ne pouvait NI voir qui utilise la collaboration, NI   │
 * │ détecter qu'un expert était retombé sur une offre entreprise. Un état    │
 * │ qu'on ne peut pas voir est un état qu'on rediagnostique à l'aveugle.     │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * PAS DE SECOND MOTEUR D'ÉDITION : « Modifier » ouvre la fiche partagée
 * /admin/packages/[id] (dont le bouton Retour revient ici, dérivé de
 * target_role) et « Nouvelle offre » ouvre /admin/packages/new?target=
 * collaboration. Le catalogue n'a qu'un seul formulaire, pour toutes les cibles.
 *
 * DEUX COMPTEURS, SYSTÉMATIQUEMENT : publications du mois (compteur consommable
 * usage_counters) ET annonces actives à l'instant T (comptées à la lecture,
 * règle 30 j — aucun batch, aucun cron). Le second est le blocage réellement
 * ressenti par l'expert ; l'afficher n'est pas optionnel.
 *
 * Page de MENU → aucun bouton Retour.
 */

type Feature = { feature_code: string; value: string; reset_period: string | null }
type Package = {
  id: string
  name: string
  slug: string
  target_role: string
  price_monthly: number | null
  currency: string
  is_default: boolean
  active: boolean
  features: Feature[]
  org_count: number
}

/** État de rattachement d'un expert — dérivé côté serveur, jamais deviné ici. */
type ExpertState = 'linked' | 'fallback' | 'foreign' | 'none'

type ExpertRow = {
  organization_id: string
  user_id: string | null
  full_name: string | null
  email: string | null
  ecosystem: string | null
  created_at: string
  package: { id: string; name: string; slug: string; target_role: string } | null
  state: ExpertState
  expired_at: string | null
  valid_until: string | null
  usage: { publications: number; active_published: number }
  limits: { publicationsPerMonth: number | null; activePublicationsMax: number | null }
}

const ALL = ''

export default function AdminCollaborationPage() {
  const t = useTranslations('admin_back_office')
  const locale = useLocale()
  const secureFetch = useSecureFetch()

  const [packages, setPackages] = useState<Package[] | null>(null)
  const [experts, setExperts] = useState<ExpertRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Transfert du défaut : confirmation inline, envoi, message.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [settingId, setSettingId] = useState<string | null>(null)
  const [defaultError, setDefaultError] = useState<string | null>(null)
  const [defaultDone, setDefaultDone] = useState<string | null>(null)

  // Filtre de la liste d'experts par offre effective.
  const [filterPkg, setFilterPkg] = useState<string>(ALL)

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      setError(null)
      try {
        const [pkgRes, expRes] = await Promise.all([
          secureFetch('/api/admin/list-packages', { method: 'GET' }),
          secureFetch('/api/admin/collaboration-orgs', { method: 'GET' }),
        ])
        if (pkgRes.status === 403 || expRes.status === 403) {
          setError(t('errors.forbidden'))
          return
        }
        if (!pkgRes.ok || !expRes.ok) {
          setError(t('errors.generic'))
          return
        }
        const pkgJson = (await pkgRes.json()) as { packages: Package[] }
        const expJson = (await expRes.json()) as { experts: ExpertRow[] }
        setPackages((pkgJson.packages ?? []).filter((p) => p.target_role === 'collaboration'))
        setExperts(expJson.experts ?? [])
      } catch {
        setError(t('errors.generic'))
      } finally {
        setLoading(false)
      }
    },
    [t, secureFetch],
  )

  useEffect(() => {
    void load()
  }, [load])

  // ── Dérivations ────────────────────────────────────────────────────────────
  const anomalies = useMemo(
    () => experts.filter((e) => e.state === 'foreign' || e.state === 'none'),
    [experts],
  )

  const visibleExperts = useMemo(
    () => (filterPkg === ALL ? experts : experts.filter((e) => e.package?.id === filterPkg)),
    [experts, filterPkg],
  )

  /** Nombre d'experts dont l'offre EFFECTIVE est celle-ci (repli compris). */
  function effectiveCount(packageId: string): number {
    return experts.filter((e) => e.package?.id === packageId).length
  }

  function formatPrice(p: Package): string {
    if (p.price_monthly == null || p.price_monthly === 0) return t('packages.price_free')
    return t('packages.price_monthly_format', { price: p.price_monthly, currency: p.currency })
  }

  /** Résumé court des limites — ordre et parsing partagés (packages-display). */
  function summarizeLimits(features: Feature[]): string {
    const { parts, anyUnlimited } = summarizeLimitParts(features)
    if (parts.length === 0) return t('packages.summary_all_unlimited')
    const labels = parts.map((p) => t(`packages.${p.summaryKey}`, { count: p.count }))
    if (anyUnlimited) labels.push(t('packages.summary_rest_unlimited'))
    return labels.join(' · ')
  }

  /** « 1 / 3 » ou « 1 / illimité ». Jamais de chiffre inventé. */
  function fmtCount(used: number, limit: number | null): string {
    return limit == null ? t('collaboration.count_unlimited', { used }) : `${used} / ${limit}`
  }

  function fmtDate(iso: string | null): string {
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

  /** Nom affiché d'un expert : prénom nom, sinon e-mail. Jamais le nom d'org. */
  function expertName(e: ExpertRow): string {
    return e.full_name ?? e.email ?? t('collaboration.expert_unnamed')
  }

  // ── Transfert du défaut (invariant appliqué côté serveur) ──────────────────
  async function setDefault(p: Package) {
    setSettingId(p.id)
    setDefaultError(null)
    setDefaultDone(null)
    try {
      const res = await secureFetch('/api/admin/set-default-package', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ package_id: p.id }),
      })
      const payload = (await res.json().catch(() => ({}))) as { code?: string }
      if (!res.ok) {
        if (payload.code === 'already_default') setDefaultError(t('packages.err_already_default'))
        else if (payload.code === 'package_inactive')
          setDefaultError(t('packages.err_package_inactive'))
        else if (payload.code === 'target_uncovered')
          setDefaultError(t('packages.err_target_uncovered', { targets: t('packages.target_collaboration') }))
        else if (res.status === 403) setDefaultError(t('errors.forbidden'))
        else setDefaultError(t('errors.generic'))
        return
      }
      setConfirmingId(null)
      setDefaultDone(t('packages.default_set'))
      await load(true)
    } catch {
      setDefaultError(t('errors.generic'))
    } finally {
      setSettingId(null)
    }
  }

  // ── Styles (pattern listes admin) ──────────────────────────────────────────
  const cardStyle: React.CSSProperties = {
    background: 'var(--color-background-primary, #fff)',
    border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
    borderRadius: 12,
    overflowX: 'auto',
  }
  const sectionTitle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 500,
    textTransform: 'uppercase',
    letterSpacing: '.08em',
    color: 'var(--color-text-secondary, #64748b)',
    margin: '28px 0 12px',
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
  const emptyStyle: React.CSSProperties = {
    background: 'var(--color-background-primary, #fff)',
    border: '0.5px dashed var(--color-border-tertiary, #e5e7eb)',
    borderRadius: 12,
    padding: '32px 24px',
    fontSize: 13,
    color: 'var(--color-text-secondary, #64748b)',
  }
  const badge = (bg: string, fg: string): React.CSSProperties => ({
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 10,
    background: bg,
    color: fg,
    whiteSpace: 'nowrap',
  })

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 14 }}>
        {t('loading')}
      </div>
    )
  }

  if (error) {
    return (
      <div
        role="alert"
        style={{ padding: 16, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 13, borderRadius: 10 }}
      >
        {error}
      </div>
    )
  }

  const pkgs = packages ?? []

  return (
    <div>
      {/* Empilement en cartes sur mobile : la table reste lisible sans scroll
          horizontal, chaque cellule reprend son intitulé via data-label. */}
      <style>{`
        @media (max-width: 767px) {
          .sk-collab-table, .sk-collab-table tbody, .sk-collab-table tr, .sk-collab-table td {
            display: block; width: 100%;
          }
          .sk-collab-table thead { display: none; }
          .sk-collab-table tr {
            border-top: 0.5px solid var(--color-border-tertiary, #e5e7eb);
            padding: 6px 0;
          }
          .sk-collab-table td {
            border-top: none;
            padding: 5px 14px;
            display: flex;
            justify-content: space-between;
            gap: 14px;
            align-items: baseline;
          }
          .sk-collab-table td::before {
            content: attr(data-label);
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: .06em;
            color: var(--color-text-tertiary, #94a3b8);
            flex: 0 0 auto;
          }
          .sk-collab-table td[data-label=""]::before { content: none; }
          .sk-collab-min { min-width: 0 !important; }
        }
      `}</style>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 4,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 500, color: 'var(--color-text-primary, #0f172a)', margin: '0 0 4px' }}>
            {t('collaboration.page_title')}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', margin: 0 }}>
            {t('collaboration.subtitle')}
          </p>
        </div>
        <Link
          href="/admin/packages/new?target=collaboration"
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
          {t('collaboration.action_new_offer')}
        </Link>
      </div>

      {/* ── ANOMALIES ────────────────────────────────────────────────────────
          Un expert ne doit JAMAIS hériter d'une offre entreprise. Si le
          rattachement saute, le repli se fait sur l'offre de collaboration par
          défaut ; tout autre cas est signalé ici, en tête d'écran. */}
      {anomalies.length > 0 && (
        <div
          role="alert"
          style={{
            marginTop: 16,
            padding: '12px 16px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 10,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 500, color: '#b91c1c', marginBottom: 3 }}>
            {t('collaboration.anomaly_title', { count: anomalies.length })}
          </div>
          <div style={{ fontSize: 12.5, color: '#b91c1c', lineHeight: 1.5 }}>
            {t('collaboration.anomaly_body')}
          </div>
        </div>
      )}

      {defaultDone && (
        <div style={{ marginTop: 16, padding: '9px 14px', background: '#DCFCE7', border: '1px solid #bbf7d0', color: '#166534', fontSize: 13, borderRadius: 10 }}>
          {defaultDone}
        </div>
      )}
      {defaultError && confirmingId === null && (
        <div role="alert" style={{ marginTop: 16, padding: '9px 14px', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 13, borderRadius: 10 }}>
          {defaultError}
        </div>
      )}

      {/* ── SECTION 1 — OFFRES ─────────────────────────────────────────────── */}
      <h2 style={sectionTitle}>{t('collaboration.section_offers')}</h2>

      {pkgs.length === 0 ? (
        <div style={emptyStyle}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary, #0f172a)', marginBottom: 6 }}>
            {t('collaboration.offers_empty_title')}
          </div>
          <div style={{ marginBottom: 16, lineHeight: 1.6 }}>{t('collaboration.offers_empty_body')}</div>
          <Link
            href="/admin/packages/new?target=collaboration"
            style={{ display: 'inline-block', padding: '9px 16px', background: '#00B9FF', color: '#fff', borderRadius: 10, fontSize: 13, fontWeight: 500, textDecoration: 'none' }}
          >
            {t('collaboration.action_new_offer')}
          </Link>
        </div>
      ) : (
        <div style={cardStyle}>
          <table className="sk-collab-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr>
                <th style={thStyle}>{t('packages.col_offer')}</th>
                <th style={thStyle}>{t('packages.col_price')}</th>
                <th style={thStyle}>{t('packages.col_status')}</th>
                <th style={thStyle}>{t('collaboration.col_experts')}</th>
                <th style={thStyle}>{t('packages.col_limits')}</th>
                <th style={thStyle} aria-label={t('packages.action_edit')} />
              </tr>
            </thead>
            <tbody>
              {pkgs.map((p) => {
                const canSetDefault = p.active && !p.is_default
                const previous = pkgs.find((x) => x.is_default && x.id !== p.id) ?? null
                return (
                  <Fragment key={p.id}>
                    <tr>
                      <td style={tdStyle} data-label={t('packages.col_offer')}>
                        <span style={{ display: 'block', fontWeight: 500 }}>{p.name}</span>
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-tertiary, #94a3b8)', marginTop: 2 }}>
                          {p.slug}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }} data-label={t('packages.col_price')}>
                        {formatPrice(p)}
                      </td>
                      <td style={tdStyle} data-label={t('packages.col_status')}>
                        <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                          <span style={badge(p.active ? '#DCFCE7' : '#F1F5F9', p.active ? '#166534' : '#64748b')}>
                            {p.active ? t('packages.active_yes') : t('packages.active_no')}
                          </span>
                          {p.is_default && (
                            <span style={badge('#DBEAFE', '#1e40af')}>{t('packages.default_badge')}</span>
                          )}
                        </span>
                      </td>
                      {/* Experts dont l'offre EFFECTIVE est celle-ci : inclut
                          les replis, donc plus fidèle que le simple compte des
                          rattachements explicites. */}
                      <td style={{ ...tdStyle, color: 'var(--color-text-secondary, #64748b)', whiteSpace: 'nowrap' }} data-label={t('collaboration.col_experts')}>
                        {t('collaboration.experts_count', { count: effectiveCount(p.id) })}
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--color-text-secondary, #64748b)', minWidth: 240 }} className="sk-collab-min" data-label={t('packages.col_limits')}>
                        {summarizeLimits(p.features)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }} data-label="">
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 14 }}>
                          {canSetDefault && confirmingId !== p.id && (
                            <button
                              type="button"
                              onClick={() => {
                                setDefaultError(null)
                                setDefaultDone(null)
                                setConfirmingId(p.id)
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                fontSize: 12,
                                fontFamily: 'inherit',
                                color: 'var(--color-text-secondary, #64748b)',
                                textDecoration: 'underline',
                                textUnderlineOffset: 3,
                                cursor: 'pointer',
                              }}
                            >
                              {t('packages.action_set_default')}
                            </button>
                          )}
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
                        </span>
                      </td>
                    </tr>

                    {/* Confirmation inline : impact explicite avant transfert. */}
                    {confirmingId === p.id && (
                      <tr>
                        <td colSpan={6} style={{ padding: '0 14px 14px', background: 'var(--color-background-secondary, #f8fafc)' }} data-label="">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingTop: 12 }}>
                            <span style={{ fontSize: 13, color: 'var(--color-text-primary, #0f172a)' }}>
                              {previous
                                ? t('packages.confirm_set_default', {
                                    target: t('packages.target_collaboration'),
                                    previous: previous.name,
                                  })
                                : t('packages.confirm_set_default_none', {
                                    target: t('packages.target_collaboration'),
                                  })}
                            </span>
                            <button
                              type="button"
                              onClick={() => void setDefault(p)}
                              disabled={settingId === p.id}
                              style={{ padding: '8px 14px', background: '#00B9FF', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 500, fontFamily: 'inherit', cursor: settingId === p.id ? 'not-allowed' : 'pointer', opacity: settingId === p.id ? 0.6 : 1 }}
                            >
                              {settingId === p.id ? t('loading') : t('packages.confirm_yes')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingId(null)}
                              disabled={settingId === p.id}
                              style={{ padding: '8px 14px', background: 'transparent', color: 'var(--color-text-secondary, #64748b)', border: '0.5px solid var(--color-border-tertiary, #e5e7eb)', borderRadius: 8, fontSize: 12, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer' }}
                            >
                              {t('packages.confirm_cancel')}
                            </button>
                          </div>
                          {defaultError && (
                            <div role="alert" style={{ marginTop: 10, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, borderRadius: 8 }}>
                              {defaultError}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── SECTION 2 — EXPERTS RATTACHÉS ──────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <h2 style={sectionTitle}>{t('collaboration.section_experts')}</h2>
        {experts.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label htmlFor="filter_pkg" style={{ fontSize: 12, color: 'var(--color-text-secondary, #64748b)' }}>
              {t('collaboration.filter_offer')}
            </label>
            <select
              id="filter_pkg"
              value={filterPkg}
              onChange={(e) => setFilterPkg(e.target.value)}
              style={{ padding: '7px 10px', fontSize: 13, border: '0.5px solid var(--color-border-tertiary, #e5e7eb)', borderRadius: 8, outline: 'none', fontFamily: 'inherit', background: 'var(--color-background-primary, #fff)', color: 'var(--color-text-primary, #0f172a)' }}
            >
              <option value={ALL}>{t('collaboration.filter_all')}</option>
              {pkgs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 12, color: 'var(--color-text-tertiary, #94a3b8)' }}>
              {t('collaboration.experts_count', { count: visibleExperts.length })}
            </span>
          </div>
        )}
      </div>

      {experts.length === 0 ? (
        <div style={emptyStyle}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary, #0f172a)', marginBottom: 6 }}>
            {t('collaboration.experts_empty_title')}
          </div>
          <div style={{ lineHeight: 1.6 }}>{t('collaboration.experts_empty_body')}</div>
        </div>
      ) : visibleExperts.length === 0 ? (
        <div style={emptyStyle}>{t('collaboration.experts_filtered_empty')}</div>
      ) : (
        <div style={cardStyle}>
          <table className="sk-collab-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr>
                <th style={thStyle}>{t('collaboration.col_expert')}</th>
                <th style={thStyle}>{t('ecosystem_label')}</th>
                <th style={thStyle}>{t('collaboration.col_effective_offer')}</th>
                <th style={thStyle}>{t('collaboration.col_publications')}</th>
                <th style={thStyle}>{t('collaboration.col_active')}</th>
              </tr>
            </thead>
            <tbody>
              {visibleExperts.map((e) => (
                <tr key={e.organization_id}>
                  <td style={tdStyle} data-label={t('collaboration.col_expert')}>
                    <span style={{ display: 'block', fontWeight: 500 }}>{expertName(e)}</span>
                    {e.email && e.full_name && (
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-tertiary, #94a3b8)', marginTop: 2 }}>
                        {e.email}
                      </span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--color-text-secondary, #64748b)' }} data-label={t('ecosystem_label')}>
                    {e.ecosystem ?? '—'}
                  </td>
                  {/* Offre effective + état de rattachement. Le repli est
                      signalé, l'offre entreprise est signalée en ROUGE. */}
                  <td style={tdStyle} data-label={t('collaboration.col_effective_offer')}>
                    <span style={{ display: 'block' }}>{e.package?.name ?? '—'}</span>
                    {e.state === 'linked' && e.valid_until && (
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-tertiary, #94a3b8)', marginTop: 2 }}>
                        {t('collaboration.valid_until', { date: fmtDate(e.valid_until) })}
                      </span>
                    )}
                    {e.state === 'fallback' && (
                      <span style={{ ...badge('#FEF3C7', '#92400e'), display: 'inline-block', marginTop: 4 }}>
                        {e.expired_at
                          ? t('collaboration.state_expired', { date: fmtDate(e.expired_at) })
                          : t('collaboration.state_fallback')}
                      </span>
                    )}
                    {e.state === 'foreign' && (
                      <span style={{ ...badge('#FEE2E2', '#b91c1c'), display: 'inline-block', marginTop: 4 }}>
                        {t('collaboration.state_foreign')}
                      </span>
                    )}
                    {e.state === 'none' && (
                      <span style={{ ...badge('#FEE2E2', '#b91c1c'), display: 'inline-block', marginTop: 4 }}>
                        {t('collaboration.state_none')}
                      </span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }} data-label={t('collaboration.col_publications')}>
                    {fmtCount(e.usage.publications, e.limits.publicationsPerMonth)}
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }} data-label={t('collaboration.col_active')}>
                    {fmtCount(e.usage.active_published, e.limits.activePublicationsMax)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
