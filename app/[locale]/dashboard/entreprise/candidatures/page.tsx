'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch } from '@/lib/secure-fetch'
import { type CandidatureData } from '@/components/dashboard/CandidatureCard'
import CastingCarousel from '@/components/dashboard/CastingCarousel'
import { IconExternalLink } from '@tabler/icons-react'

/**
 * /dashboard/entreprise/candidatures — vue GLOBALE des candidatures reçues
 * par l'organisation (Lot vue casting).
 *
 * Présentation : sélecteur d'annonce + carrousel "casting" pour l'annonce
 * sélectionnée. Plus de grille fragmentée. L'org regarde UNE annonce à la
 * fois sous projecteur, défile entre les candidats par flèches / clavier.
 *
 * Tri : ai_match_score DESC côté serveur (déjà dans buildOrgCandidatureDTOs).
 * Le meilleur score arrive en premier (centerIdx=0 par défaut).
 *
 * Auto-mark viewed : le centre du carrousel devient "consulté" → badge -1.
 *
 * Sécurité : la révélation photo+nom post-unlock est appliquée CÔTÉ SERVEUR
 * via lib/expert-disclosure.ts. Cette page ne fait qu'afficher ce que le DTO
 * autorise.
 */

type PublicationInfo = {
  id: string
  type: string
  title: string
  status: string
  skills_required?: string[]
}
type GlobalCandidature = CandidatureData & { publication_id: string }
type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; candidatures: GlobalCandidature[]; publications: PublicationInfo[] }

export default function GlobalCandidaturesPage() {
  const t = useTranslations('candidatures.feed_global')
  const tCasting = useTranslations('candidatures.casting')
  const tPub = useTranslations('publications.type')
  const locale = useLocale()
  const router = useRouter()
  const domain = useDomain()
  const secureFetch = useSecureFetch()

  const [state, setState] = useState<State>({ kind: 'loading' })
  const [selectedPubId, setSelectedPubId] = useState<string | null>(null)

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

  // Regroupement candidatures par publication.
  const byPub = useMemo(() => {
    if (state.kind !== 'ready') return new Map<string, GlobalCandidature[]>()
    const m = new Map<string, GlobalCandidature[]>()
    for (const c of state.candidatures) {
      const arr = m.get(c.publication_id) ?? []
      arr.push(c)
      m.set(c.publication_id, arr)
    }
    return m
  }, [state])

  // Liste des publications ayant au moins une candidature (= entrées du sélecteur).
  const pubOptions = useMemo(() => {
    if (state.kind !== 'ready') return [] as PublicationInfo[]
    return state.publications.filter((p) => (byPub.get(p.id)?.length ?? 0) > 0)
  }, [state, byPub])

  // Pub sélectionnée : par défaut la 1re qui a un candidat. Réagit au load.
  useEffect(() => {
    if (state.kind !== 'ready') return
    if (selectedPubId && pubOptions.some((p) => p.id === selectedPubId)) return
    setSelectedPubId(pubOptions[0]?.id ?? null)
  }, [state, pubOptions, selectedPubId])

  const selectedPub = useMemo(
    () => (selectedPubId ? pubOptions.find((p) => p.id === selectedPubId) ?? null : null),
    [pubOptions, selectedPubId],
  )
  const selectedItems = selectedPubId ? (byPub.get(selectedPubId) ?? []) : []
  const bestScore = selectedItems[0]?.ai_match_score ?? null

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

  return (
    <div style={{ padding: '24px 26px 40px', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <header style={{ marginBottom: 14 }}>
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

      {pubOptions.length === 0 ? (
        <div
          style={{
            background: 'var(--sk-surface)', border: '0.5px solid var(--sk-border)',
            borderRadius: 14, padding: '40px 24px', textAlign: 'center',
            color: 'var(--sk-muted)', fontSize: 14, lineHeight: 1.6, marginTop: 16,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--sk-text)', marginBottom: 6 }}>
            {t('empty_all_title')}
          </div>
          <div>{t('empty_all_subtitle')}</div>
        </div>
      ) : selectedPub ? (
        <>
          {/* En-tête annonce + sélecteur d'annonce + lien Voir l'annonce */}
          <div
            style={{
              background: 'var(--sk-surface)',
              border: '1px solid var(--sk-border)',
              borderRadius: 14,
              padding: '16px 18px',
              marginBottom: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {/* Badge type */}
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
                {tPub((selectedPub.type === 'offre' ? 'offre' : 'mission') as 'mission')}
              </span>
              {/* Titre annonce */}
              <div style={{ minWidth: 0, fontSize: 16, fontWeight: 700, color: 'var(--sk-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.2px' }}>
                {selectedPub.title}
              </div>
              {/* Compteur candidats */}
              <span style={{ fontSize: 12.5, color: 'var(--sk-muted)', flexShrink: 0 }}>
                {tCasting('count_candidates', { count: selectedItems.length })}
              </span>
              {/* Meilleur score */}
              {bestScore != null && (
                <span style={{ fontSize: 12.5, color: 'var(--sk-muted)', flexShrink: 0 }}>
                  {tCasting('best_score', { score: Math.round(bestScore) })}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Sélecteur d'annonce (uniquement si >1 pub avec candidatures) */}
              {pubOptions.length > 1 && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--sk-muted)', fontWeight: 500 }}>
                    {tCasting('switch_pub_label')}
                  </span>
                  <select
                    value={selectedPubId ?? ''}
                    onChange={(e) => setSelectedPubId(e.target.value)}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 9,
                      border: '1px solid var(--sk-border)',
                      background: 'var(--sk-surface)',
                      color: 'var(--sk-text)',
                      fontSize: 12.5,
                      fontWeight: 600,
                      fontFamily: 'inherit',
                      cursor: 'pointer',
                      maxWidth: 280,
                    }}
                  >
                    {pubOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title} ({byPub.get(p.id)?.length ?? 0})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Link
                href={`/dashboard/entreprise/annonces/${selectedPub.id}/candidatures`}
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
            </div>
          </div>

          {/* Carrousel casting de l'annonce sélectionnée */}
          <CastingCarousel
            items={selectedItems}
            publicationType={selectedPub.type}
            pubSkillsRequired={selectedPub.skills_required ?? []}
            onMutated={() => { void load() }}
          />
        </>
      ) : null}
    </div>
  )
}
