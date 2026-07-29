'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch } from '@/lib/secure-fetch'
import type { Annonce } from '@/types/annonce'

/**
 * SousTraitanceListView — « Mes besoins de sous-traitance » (page de MENU, pas
 * de bouton Retour). Miroir SOBRE de la liste d'annonces org, réutilisant les
 * routes existantes SANS dupliquer de logique métier :
 *   - GET /api/publications            → besoins de l'org perso (filtre type)
 *   - GET /api/me/collaboration/quota  → plafond d'actives (bouton Publier)
 *   - POST /api/me/collaboration/ensure-org → création lazy de l'org perso
 *
 * `basePath` = '/dashboard/freelance' | '/dashboard/cdi'.
 */

type Phase = 'loading' | 'ready' | 'org_error'
type Quota = { activePublicationsMax: number | null; activePublishedCount: number; canPublish: boolean }

export default function SousTraitanceListView({ basePath }: { basePath: string }) {
  const t = useTranslations('collaboration.list')
  const tPub = useTranslations('publications')
  const locale = useLocale()
  const domain = useDomain()
  const secureFetch = useSecureFetch()

  const [phase, setPhase] = useState<Phase>('loading')
  const [needs, setNeeds] = useState<Annonce[]>([])
  const [quota, setQuota] = useState<Quota | null>(null)

  const load = useCallback(async () => {
    setPhase('loading')
    try {
      // 1. Org perso garantie (idempotent) avant toute lecture org-scopée.
      const orgRes = await secureFetch('/api/me/collaboration/ensure-org', { method: 'POST' })
      if (!orgRes.ok) { setPhase('org_error'); return }

      // 2. Besoins + quota en parallèle.
      const [pubsRes, quotaRes] = await Promise.all([
        secureFetch(`/api/publications?locale=${encodeURIComponent(locale)}`, { method: 'GET' }),
        secureFetch('/api/me/collaboration/quota', { method: 'GET' }),
      ])
      if (!pubsRes.ok) { setPhase('org_error'); return }
      const pubsPayload = (await pubsRes.json().catch(() => ({}))) as { publications?: Annonce[] }
      const all = pubsPayload.publications ?? []
      setNeeds(all.filter((p) => p.type === 'sous_traitance'))

      if (quotaRes.ok) {
        setQuota((await quotaRes.json().catch(() => null)) as Quota | null)
      } else {
        setQuota(null)
      }
      setPhase('ready')
    } catch {
      setPhase('org_error')
    }
  }, [secureFetch, locale])

  useEffect(() => { void load() }, [load])

  const canPublish = quota?.canPublish ?? true

  const header = (
    <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: '#0f172a', margin: '0 0 6px', letterSpacing: '-0.4px' }}>{t('title')}</h1>
        <p style={{ fontSize: 14, color: '#64748b', margin: 0, maxWidth: 640 }}>{t('subtitle')}</p>
      </div>
      {phase === 'ready' && (
        canPublish ? (
          <Link
            href={`${basePath}/sous-traitance/nouveau`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 18px', background: domain.primaryColor, color: '#fff', borderRadius: 10, fontSize: 14, fontWeight: 700, textDecoration: 'none', flexShrink: 0 }}
          >
            + {t('new_cta')}
          </Link>
        ) : (
          <button
            type="button"
            disabled
            aria-disabled
            title={t('quota_reached_body')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 18px', background: '#e2e8f0', color: '#94a3b8', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'not-allowed', flexShrink: 0, fontFamily: 'inherit' }}
          >
            + {t('new_cta')}
          </button>
        )
      )}
    </div>
  )

  return (
    <div style={{ padding: '24px 24px 56px', width: '100%' }}>
      {header}

      {phase === 'loading' && (
        <div style={{ padding: 40, color: '#64748b', fontSize: 14 }}>{t('loading')}</div>
      )}

      {phase === 'org_error' && (
        <div style={{ maxWidth: 640, border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 16, padding: 24 }}>
          <p style={{ margin: '0 0 14px', fontSize: 14, color: '#991b1b' }}>{t('error')}</p>
          <button type="button" onClick={() => void load()} style={{ padding: '10px 16px', background: domain.primaryColor, color: '#fff', border: 'none', borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            {t('retry')}
          </button>
        </div>
      )}

      {phase === 'ready' && !canPublish && (
        <div role="status" style={{ maxWidth: 720, border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 12, padding: '14px 16px', marginBottom: 18 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: '#92400e', marginBottom: 3 }}>{t('quota_reached_title')}</div>
          <div style={{ fontSize: 13, color: '#a16207', lineHeight: 1.5 }}>{t('quota_reached_body')}</div>
        </div>
      )}

      {phase === 'ready' && needs.length === 0 && (
        <div style={{ maxWidth: 640, border: '1px dashed #cbd5e1', background: '#f8fafc', borderRadius: 16, padding: '40px 28px', textAlign: 'center' }}>
          <div style={{ fontSize: 34, marginBottom: 10 }} aria-hidden>🤝</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>{t('empty_title')}</div>
          <p style={{ fontSize: 13.5, color: '#64748b', lineHeight: 1.6, margin: '0 auto 18px', maxWidth: 420 }}>{t('empty_body')}</p>
          <Link href={`${basePath}/sous-traitance/nouveau`} style={{ display: 'inline-flex', padding: '11px 18px', background: domain.primaryColor, color: '#fff', borderRadius: 10, fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
            + {t('new_cta')}
          </Link>
        </div>
      )}

      {phase === 'ready' && needs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {needs.map((n) => (
            <NeedCard key={n.id} need={n} basePath={basePath} locale={locale} accent={domain.primaryColor} tPub={tPub} t={t} />
          ))}
        </div>
      )}
    </div>
  )
}

function NeedCard({
  need, basePath, locale, accent, tPub, t,
}: {
  need: Annonce
  basePath: string
  locale: string
  accent: string
  tPub: ReturnType<typeof useTranslations>
  t: ReturnType<typeof useTranslations>
}) {
  const total = need.candidatures?.total ?? 0
  const toReview = need.candidatures?.to_review ?? 0
  const publishedDate = need.published_at ?? need.created_at

  return (
    <Link
      href={`${basePath}/sous-traitance/${need.id}`}
      style={{ display: 'block', textDecoration: 'none', border: '1px solid var(--sk-border)', background: 'var(--sk-surface)', borderRadius: 14, padding: '16px 18px', color: 'inherit' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ padding: '3px 9px', borderRadius: 999, background: 'var(--sk-surface-2)', color: 'var(--sk-muted)', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              {tPub(`status.${need.status}` as 'status.published')}
            </span>
            {toReview > 0 && (
              <span style={{ padding: '3px 9px', borderRadius: 999, background: `${accent}18`, color: accent, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                {t('new_badge')}
              </span>
            )}
          </div>
          <h2 style={{ fontSize: 16.5, fontWeight: 700, color: 'var(--sk-text)', margin: '0 0 4px', letterSpacing: '-0.2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {need.title}
          </h2>
          <div style={{ fontSize: 12.5, color: 'var(--sk-faint)' }}>
            {t('published_at', { date: new Date(publishedDate).toLocaleDateString(locale) })}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--sk-text)' }}>
            {t('candidatures_count', { count: total })}
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: accent }}>{t('view_cta')} →</span>
        </div>
      </div>
    </Link>
  )
}
