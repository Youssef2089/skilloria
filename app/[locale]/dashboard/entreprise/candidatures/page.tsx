'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { Link, useRouter, usePathname } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch } from '@/lib/secure-fetch'
import { resolveBackNav } from '@/lib/auth-routing'
import { type CandidatureData } from '@/components/dashboard/CandidatureCard'
import CastingCarousel from '@/components/dashboard/CastingCarousel'
import { IconExternalLink } from '@tabler/icons-react'

/**
 * /dashboard/entreprise/candidatures — vue GLOBALE master-detail.
 *
 * Layout :
 *   - MASTER (gauche, ~260px desktop) : liste des annonces ayant ≥1 candidature,
 *     chaque item cliquable (badge type + titre + "N candidats · meilleur X/10").
 *   - DETAIL (droite, flex)            : en-tête slim (titre + N candidats +
 *     "Voir l'annonce") + CastingCarousel.
 *
 * Mobile (<1024px) : la liste passe AU-DESSUS sous forme de chips horizontales
 * scrollables (plus compact qu'une liste empilée verticale, et garde toutes
 * les annonces accessibles en un swipe). Le casting reste en dessous.
 *
 * Cliquer une annonce → MAJ du detail (state local, pas de reload). Par défaut
 * la 1re annonce de la liste est sélectionnée.
 *
 * Tri serveur ai_match_score DESC dans buildOrgCandidatureDTOs → meilleur
 * score au centre du carrousel par défaut.
 *
 * Auto-mark viewed : géré par CastingCarousel (le centre devient consulté).
 *
 * Sécurité (révélation post-unlock photo+nom) : appliquée CÔTÉ SERVEUR via
 * lib/expert-disclosure.ts. Cette page n'affiche que ce que le DTO autorise.
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
  const tBack = useTranslations('back_nav')
  const tCasting = useTranslations('candidatures.casting')
  const tPub = useTranslations('publications.type')
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const domain = useDomain()
  const secureFetch = useSecureFetch()

  // Retour universel : ?from = page réelle d'origine ; fallback = tableau de bord.
  const back = resolveBackNav(searchParams.get('from'), '/dashboard/entreprise')

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

  // Liste des publications ayant ≥1 candidature (entrées du master). Triées
  // par "meilleur score décroissant" pour que les annonces les plus prometteuses
  // remontent en haut de la liste.
  const pubOptions = useMemo(() => {
    if (state.kind !== 'ready') return [] as PublicationInfo[]
    const opts = state.publications.filter((p) => (byPub.get(p.id)?.length ?? 0) > 0)
    return opts.sort((a, b) => {
      const sa = byPub.get(a.id)?.[0]?.ai_match_score ?? -1
      const sb = byPub.get(b.id)?.[0]?.ai_match_score ?? -1
      return sb - sa
    })
  }, [state, byPub])

  // Pub sélectionnée : par défaut la 1re. Réagit aux loads.
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

  if (state.kind === 'loading') {
    return <div style={{ padding: 48, textAlign: 'center', color: 'var(--sk-muted)', fontFamily: 'inherit' }}>{t('loading')}</div>
  }
  if (state.kind === 'error') {
    return (
      <div style={{ maxWidth: 560, margin: '60px auto', padding: '0 24px', textAlign: 'center', fontFamily: 'inherit' }}>
        <p style={{ fontSize: 14, color: 'var(--sk-red)', marginBottom: 18 }}>{state.message}</p>
        <button
          type="button"
          onClick={() => router.push(back.path)}
          style={{
            padding: '10px 18px', background: domain.primaryColor, color: '#fff',
            border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {tBack(back.labelKey as 'back')}
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 26px 40px', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <style>{`
        /* Layout master-detail responsive */
        .sk-cand-layout {
          display: grid;
          grid-template-columns: 260px 1fr;
          gap: 18px;
          align-items: start;
        }
        .sk-cand-master { display: flex; flex-direction: column; gap: 8px; }
        .sk-cand-master-items { display: flex; flex-direction: column; gap: 8px; }
        .sk-cand-master-item {
          display: flex; flex-direction: column; gap: 4px;
          padding: 12px 14px;
          background: var(--sk-surface);
          border: 1px solid var(--sk-border);
          border-radius: 12px;
          cursor: pointer;
          text-align: left;
          font-family: inherit;
          transition: border-color .12s, box-shadow .12s, background .12s;
        }
        .sk-cand-master-item:hover { border-color: var(--sk-accent); }
        .sk-cand-master-item.is-active {
          border-color: var(--sk-accent);
          background: var(--sk-accent-soft);
          box-shadow: 0 0 0 3px var(--sk-accent-soft);
        }
        @media (max-width: 1023px) {
          .sk-cand-layout {
            grid-template-columns: 1fr;
            gap: 12px;
          }
          /* Mobile : chips horizontales scrollables */
          .sk-cand-master-items {
            flex-direction: row;
            overflow-x: auto;
            scrollbar-width: thin;
            padding-bottom: 8px;
            margin: 0 -4px;
          }
          .sk-cand-master-item {
            flex-shrink: 0;
            min-width: 220px;
            max-width: 280px;
          }
        }
      `}</style>

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
      ) : (
        <div className="sk-cand-layout">
          {/* ── MASTER : liste d'annonces ─────────────────────────────────── */}
          <aside className="sk-cand-master" aria-label={tCasting('master_aria_label')}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--sk-faint)', textTransform: 'uppercase', letterSpacing: '.08em', padding: '0 4px 4px' }}>
              {tCasting('master_title')}
            </div>
            <div className="sk-cand-master-items" role="listbox" aria-label={tCasting('master_aria_label')}>
              {pubOptions.map((p) => {
                const items = byPub.get(p.id) ?? []
                const best = items[0]?.ai_match_score ?? null
                const active = p.id === selectedPubId
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`sk-cand-master-item${active ? ' is-active' : ''}`}
                    onClick={() => setSelectedPubId(p.id)}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignSelf: 'flex-start',
                        padding: '3px 8px',
                        borderRadius: 999,
                        background: `${domain.primaryColor}14`,
                        color: domain.primaryColor,
                        fontSize: 10.5,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '.06em',
                      }}
                    >
                      {tPub((p.type === 'offre' ? 'offre' : 'mission') as 'mission')}
                    </span>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: 'var(--sk-text)',
                        lineHeight: 1.35,
                        letterSpacing: '-0.2px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {p.title}
                    </span>
                    <span style={{ fontSize: 11.5, color: 'var(--sk-muted)' }}>
                      {tCasting('count_candidates', { count: items.length })}
                      {best != null && (
                        <>
                          {' · '}
                          {tCasting('best_score_inline', { score: Math.round(best) })}
                        </>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </aside>

          {/* ── DETAIL : en-tête slim + casting ─────────────────────────── */}
          <section style={{ minWidth: 0 }}>
            {selectedPub && (
              <>
                <div
                  style={{
                    background: 'var(--sk-surface)',
                    border: '1px solid var(--sk-border)',
                    borderRadius: 14,
                    padding: '14px 16px',
                    marginBottom: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1, fontSize: 15, fontWeight: 700, color: 'var(--sk-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.2px' }}>
                    {selectedPub.title}
                  </div>
                  <span style={{ fontSize: 12.5, color: 'var(--sk-muted)', flexShrink: 0 }}>
                    {tCasting('count_candidates', { count: selectedItems.length })}
                  </span>
                  <Link
                    href={`/dashboard/entreprise/annonces/${selectedPub.id}?from=${encodeURIComponent(pathname)}`}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '7px 11px', borderRadius: 9,
                      border: '1px solid var(--sk-border)',
                      color: 'var(--sk-text)', textDecoration: 'none',
                      fontSize: 12, fontWeight: 600,
                      background: 'var(--sk-surface)',
                    }}
                  >
                    <IconExternalLink size={13} stroke={1.8} />
                    {t('view_pub')}
                  </Link>
                </div>

                <CastingCarousel
                  items={selectedItems}
                  publicationType={selectedPub.type}
                  pubSkillsRequired={selectedPub.skills_required ?? []}
                  onMutated={() => { void load() }}
                />
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
