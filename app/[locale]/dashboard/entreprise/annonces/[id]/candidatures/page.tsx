'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch } from '@/lib/secure-fetch'
import { type CandidatureData } from '@/components/dashboard/CandidatureCard'
import CastingCarousel from '@/components/dashboard/CastingCarousel'

/**
 * /dashboard/entreprise/annonces/[id]/candidatures — vue casting per-annonce.
 *
 * Même composant que la page globale, mais scopé à une publication
 * (donc pas de sélecteur d'annonce). En-tête simplifié + carrousel.
 *
 * Tri ai_match_score DESC côté serveur, auto-mark viewed sur le centre.
 */

type Props = { params: Promise<{ id: string }> }

type PublicationInfo = {
  id: string
  type: string
  title: string
  status: string
  skills_required?: string[]
}
type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; publication: PublicationInfo; candidatures: CandidatureData[] }

export default function CandidaturesPage({ params }: Props) {
  const t = useTranslations('candidatures.feed')
  const tCasting = useTranslations('candidatures.casting')
  const tPub = useTranslations('publications.type')
  const locale = useLocale()
  const router = useRouter()
  const domain = useDomain()
  const secureFetch = useSecureFetch()

  const [pubId, setPubId] = useState<string | null>(null)
  const [state, setState] = useState<State>({ kind: 'loading' })

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

  const bestScore = useMemo(() => {
    if (state.kind !== 'ready') return null
    return state.candidatures[0]?.ai_match_score ?? null
  }, [state])

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

  return (
    <div style={{ padding: '24px 26px 40px', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {/* En-tête annonce */}
      <div
        style={{
          background: 'var(--sk-surface)',
          border: '1px solid var(--sk-border)',
          borderRadius: 14,
          padding: '16px 18px',
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '5px 11px',
            borderRadius: 999,
            background: `${domain.primaryColor}14`,
            color: domain.primaryColor,
            fontSize: 11.5,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '.06em',
            flexShrink: 0,
          }}
        >
          {tPub((publication.type === 'offre' ? 'offre' : 'mission') as 'mission')}
        </span>
        <div style={{ minWidth: 0, flex: 1, fontSize: 16, fontWeight: 700, color: 'var(--sk-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.2px' }}>
          {publication.title || t('untitled_publication')}
        </div>
        <span style={{ fontSize: 12.5, color: 'var(--sk-muted)', flexShrink: 0 }}>
          {tCasting('count_candidates', { count: candidatures.length })}
        </span>
        {bestScore != null && (
          <span style={{ fontSize: 12.5, color: 'var(--sk-muted)', flexShrink: 0 }}>
            {tCasting('best_score', { score: Math.round(bestScore) })}
          </span>
        )}
      </div>

      {/* Carrousel casting */}
      {candidatures.length === 0 ? (
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
            marginTop: 16,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>
            {t('empty_all_title')}
          </div>
          <div>{t('empty_all_subtitle')}</div>
        </div>
      ) : (
        <CastingCarousel
          items={candidatures}
          publicationType={publication.type}
          pubSkillsRequired={publication.skills_required ?? []}
          onMutated={refresh}
        />
      )}
    </div>
  )
}
