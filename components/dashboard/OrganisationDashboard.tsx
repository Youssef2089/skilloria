'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { type OrganisationLite } from '@/components/dashboard/OrganisationSidebar'
import AnnonceCard from '@/components/dashboard/AnnonceCard'
import { useNavBadges } from '@/hooks/useNavBadges'
import type { Annonce, AnnonceStatus } from '@/types/annonce'

// Regroupement des 7 statuts BDD en 4 onglets dashboard.
const TAB_STATUS_MAP: Record<TabKey, readonly AnnonceStatus[]> = {
  all: ['draft', 'pending_review', 'rejected', 'published', 'suspended', 'expired', 'archived'],
  drafts: ['draft'],
  review: ['pending_review', 'rejected'],
  published: ['published'],
  closed: ['suspended', 'expired', 'archived'],
}

/**
 * Dashboard organisation (B3.5 + B3.5.fix).
 *
 * UNIFICATION B3.5.fix : il n'existe qu'un seul dashboard organisation,
 * routé sur `/dashboard/entreprise`. `/dashboard/cabinet` redirige vers
 * cette URL. La prop `basePath` reste pour usage interne (construction
 * des liens sidebar / annonces) — vaut toujours '/dashboard/entreprise'
 * en V1, mais on garde la possibilité d'autres préfixes futurs.
 *
 * Couleurs primaires depuis `useDomain()` (multi-tenant — pas de hardcode).
 *
 * Section "Mes annonces" :
 *   - Recherche par titre (state local `searchQuery`)
 *   - Onglets filtres (state local `activeTab`) : Publiées (par défaut),
 *     En discussion, Clôturées, Toutes
 *   - Empty states selon contexte
 *
 * Bouton "Publier une annonce" désactivé tant que
 * `organization.verification_status !== 'approved'`.
 *
 * `organization.org_type` ('client' | 'cabinet' | 'esn') est disponible
 * en prop pour différenciation future des fonctionnalités par sous-type
 * (B4+). Non utilisé dans le rendu V1.
 */

export type OrganisationFull = OrganisationLite & {
  verification_status: string | null
  setup_completed_at: string | null
  /** Sous-type métier : 'client' | 'cabinet' | 'esn'. Disponible pour
   *  différenciation future des fonctionnalités (B4+). Non utilisé en V1. */
  org_type: string | null
}

type Props = {
  organization: OrganisationFull
  /**
   * Préfixe URL utilisé pour construire les liens internes (sidebar,
   * annonces). B3.5.fix : vaut toujours '/dashboard/entreprise' en V1
   * (un seul dashboard org). Conservé en prop pour flexibilité future.
   */
  basePath: '/dashboard/entreprise'
  annonces: Annonce[]
  unreadMessagesCount?: number
}

type TabKey = 'all' | 'drafts' | 'review' | 'published' | 'closed'

function IconPlus({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
function IconSearch({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  )
}
function IconBriefcase({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M3 13h18" />
    </svg>
  )
}

export default function OrganisationDashboard({
  organization,
  basePath,
  annonces,
  unreadMessagesCount,
}: Props) {
  const t = useTranslations('dashboard_entreprise')
  const tPub = useTranslations('publications')
  const domain = useDomain()
  // Point 5 (finitions UX) : compteur de messages non lus côté nav, branché
  // sur /api/me/conversations. La prop `unreadMessagesCount` (legacy) reste
  // utilisée si fournie explicitement (override) ; sinon → hook live.
  const badges = useNavBadges()
  const effectiveUnread = unreadMessagesCount ?? badges.messages_unread ?? 0

  const [activeTab, setActiveTab] = useState<TabKey>('published')
  const [searchQuery, setSearchQuery] = useState('')

  const isApproved = organization.verification_status === 'approved'
  const publishHref = `${basePath}/annonces/nouvelle`

  // Compteurs par onglet (regroupement de 1..3 statuts BDD chacun).
  // 'all' = total des annonces (sans bucket — chevauche les 4 autres tabs).
  const counts = useMemo(() => {
    const result: Record<TabKey, number> = {
      all: annonces.length,
      drafts: 0,
      review: 0,
      published: 0,
      closed: 0,
    }
    for (const a of annonces) {
      // Itération ciblée sur les buckets exclusifs (pas 'all' qui chevauche).
      for (const tab of ['drafts', 'review', 'published', 'closed'] as TabKey[]) {
        if ((TAB_STATUS_MAP[tab] as readonly string[]).includes(a.status)) {
          result[tab]++
          break
        }
      }
    }
    return result
  }, [annonces])

  // Liste filtrée par onglet + recherche
  const filteredAnnonces = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const wanted = TAB_STATUS_MAP[activeTab] as readonly string[]
    return annonces.filter((a) => {
      if (!wanted.includes(a.status)) return false
      if (query && !a.title.toLowerCase().includes(query)) return false
      return true
    })
  }, [annonces, activeTab, searchQuery])

  // Dots sémantiques par onglet (statuts groupés). 'all' en première position.
  const tabs: Array<{ key: TabKey; label: string; count: number; dot: string }> = [
    { key: 'all',       label: tPub('list.tab_all'),       count: counts.all,       dot: '#94a3b8' },
    { key: 'drafts',    label: tPub('list.tab_drafts'),    count: counts.drafts,    dot: '#94a3b8' },
    { key: 'review',    label: tPub('list.tab_review'),    count: counts.review,    dot: '#CA8A04' },
    { key: 'published', label: tPub('list.tab_published'), count: counts.published, dot: '#16A34A' },
    { key: 'closed',    label: tPub('list.tab_closed'),    count: counts.closed,    dot: '#94a3b8' },
  ]

  const showEmptyZeroState =
    annonces.length === 0 && (activeTab === 'drafts' || activeTab === 'published')

  // 'all' n'a pas d'empty state spécifique → fallback sur 'published' (cas le
  //  plus représentatif quand "Toutes" est vide pour l'org).
  const emptyStateKey: 'drafts' | 'review' | 'published' | 'closed' =
    activeTab === 'all' ? 'published' : activeTab

  // Lot refonte UX : la sidebar + topbar sont fournies par DashboardShell
  // (parent sub-layout). Ce composant ne rend plus que le CONTENU central
  // (pastille verif + header + grille annonces). Le marker effectiveUnread
  // n'est plus utilisé ici — la sidebar shared gère le badge messages.
  void effectiveUnread

  return (
    <div
      className="org-dashboard-content"
      style={{
        fontFamily: 'inherit',
      }}
    >
      <style>{`
        @media (max-width: 767px) {
          .org-main { padding: 20px !important; }
          .org-header {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: 14px !important;
          }
          .org-annonces-header {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 12px !important;
          }
          .org-search { width: 100% !important; }
        }
      `}</style>

      <main
        className="org-main"
        style={{
          padding: '24px 26px',
          minWidth: 0,
        }}
      >
        {/* Pastille vérif en attente */}
        {!isApproved && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 14px',
              background: '#FEF9C3',
              border: '1px solid #FDE047',
              borderRadius: 16,
              color: '#713F12',
              fontSize: 12,
              fontWeight: 500,
              marginBottom: 20,
            }}
          >
            <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: '#CA8A04' }} />
            {t('verification_pending')}
          </div>
        )}

        {/* Header : Bonjour + Publier */}
        <div
          className="org-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 32,
          }}
        >
          <h1 style={{ fontSize: 28, fontWeight: 500, color: 'var(--color-text-primary, #0f172a)', margin: 0 }}>
            {t('greeting')} 👋
          </h1>

          {isApproved ? (
            <Link
              href={publishHref}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 18px',
                background: domain.primaryColor,
                color: '#fff',
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 10,
                textDecoration: 'none',
                transition: 'background .15s, transform .15s',
              }}
            >
              <IconPlus size={14} />
              {t('publish_annonce')}
            </Link>
          ) : (
            <button
              type="button"
              disabled
              title={t('publish_disabled_tooltip')}
              aria-disabled
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 18px',
                background: domain.primaryColor,
                color: '#fff',
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 10,
                border: 'none',
                opacity: 0.45,
                cursor: 'not-allowed',
                fontFamily: 'inherit',
              }}
            >
              <IconPlus size={14} />
              {t('publish_annonce')}
            </button>
          )}
        </div>

        {/* Section "Mes annonces" */}
        <section
          style={{
            background: 'var(--color-background-primary, #fff)',
            border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
            borderRadius: 14,
            padding: '20px 24px',
          }}
        >
          <div
            className="org-annonces-header"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
            }}
          >
            <h2 style={{ fontSize: 15, fontWeight: 500, color: 'var(--color-text-primary, #0f172a)', margin: 0 }}>
              {t('my_annonces')}
            </h2>
            <div
              className="org-search"
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  left: 10,
                  color: 'var(--color-text-tertiary, #94a3b8)',
                  display: 'flex',
                  pointerEvents: 'none',
                }}
              >
                <IconSearch size={14} />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('search_placeholder')}
                aria-label={t('search_placeholder')}
                style={{
                  width: 240,
                  padding: '8px 12px 8px 32px',
                  fontSize: 13,
                  border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
                  borderRadius: 8,
                  outline: 'none',
                  fontFamily: 'inherit',
                  background: 'var(--color-background-secondary, #f8fafc)',
                  color: 'var(--color-text-primary, #0f172a)',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* Barre d'onglets filtres */}
          <div
            role="tablist"
            style={{
              display: 'flex',
              gap: 4,
              borderBottom: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
              marginBottom: 20,
              overflowX: 'auto',
            }}
          >
            {tabs.map((tab) => {
              const active = tab.key === activeTab
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 14px 10px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: active
                      ? `2px solid ${domain.primaryColor}`
                      : '2px solid transparent',
                    color: active
                      ? 'var(--color-text-primary, #0f172a)'
                      : 'var(--color-text-secondary, #64748b)',
                    fontSize: 13,
                    fontWeight: active ? 500 : 400,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    whiteSpace: 'nowrap',
                    transition: 'color .15s, border-color .15s',
                  }}
                >
                  <span
                    aria-hidden
                    style={{ width: 6, height: 6, borderRadius: '50%', background: tab.dot }}
                  />
                  {tab.label} ({Math.round(tab.count)})
                </button>
              )
            })}
          </div>

          {/* Liste / Empty states */}
          {filteredAnnonces.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {filteredAnnonces.map((a) => (
                <AnnonceCard key={a.id} annonce={a} basePath={basePath} />
              ))}
            </div>
          ) : showEmptyZeroState ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                padding: '40px 20px',
              }}
            >
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: '50%',
                  background: '#DBEAFE',
                  color: domain.primaryColor,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 16,
                }}
              >
                <IconBriefcase size={28} />
              </div>
              <h3
                style={{
                  fontSize: 16,
                  fontWeight: 500,
                  color: 'var(--color-text-primary, #0f172a)',
                  marginBottom: 6,
                }}
              >
                {tPub(`list.empty_title_${emptyStateKey}`)}
              </h3>
              <p
                style={{
                  fontSize: 13,
                  color: 'var(--color-text-secondary, #64748b)',
                  marginBottom: 20,
                  maxWidth: 320,
                  lineHeight: 1.5,
                }}
              >
                {tPub(`list.empty_subtitle_${emptyStateKey}`)}
              </p>
              {isApproved ? (
                <Link
                  href={publishHref}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 18px',
                    background: domain.primaryColor,
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 500,
                    borderRadius: 10,
                    textDecoration: 'none',
                  }}
                >
                  <IconPlus size={14} />
                  {t('empty_cta')}
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  title={t('publish_disabled_tooltip')}
                  aria-disabled
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 18px',
                    background: domain.primaryColor,
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 500,
                    borderRadius: 10,
                    border: 'none',
                    opacity: 0.45,
                    cursor: 'not-allowed',
                    fontFamily: 'inherit',
                  }}
                >
                  <IconPlus size={14} />
                  {t('empty_cta')}
                </button>
              )}
            </div>
          ) : (
            <div
              style={{
                padding: '32px 20px',
                textAlign: 'center',
                fontSize: 13,
                color: 'var(--color-text-secondary, #64748b)',
              }}
            >
              {tPub(`list.empty_subtitle_${emptyStateKey}`)}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
