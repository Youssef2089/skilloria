'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch } from '@/lib/secure-fetch'
import { type CandidatureData } from '@/components/dashboard/CandidatureCard'
import OrgCandidateGridCard from '@/components/dashboard/OrgCandidateGridCard'
import BoundedScrollList from '@/components/ui/BoundedScrollList'

/**
 * /dashboard/entreprise/annonces/[id]/candidatures — vue org des candidatures
 * sur une publication (Lot 2c).
 *
 * Garde serveur :
 *   GET /api/publications/[id]/candidatures vérifie ownership (publication →
 *   organization_members) ; renvoie 404 si la publi n'appartient pas à l'org.
 *
 * Masquage :
 *   Avant unlock, chaque carte affiche uniquement la preview (whitelist).
 *   Après unlock, la carte affiche le profil complet (identité, contact, CV).
 *   La transition se fait via re-fetch (onMutated() → load()).
 */

type Props = { params: Promise<{ id: string }> }

type PublicationInfo = { id: string; type: string; title: string; status: string; skills_required?: string[] }
type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; publication: PublicationInfo; candidatures: CandidatureData[] }

export default function CandidaturesPage({ params }: Props) {
  const t = useTranslations('candidatures.feed')
  const locale = useLocale()
  const router = useRouter()
  const domain = useDomain()
  const secureFetch = useSecureFetch()

  const [pubId, setPubId] = useState<string | null>(null)
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [filter, setFilter] = useState<'all' | 'received' | 'unlocked' | 'rejected'>('all')

  const load = useCallback(async (id: string) => {
    setState({ kind: 'loading' })
    try {
      const res = await secureFetch(
        `/api/publications/${id}/candidatures?locale=${encodeURIComponent(locale)}`,
        { method: 'GET' },
      )
      const payload = (await res.json().catch(() => ({} as { code?: string }))) as {
        code?: string
        publication?: PublicationInfo
        candidatures?: CandidatureData[]
      }
      if (!res.ok) {
        setState({
          kind: 'error',
          message: payload.code === 'not_found' ? t('error_not_found') : t('error_generic'),
        })
        return
      }
      setState({
        kind: 'ready',
        publication: payload.publication ?? { id, type: 'mission', title: '', status: 'published' },
        candidatures: payload.candidatures ?? [],
      })
    } catch (err) {
      console.error('[candidatures page] fetch threw', err)
      setState({ kind: 'error', message: t('error_generic') })
    }
  }, [locale, secureFetch, t])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const p = await params
      if (cancelled) return
      setPubId(p.id)
      void load(p.id)
    })()
    return () => { cancelled = true }
  }, [params, load])

  const refresh = useCallback(() => {
    if (pubId) void load(pubId)
  }, [pubId, load])

  // ── Render ──────────────────────────────────────────────────────────────
  if (state.kind === 'loading') {
    return <div style={{ padding: 48, textAlign: 'center', color: '#64748b', fontFamily: 'Inter, sans-serif' }}>{t('loading')}</div>
  }

  if (state.kind === 'error') {
    return (
      <div style={{ maxWidth: 560, margin: '60px auto', padding: '0 24px', textAlign: 'center', fontFamily: 'Inter, sans-serif' }}>
        <p style={{ fontSize: 14, color: '#b91c1c', marginBottom: 18 }}>{state.message}</p>
        <button
          type="button"
          onClick={() => router.push('/dashboard/entreprise')}
          style={{
            padding: '10px 18px',
            background: domain.primaryColor,
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {t('back_to_dashboard')}
        </button>
      </div>
    )
  }

  const { publication, candidatures } = state

  const counts = {
    all: candidatures.length,
    received: candidatures.filter((c) => c.status === 'received' || c.status === 'in_review' || c.status === 'shortlisted').length,
    unlocked: candidatures.filter((c) => c.status === 'unlocked').length,
    rejected: candidatures.filter((c) => c.status === 'rejected').length,
  }

  const filtered = candidatures.filter((c) => {
    if (filter === 'all') return true
    if (filter === 'received') return c.status === 'received' || c.status === 'in_review' || c.status === 'shortlisted'
    if (filter === 'unlocked') return c.status === 'unlocked'
    if (filter === 'rejected') return c.status === 'rejected'
    return true
  })

  const tabs: Array<{ key: typeof filter; label: string; count: number; dot: string }> = [
    { key: 'all', label: t('filter_all'), count: counts.all, dot: '#94a3b8' },
    { key: 'received', label: t('filter_received'), count: counts.received, dot: domain.primaryColor },
    { key: 'unlocked', label: t('filter_unlocked'), count: counts.unlocked, dot: '#16A34A' },
    { key: 'rejected', label: t('filter_rejected'), count: counts.rejected, dot: '#DC2626' },
  ]

  return (
    <div style={{ padding: '24px 26px 40px', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <button
        type="button"
        onClick={() => router.push('/dashboard/entreprise')}
        style={{
          background: 'transparent',
          border: 'none',
          color: domain.primaryColor,
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          padding: 0,
          marginBottom: 16,
        }}
      >
        {t('back_to_dashboard')}
      </button>

      <header style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, marginBottom: 4 }}>
          {t('header_kicker')}
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', lineHeight: 1.3, letterSpacing: '-0.2px', marginBottom: 4 }}>
          {publication.title || t('untitled_publication')}
        </h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
          {t('header_subtitle')}
        </p>
      </header>

      {/* Tabs filtres */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, borderBottom: '1px solid #e5e7eb', paddingBottom: 0, flexWrap: 'wrap' }}>
        {tabs.map((tab) => {
          const active = filter === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilter(tab.key)}
              style={{
                padding: '10px 14px',
                background: 'transparent',
                border: 'none',
                borderBottom: active ? `2px solid ${domain.primaryColor}` : '2px solid transparent',
                color: active ? '#0f172a' : '#64748b',
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: -1,
              }}
            >
              <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: tab.dot }} />
              {tab.label} ({tab.count})
            </button>
          )
        })}
      </div>

      {filtered.length === 0 ? (
        <div
          style={{
            background: '#fff',
            border: '0.5px solid #e5e7eb',
            borderRadius: 14,
            padding: '40px 24px',
            textAlign: 'center',
            color: '#64748b',
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>
            {filter === 'all' ? t('empty_all_title') : t('empty_filtered_title')}
          </div>
          <div>{filter === 'all' ? t('empty_all_subtitle') : t('empty_filtered_subtitle')}</div>
        </div>
      ) : (
        <BoundedScrollList innerGap={0}>
          {/* Lot grille photo-forward : même composant que la vue globale,
              scopé à une publication. Grille responsive — 1 col mobile,
              2-4 col desktop. Compétences matchées surlignées via
              publication.skills_required. */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 16,
            }}
          >
            {filtered.map((c) => (
              <OrgCandidateGridCard
                key={c.id}
                candidature={c}
                publicationType={publication.type}
                pubSkillsRequired={publication.skills_required ?? []}
                onMutated={refresh}
              />
            ))}
          </div>
        </BoundedScrollList>
      )}
    </div>
  )
}
