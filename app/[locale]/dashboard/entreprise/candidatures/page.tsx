'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { Link, usePathname, useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch } from '@/lib/secure-fetch'
import { type CandidatureData } from '@/components/dashboard/CandidatureCard'
import CastingCarousel from '@/components/dashboard/CastingCarousel'
import CandidatureFilterChips, {
  type CandidatureFilterValue,
} from '@/components/dashboard/CandidatureFilterChips'
import { useCandidatureFacetLabels } from '@/lib/candidatures/use-facet-label'
import { parseFacetFilter, type CandidatureFacetCounts } from '@/lib/candidatures/facets'
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
type BucketCounts = { active: number; archived: number }
type BucketKey = 'active' | 'archived'
type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready'
      candidatures: GlobalCandidature[]
      publications: PublicationInfo[]
      counts: BucketCounts
      facets: CandidatureFacetCounts | null
    }

export default function GlobalCandidaturesPage() {
  const t = useTranslations('candidatures.feed_global')
  const tCasting = useTranslations('candidatures.casting')
  const tPub = useTranslations('publications.type')
  const tLifecycle = useTranslations('candidature_lifecycle')
  const locale = useLocale()
  const router = useRouter()
  const domain = useDomain()
  const secureFetch = useSecureFetch()

  const [state, setState] = useState<State>({ kind: 'loading' })
  const [selectedPubId, setSelectedPubId] = useState<string | null>(null)

  // ── Filtres portés par l'URL ────────────────────────────────────────────
  // Bucket (Actives par défaut) + FACETTE, exactement comme côté expert et via
  // le même composant de chips. L'URL plutôt qu'un `useState` : les tuiles de
  // l'accueil entreprise mènent directement à une facette, et un état local
  // n'est pas atteignable depuis un lien. La vue devient partageable et
  // survit au rechargement.
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const bucket: BucketKey = searchParams.get('filter') === 'archived' ? 'archived' : 'active'
  const facet = parseFacetFilter(searchParams.get('facet'), bucket)
  const facetLabels = useCandidatureFacetLabels('org')
  const setFilters = useCallback(
    (next: CandidatureFilterValue) => {
      const qs = new URLSearchParams({ filter: next.bucket })
      if (next.facet) qs.set('facet', next.facet)
      router.replace(`${pathname}?${qs.toString()}`, { scroll: false })
    },
    [pathname, router],
  )

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const res = await secureFetch(
        `/api/me/candidatures-org?locale=${encodeURIComponent(locale)}&filter=${bucket}` +
          (facet ? `&facet=${facet}` : ''),
        { method: 'GET' },
      )
      const payload = (await res.json().catch(() => ({} as { code?: string }))) as {
        code?: string
        candidatures?: GlobalCandidature[]
        publications?: PublicationInfo[]
        counts?: BucketCounts
        facets?: CandidatureFacetCounts
      }
      if (!res.ok) {
        setState({ kind: 'error', message: t('error_generic') })
        return
      }
      setState({
        kind: 'ready',
        candidatures: payload.candidatures ?? [],
        publications: payload.publications ?? [],
        counts: payload.counts ?? { active: 0, archived: 0 },
        facets: payload.facets ?? null,
      })
    } catch (err) {
      console.error('[global candidatures] fetch threw', err)
      setState({ kind: 'error', message: t('error_generic') })
    }
  }, [locale, secureFetch, t, bucket, facet])

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

  // PAS de retour anticipé sur 'loading' : le chrome (en-tête + chips) doit
  // rester à l'écran. Chaque clic sur une chip relance un fetch ; un retour
  // anticipé ferait disparaître les filtres à chaque bascule et l'utilisateur
  // ne pourrait plus revenir en arrière. Le chargement se traite dans la zone
  // de contenu. C'est le correctif déjà appliqué côté expert.
  const isLoading = state.kind === 'loading'
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

  // Compteurs servis par le serveur : les chips affichent leur nombre sans
  // second appel et sans recomptage client. `null` pendant un chargement.
  const bucketCounts = state.kind === 'ready' ? state.counts : null
  const facetCounts = state.kind === 'ready' ? state.facets : null

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

      {/* Buckets + facettes — composant PARTAGÉ avec le menu Candidatures de
          l'expert : mêmes chips, mêmes règles, deux vocabulaires. */}
      <CandidatureFilterChips
        viewpoint="org"
        value={{ bucket, facet }}
        counts={bucketCounts}
        facets={facetCounts}
        onChange={setFilters}
      />

      {/* L'ORDRE COMPTE : le chargement est testé AVANT la vacuité. Une liste
          vide pendant un fetch n'est pas une absence de résultat, c'est une
          absence de réponse. */}
      {isLoading ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--sk-muted)' }}>{t('loading')}</div>
      ) : pubOptions.length === 0 ? (
        <div
          style={{
            background: 'var(--sk-surface)', border: '0.5px solid var(--sk-border)',
            borderRadius: 14, padding: '40px 24px', textAlign: 'center',
            color: 'var(--sk-muted)', fontSize: 14, lineHeight: 1.6, marginTop: 16,
          }}
        >
          {/* L'état vide NOMME le filtre courant : une facette à zéro est un
              résultat légitime, encore faut-il dire LEQUEL est vide. */}
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--sk-text)', marginBottom: 6 }}>
            {facet
              ? facetLabels.emptyTitle(facet)
              : bucket === 'archived'
                ? tLifecycle('empty_archived_title')
                : t('empty_all_title')}
          </div>
          <div>
            {facet
              ? facetLabels.emptyBody(facet)
              : bucket === 'archived'
                ? tLifecycle('empty_archived_body')
                : t('empty_all_subtitle')}
          </div>
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
                    href={`/dashboard/entreprise/annonces/${selectedPub.id}`}
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
