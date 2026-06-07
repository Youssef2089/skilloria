'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch } from '@/lib/secure-fetch'
import CandidatureCard, { type CandidatureData } from '@/components/dashboard/CandidatureCard'
import { IconExternalLink } from '@tabler/icons-react'
import BoundedScrollList from '@/components/ui/BoundedScrollList'

/**
 * /dashboard/entreprise/candidatures — vue GLOBALE des candidatures reçues
 * par l'organisation, toutes annonces confondues (SC6 Lot UX Finitions 2).
 *
 * Source : GET /api/me/candidatures-org. Le serveur applique l'ownership
 * stricte (publications.organization_id == auth.org.id) et délègue le
 * builder DTO au helper partagé buildOrgCandidatureDTOs — exactement la
 * même masquage et le même contrat d'unlock que la vue per-annonce.
 *
 * Regroupement par publication (en gardant le tri ai_match_score DESC du
 * serveur à l'intérieur de chaque groupe).
 */

type PublicationInfo = { id: string; type: string; title: string; status: string }
type GlobalCandidature = CandidatureData & { publication_id: string }
type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; candidatures: GlobalCandidature[]; publications: PublicationInfo[] }

type Filter = 'all' | 'received' | 'unlocked' | 'selected' | 'rejected'

export default function GlobalCandidaturesPage() {
  const t = useTranslations('candidatures.feed_global')
  const tPub = useTranslations('publications.type')
  const locale = useLocale()
  const router = useRouter()
  const domain = useDomain()
  const secureFetch = useSecureFetch()

  const [state, setState] = useState<State>({ kind: 'loading' })
  const [filter, setFilter] = useState<Filter>('all')

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const res = await secureFetch(
        `/api/me/candidatures-org?locale=${encodeURIComponent(locale)}`,
        { method: 'GET' },
      )
      const payload = (await res.json().catch(() => ({} as { code?: string }))) as {
        code?: string
        candidatures?: GlobalCandidature[]
        publications?: PublicationInfo[]
      }
      if (!res.ok) {
        setState({ kind: 'error', message: t('error_generic') })
        return
      }
      setState({
        kind: 'ready',
        candidatures: payload.candidatures ?? [],
        publications: payload.publications ?? [],
      })
    } catch (err) {
      console.error('[global candidatures] fetch threw', err)
      setState({ kind: 'error', message: t('error_generic') })
    }
  }, [locale, secureFetch, t])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    if (state.kind !== 'ready') return [] as GlobalCandidature[]
    return state.candidatures.filter((c) => {
      if (filter === 'all') return true
      if (filter === 'received') return c.status === 'received' || c.status === 'in_review' || c.status === 'shortlisted'
      if (filter === 'unlocked') return c.status === 'unlocked'
      if (filter === 'selected') return c.status === 'selected'
      if (filter === 'rejected') return c.status === 'rejected'
      return true
    })
  }, [state, filter])

  // Regroupement par publication, en respectant l'ordre serveur à l'intérieur
  const groups = useMemo(() => {
    if (state.kind !== 'ready') return [] as Array<{ pub: PublicationInfo; items: GlobalCandidature[] }>
    const pubById = new Map(state.publications.map((p) => [p.id, p] as const))
    const map = new Map<string, GlobalCandidature[]>()
    for (const c of filtered) {
      const arr = map.get(c.publication_id) ?? []
      arr.push(c)
      map.set(c.publication_id, arr)
    }
    return Array.from(map.entries())
      .map(([pid, items]) => ({ pub: pubById.get(pid) ?? { id: pid, type: 'mission', title: '', status: 'published' }, items }))
      .sort((a, b) => (a.pub.title ?? '').localeCompare(b.pub.title ?? ''))
  }, [state, filtered])

  const counts = useMemo(() => {
    if (state.kind !== 'ready') return { all: 0, received: 0, unlocked: 0, selected: 0, rejected: 0 }
    const c = state.candidatures
    return {
      all: c.length,
      received: c.filter((x) => x.status === 'received' || x.status === 'in_review' || x.status === 'shortlisted').length,
      unlocked: c.filter((x) => x.status === 'unlocked').length,
      selected: c.filter((x) => x.status === 'selected').length,
      rejected: c.filter((x) => x.status === 'rejected').length,
    }
  }, [state])

  if (state.kind === 'loading') {
    return <div style={{ padding: 48, textAlign: 'center', color: 'var(--sk-muted)', fontFamily: 'inherit' }}>{t('loading')}</div>
  }
  if (state.kind === 'error') {
    return (
      <div style={{ maxWidth: 560, margin: '60px auto', padding: '0 24px', textAlign: 'center', fontFamily: 'inherit' }}>
        <p style={{ fontSize: 14, color: 'var(--sk-red)', marginBottom: 18 }}>{state.message}</p>
        <button
          type="button"
          onClick={() => router.push('/dashboard/entreprise')}
          style={{
            padding: '10px 18px', background: domain.primaryColor, color: '#fff',
            border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {t('back_to_dashboard')}
        </button>
      </div>
    )
  }

  const tabs: Array<{ key: Filter; label: string; count: number; dot: string }> = [
    { key: 'all',      label: t('filter_all'),      count: counts.all,      dot: 'var(--sk-faint)' },
    { key: 'received', label: t('filter_received'), count: counts.received, dot: domain.primaryColor },
    { key: 'unlocked', label: t('filter_unlocked'), count: counts.unlocked, dot: 'var(--sk-success)' },
    { key: 'selected', label: t('filter_selected'), count: counts.selected, dot: '#D97706' },
    { key: 'rejected', label: t('filter_rejected'), count: counts.rejected, dot: 'var(--sk-red)' },
  ]

  return (
    <div style={{ padding: '24px 26px 40px', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <header style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 12, color: 'var(--sk-faint)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, marginBottom: 4 }}>
          {t('header_kicker')}
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--sk-text)', lineHeight: 1.3, letterSpacing: '-0.2px', marginBottom: 4 }}>
          {t('header_title')}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--sk-muted)', margin: 0, lineHeight: 1.55 }}>
          {t('header_subtitle')}
        </p>
      </header>

      {/* Tabs filtres */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, borderBottom: '1px solid var(--sk-border)', flexWrap: 'wrap' }}>
        {tabs.map((tab) => {
          const active = filter === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilter(tab.key)}
              style={{
                padding: '10px 14px', background: 'transparent', border: 'none',
                borderBottom: active ? `2px solid ${domain.primaryColor}` : '2px solid transparent',
                color: active ? 'var(--sk-text)' : 'var(--sk-muted)',
                fontSize: 13, fontWeight: active ? 600 : 500, cursor: 'pointer', fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: -1,
              }}
            >
              <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: tab.dot }} />
              {tab.label} ({tab.count})
            </button>
          )
        })}
      </div>

      {groups.length === 0 ? (
        <div
          style={{
            background: 'var(--sk-surface)', border: '0.5px solid var(--sk-border)',
            borderRadius: 14, padding: '40px 24px', textAlign: 'center',
            color: 'var(--sk-muted)', fontSize: 14, lineHeight: 1.6,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--sk-text)', marginBottom: 6 }}>
            {filter === 'all' ? t('empty_all_title') : t('empty_filtered_title')}
          </div>
          <div>{filter === 'all' ? t('empty_all_subtitle') : t('empty_filtered_subtitle')}</div>
        </div>
      ) : (
        <BoundedScrollList innerGap={26}>
          {groups.map((g) => (
            <section key={g.pub.id}>
              {/* Header de groupe — sticky top du conteneur scrollable
                  (pattern Stripe/Linear pour listes groupées). */}
              <header
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 12, marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--sk-border)',
                  flexWrap: 'wrap',
                  position: 'sticky',
                  top: 0,
                  background: 'var(--sk-bg)',
                  zIndex: 4,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--sk-faint)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>
                    {tPub((g.pub.type === 'offre' ? 'offre' : 'mission') as 'mission')}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--sk-text)', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {g.pub.title}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--sk-muted)', marginTop: 2 }}>
                    {t('group_count', { count: g.items.length })}
                  </div>
                </div>
                <Link
                  href={`/dashboard/entreprise/annonces/${g.pub.id}/candidatures`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '8px 12px', borderRadius: 9,
                    border: '1px solid var(--sk-border)',
                    color: 'var(--sk-text)', textDecoration: 'none',
                    fontSize: 12.5, fontWeight: 600,
                    background: 'var(--sk-surface)',
                  }}
                >
                  <IconExternalLink size={14} stroke={1.8} />
                  {t('view_pub')}
                </Link>
              </header>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {g.items.map((c) => (
                  <CandidatureCard
                    key={c.id}
                    candidature={c}
                    publicationType={g.pub.type}
                    onMutated={() => { void load() }}
                  />
                ))}
              </div>
            </section>
          ))}
        </BoundedScrollList>
      )}
    </div>
  )
}
