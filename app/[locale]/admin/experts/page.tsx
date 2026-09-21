'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'
import ImageOuRepli from '@/components/ui/ImageOuRepli'

/**
 * /admin/experts — liste des profils experts à valider (mirror B5).
 *
 * 4 onglets : En attente · Approuvés · Refusés · Tous.
 * Source : GET /api/admin/list-experts?status=<filter>.
 */

type TabKey = 'pending' | 'approved' | 'rejected' | 'all'

type ExpertRow = {
  id: string
  user_id: string
  expert_type: string | null
  title: string | null
  seniority: string | null
  years_experience: number | null
  verification_status: string | null
  verification_score: number | null
  verified_at: string | null
  verified_by: string | null
  review_reason: string | null
  created_at: string
  updated_at: string
  photo_url: string | null
  /** D1 : nom de l'écosystème (domaine) de l'expert, pour l'admin plateforme. */
  ecosystem: string | null
  users: { id: string; email: string; first_name: string | null; last_name: string | null; locale: string | null; user_type: string | null } | { id: string; email: string; first_name: string | null; last_name: string | null; locale: string | null; user_type: string | null }[] | null
}

function pickRel<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function scoreColor(score: number | null | undefined): string {
  if (score == null) return 'var(--sk-muted)'
  if (score < 5) return 'var(--sk-red)'
  if (score < 9) return 'var(--sk-amber)'
  return 'var(--sk-success)'
}

function initials(first: string | null | undefined, last: string | null | undefined, email: string | null | undefined): string {
  const a = (first ?? '').trim()
  const b = (last ?? '').trim()
  if (a || b) return `${a[0] ?? ''}${b[0] ?? ''}`.toUpperCase()
  if (email) return email.slice(0, 2).toUpperCase()
  return '??'
}

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return iso }
}

export default function AdminExpertsListPage() {
  const t = useTranslations('admin_back_office.experts')
  const tAdmin = useTranslations('admin_back_office')
  // Message de troncature MUTUALISÉ avec l'écran Utilisateurs : même plafond,
  // même phrase — on ne duplique pas une chaîne en quatre langues.
  const tUsers = useTranslations('admin_back_office.users')
  const locale = useLocale()
  const secureFetch = useSecureFetch()
  const [tab, setTab] = useState<TabKey>('pending')
  const [counts, setCounts] = useState<Record<TabKey, number | null>>({ pending: null, approved: null, rejected: null, all: null })
  const [rows, setRows] = useState<ExpertRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Non-null ⇒ la liste est coupée : on l'annonce, on ne la subit pas. */
  const [truncation, setTruncation] = useState<{ total: number; limit: number } | null>(null)

  const load = useCallback(async (filter: TabKey) => {
    setRows(null)
    setError(null)
    try {
      const res = await secureFetch(`/api/admin/list-experts?status=${filter}`, { method: 'GET' })
      if (!res.ok) {
        setError(t('error_load'))
        return
      }
      const payload = (await res.json()) as {
        experts: ExpertRow[]
        total?: number
        truncated?: boolean
        limit?: number
      }
      setRows(payload.experts ?? [])
      // Le plafond de 500 lignes était SILENCIEUX : au-delà, la liste
      // s'arrêtait sans le dire. On le rend visible plutôt que de le subir.
      setTruncation(
        payload.truncated
          ? { total: payload.total ?? 0, limit: payload.limit ?? (payload.experts ?? []).length }
          : null,
      )
    } catch (err) {
      console.error('[admin/experts] load threw', err)
      setError(t('error_load'))
    }
  }, [secureFetch, t])

  // Compteurs exacts des 4 onglets (count BDD par verification_status),
  // indépendants de l'onglet actif — fetchés une fois au montage.
  const loadCounts = useCallback(async () => {
    try {
      const res = await secureFetch('/api/admin/list-experts?counts=1', { method: 'GET' })
      if (!res.ok) return
      const payload = (await res.json()) as { counts: Record<TabKey, number> }
      if (payload.counts) setCounts(payload.counts)
    } catch (err) {
      console.error('[admin/experts] loadCounts threw', err)
    }
  }, [secureFetch])

  useEffect(() => { void load(tab) }, [tab, load])
  useEffect(() => { void loadCounts() }, [loadCounts])

  const tabs: Array<{ key: TabKey; label: string; dot: string }> = useMemo(() => [
    { key: 'pending', label: t('tab_pending'), dot: 'var(--sk-amber)' },
    { key: 'approved', label: t('tab_approved'), dot: 'var(--sk-success)' },
    { key: 'rejected', label: t('tab_rejected'), dot: 'var(--sk-red)' },
    { key: 'all', label: t('tab_all'), dot: 'var(--sk-muted)' },
  ], [t])

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--sk-text)', marginBottom: 6 }}>{t('page_title')}</h1>
      <p style={{ fontSize: 13, color: 'var(--sk-muted)', marginBottom: 22 }}>{t('page_subtitle')}</p>

      {/* Bandeau de troncature — le plafond ne doit jamais être muet. */}
      {truncation && (
        <div
          role="status"
          style={{
            marginBottom: 16, padding: '11px 15px', borderRadius: 10,
            background: 'var(--sk-amber-soft)', border: '1px solid var(--sk-amber-soft)', color: 'var(--sk-amber)',
            fontSize: 12.5, lineHeight: 1.55,
          }}
        >
          {tUsers('truncated_notice', { limit: truncation.limit, total: truncation.total })}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--sk-border)', marginBottom: 18, flexWrap: 'wrap' }}>
        {tabs.map((tabDef) => {
          const active = tab === tabDef.key
          const count = counts[tabDef.key]
          return (
            <button
              key={tabDef.key}
              type="button"
              onClick={() => setTab(tabDef.key)}
              style={{
                padding: '10px 14px', background: 'transparent', border: 'none',
                borderBottom: active ? '2px solid var(--sk-text)' : '2px solid transparent',
                color: active ? 'var(--sk-text)' : 'var(--sk-muted)',
                fontSize: 13, fontWeight: active ? 600 : 500, cursor: 'pointer',
                fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6,
                marginBottom: -1,
              }}
            >
              <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: tabDef.dot }} />
              {tabDef.label}{count !== null ? ` (${count})` : ''}
            </button>
          )
        })}
      </div>

      {error && (
        <div role="alert" style={{ background: 'var(--sk-red-soft)', border: '1px solid var(--sk-red-soft)', color: 'var(--sk-red)', padding: '12px 16px', borderRadius: 10, fontSize: 13 }}>{error}</div>
      )}

      {rows === null && !error && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--sk-muted)', fontSize: 14 }}>{t('loading')}</div>
      )}

      {rows !== null && rows.length === 0 && (
        <div style={{ background: 'var(--sk-surface)', border: '0.5px solid var(--sk-border)', borderRadius: 14, padding: '40px 24px', textAlign: 'center', color: 'var(--sk-muted)', fontSize: 14 }}>
          {t('empty')}
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div style={{ background: 'var(--sk-surface)', border: '0.5px solid var(--sk-border)', borderRadius: 14, overflowX: 'auto' }}>
          {rows.map((r, i) => {
            const u = pickRel(r.users)
            const name = [u?.first_name, u?.last_name].filter(Boolean).join(' ').trim()
            return (
              <Link
                key={r.id}
                href={`/admin/experts/${r.id}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '44px 1fr 100px 90px 120px',
                  minWidth: 560,
                  gap: 14,
                  alignItems: 'center',
                  padding: '14px 18px',
                  borderTop: i === 0 ? 'none' : '0.5px solid var(--sk-border)',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                {/* `r.photo_url` est ici une URL SIGNÉE (la route appelle
                    signAvatarUrl), pas la colonne. Elle vit 300 s : passé ce
                    délai l'image échoue, ce qui est normal et doit retomber sur
                    les initiales — jamais sur l'icône d'image cassée. */}
                <ImageOuRepli
                  src={r.photo_url}
                  alt=""
                  style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }}
                  repli={
                    <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--sk-surface-2)', color: 'var(--sk-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700 }}>
                      {initials(u?.first_name, u?.last_name, u?.email)}
                    </div>
                  }
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--sk-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name || u?.email || '—'}
                    </span>
                    {/* D1 : écosystème de l'expert (admin plateforme multi-écosystème). */}
                    {r.ecosystem && (
                      <span title={tAdmin('ecosystem_label')} style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: 'var(--sk-accent)', background: 'var(--sk-accent-soft)', border: '0.5px solid var(--sk-accent-soft)', borderRadius: 6, padding: '1px 7px', whiteSpace: 'nowrap' }}>
                        {r.ecosystem}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--sk-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                    {[r.title, r.seniority, r.years_experience != null ? `${r.years_experience} an(s)` : null].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--sk-muted)', textAlign: 'right' }}>
                  {r.expert_type === 'expert_cdi' ? 'CDI' : 'Freelance'}
                </div>
                <div style={{ textAlign: 'right' }}>
                  {r.verification_score != null && (
                    <span style={{ display: 'inline-block', padding: '3px 9px', background: `color-mix(in srgb, ${scoreColor(r.verification_score)} 10%, transparent)`, color: scoreColor(r.verification_score), fontSize: 11, fontWeight: 700, borderRadius: 10 }}>
                      {Math.round(r.verification_score)}/10
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--sk-muted)', textAlign: 'right' }}>
                  {r.verification_status === 'approved' || r.verification_status === 'rejected'
                    ? formatDate(r.verified_at, locale)
                    : formatDate(r.updated_at, locale)}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
