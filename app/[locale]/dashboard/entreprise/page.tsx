'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import OrgSetupModal from '@/components/OrgSetupModal'
import { useDomain } from '@/context/DomainContext'
import { useLiveResource } from '@/hooks/useLiveResource'
import { useOrgRole } from '@/lib/use-org-role'
import { dashboardUrlForUserType } from '@/lib/auth-routing'
import type { Annonce, AnnonceStatus, AnnonceCandidatures } from '@/types/annonce'

/**
 * Dashboard entreprise (Lot refonte tableau de bord).
 *
 * Refonte 2026 : le dashboard ne LISTE PLUS les annonces (rôle dévolu à
 * `/dashboard/entreprise/annonces`). À la place, deux blocs de SUIVI :
 *
 *   1. Suivi des publications  — 4 tuiles par statut PUBLICATION
 *      (Publiées / En revue / Brouillons / Clôturées) + lien Mes annonces.
 *   2. Suivi des candidatures — total + 4 tuiles ENTONNOIR exclusives
 *      (À consulter / Échanges en cours / Acceptées / Refusées)
 *      qui s'additionnent au total + lien Candidatures.
 *
 * Sources :
 *   - GET /api/publications (DTO Annonce[] avec compteurs entonnoir agg
 *     par pub). On agrège côté client pour les chiffres globaux.
 *   - Le statut publication est lu sur `annonce.status` (enum 7 valeurs).
 *
 * Cohérence :
 *   - L'entonnoir candidatures est STATUS-BASED (received/in_review/...
 *     → 4 buckets). Distinct du badge nav Candidatures qui reste basé sur
 *     `candidature_views` (par item non consulté). Les deux cohabitent
 *     volontairement.
 *   - Codes DB intacts (selected, unlocked, …) ; renommage purement display.
 *
 * Mobile-first : grid auto-fit minmax → 1 colonne sur mobile.
 */

type SetupState =
  | { kind: 'loading' }
  | { kind: 'needs_setup'; organizationId: string }
  | { kind: 'ready'; organizationVerified: boolean; companyName: string | null }
  | { kind: 'session_expired' }
  | { kind: 'no_org' }
  | { kind: 'error'; message?: string }

// Regroupement des 7 statuts publication en 4 buckets dashboard.
const PUB_TAB_STATUSES: Record<'published' | 'review' | 'drafts' | 'closed', readonly AnnonceStatus[]> = {
  published: ['published'],
  review: ['pending_review', 'rejected'],
  drafts: ['draft'],
  closed: ['suspended', 'expired', 'archived'],
}

export default function DashboardEntreprise() {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('dashboard_entreprise')
  const tCommon = useTranslations('common')
  const domain = useDomain()
  // C7 : viewer = lecture seule → bouton « Publier » masqué/désactivé (garde
  // serveur = garantie). canManage vrai pour editor/admin.
  const { canManage } = useOrgRole()

  const [state, setState] = useState<SetupState>({ kind: 'loading' })
  const [needsRedirect, setNeedsRedirect] = useState(false)
  // C10 : prénom de l'utilisateur connecté pour l'accueil personnalisé.
  const [firstName, setFirstName] = useState<string | null>(null)

  function classifyError(errorMessage: string | null | undefined): 'session_expired' | 'error' {
    if (!errorMessage) return 'error'
    const m = errorMessage.toLowerCase()
    if (m.includes('jwt') || m.includes('expired') || m.includes('invalid_token') || m.includes('unauthorized')) {
      return 'session_expired'
    }
    return 'error'
  }

  async function redirectByUserType(userId: string): Promise<void> {
    const { data: u } = await supabase.from('users').select('user_type').eq('id', userId).maybeSingle()
    const userType = (u as { user_type?: string | null } | null)?.user_type ?? null
    if (userType === 'expert_freelance' || userType === 'expert_cdi') {
      router.replace(dashboardUrlForUserType(userType))
    } else if (userType === 'admin') {
      router.replace('/admin')
    } else {
      router.replace('/')
    }
  }

  const refresh = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) {
      setNeedsRedirect(true)
      return
    }
    // C10 : prénom (best-effort, ne bloque pas le rendu si absent).
    const { data: uRow } = await supabase.from('users').select('first_name').eq('id', session.user.id).maybeSingle()
    setFirstName(((uRow as { first_name?: string | null } | null)?.first_name ?? '').trim() || null)
    const { data: memberRow, error } = await supabase
      .from('organization_members')
      .select('organizations(id, company_name, verification_status, setup_completed_at)')
      .eq('user_id', session.user.id)
      .eq('status', 'active')
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('[dashboard/entreprise] org lookup error', error.message)
      const kind = classifyError(error.message)
      setState(kind === 'session_expired' ? { kind: 'session_expired' } : { kind: 'error', message: error.message })
      return
    }
    const orgRow = Array.isArray(memberRow?.organizations)
      ? memberRow.organizations[0]
      : memberRow?.organizations
    if (!orgRow) {
      setState({ kind: 'no_org' })
      void redirectByUserType(session.user.id)
      return
    }
    const row = orgRow as { id: string; company_name: string | null; verification_status: string | null; setup_completed_at: string | null }
    if (!row.setup_completed_at) {
      setState({ kind: 'needs_setup', organizationId: row.id })
      return
    }
    setState({
      kind: 'ready',
      organizationVerified: row.verification_status === 'approved',
      companyName: row.company_name,
    })
  }, [router])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (needsRedirect) router.replace('/connexion')
  }, [needsRedirect, router])

  // Annonces de l'org (pour calcul agrégat des 2 blocs).
  const annoncesUrl = state.kind === 'ready'
    ? `/api/publications?locale=${encodeURIComponent(locale)}`
    : null
  const annoncesLive = useLiveResource<{ publications: Annonce[] }, Annonce>({
    url: annoncesUrl,
    itemsOf: (d) => d.publications ?? [],
    identityOf: (a) => a.id,
    versionOf: (a) => `${a.status}|${a.published_at ?? a.created_at}`,
    holdNewItems: false,
  })

  // Agrégats globaux.
  //   - pubCounts : nombre d'annonces par bucket statut (4 buckets).
  //   - candCounts : somme des entonnoirs candidatures sur TOUTES les pubs.
  const annonces = annoncesLive.data?.publications ?? []
  const pubCounts = useMemo(() => {
    const r = { published: 0, review: 0, drafts: 0, closed: 0 }
    for (const a of annonces) {
      if ((PUB_TAB_STATUSES.published as readonly string[]).includes(a.status)) r.published++
      else if ((PUB_TAB_STATUSES.review as readonly string[]).includes(a.status)) r.review++
      else if ((PUB_TAB_STATUSES.drafts as readonly string[]).includes(a.status)) r.drafts++
      else if ((PUB_TAB_STATUSES.closed as readonly string[]).includes(a.status)) r.closed++
    }
    return r
  }, [annonces])

  const candCounts: AnnonceCandidatures = useMemo(() => {
    const acc: AnnonceCandidatures = { total: 0, to_review: 0, in_progress: 0, accepted: 0, rejected: 0 }
    for (const a of annonces) {
      const c = a.candidatures
      acc.total += c.total
      acc.to_review += c.to_review
      acc.in_progress += c.in_progress
      acc.accepted += c.accepted
      acc.rejected += c.rejected
    }
    return acc
  }, [annonces])

  if (state.kind === 'loading' || state.kind === 'no_org' || needsRedirect) {
    return <div style={{ padding: 48, textAlign: 'center', color: '#64748b' }}>…</div>
  }
  // Setup non terminé : bloque l'écran avec le modal de setup, comme avant.
  if (state.kind === 'needs_setup') {
    return <OrgSetupModal onComplete={() => void refresh()} />
  }
  if (state.kind === 'session_expired') {
    return (
      <div style={{ padding: 48, textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
        <div style={{ fontSize: 32, marginBottom: 14 }} aria-hidden>🔒</div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>{t('errors.session_expired_title')}</h1>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 20, lineHeight: 1.6 }}>{t('errors.session_expired_body')}</p>
        <button
          type="button"
          onClick={async () => { await supabase.auth.signOut(); router.replace('/connexion') }}
          style={{ padding: '10px 20px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >
          {t('errors.reconnect_cta')}
        </button>
      </div>
    )
  }
  if (state.kind === 'error') {
    return (
      <div style={{ padding: 48, textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
        <div style={{ fontSize: 32, marginBottom: 14 }} aria-hidden>⚠️</div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>{t('errors.technical_title')}</h1>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 20, lineHeight: 1.6 }}>{t('errors.technical_body')}</p>
        <button
          type="button"
          onClick={() => void refresh()}
          style={{ padding: '10px 20px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >
          {tCommon('retry')}
        </button>
      </div>
    )
  }

  const isApproved = state.organizationVerified
  const publishHref = `/dashboard/entreprise/annonces/nouvelle`
  const isLoadingData = annoncesLive.state.kind === 'loading'

  return (
    <div style={{ padding: '24px 26px 40px', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <style>{`
        .sk-dash-tile {
          background: var(--sk-surface);
          border: 1px solid var(--sk-border);
          border-radius: 12px;
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          transition: border-color .12s, box-shadow .12s;
        }
        .sk-dash-tile.is-accent {
          border-color: var(--sk-accent);
          background: var(--sk-accent-soft);
        }
        @media (max-width: 767px) {
          .sk-dash-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>

      {/* Pastille verif si non approved */}
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
            marginBottom: 16,
            alignSelf: 'flex-start',
          }}
        >
          <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: '#CA8A04' }} />
          {t('verification_pending')}
        </div>
      )}

      {/* Header : greeting + bouton Publier */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 26,
          flexWrap: 'wrap',
          gap: 14,
        }}
      >
        <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--sk-text)', margin: 0, letterSpacing: '-0.3px' }}>
          {/* C10 : accueil personnalisé ; fallback sobre si le prénom manque. */}
          {firstName ? t('greeting_named', { firstName }) : t('greeting')} 👋
        </h1>
        {isApproved && canManage ? (
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
              fontWeight: 600,
              borderRadius: 10,
              textDecoration: 'none',
            }}
          >
            + {t('publish_annonce')}
          </Link>
        ) : (
          <button
            type="button"
            disabled
            title={!isApproved ? t('publish_disabled_tooltip') : t('publish_role_tooltip')}
            aria-disabled
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              background: domain.primaryColor,
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 10,
              border: 'none',
              opacity: 0.45,
              cursor: 'not-allowed',
              fontFamily: 'inherit',
            }}
          >
            + {t('publish_annonce')}
          </button>
        )}
      </header>

      {/* ──────────────── BLOC 1 — Suivi des publications ──────────────── */}
      <section
        style={{
          background: 'var(--sk-surface)',
          border: '1px solid var(--sk-border)',
          borderRadius: 14,
          padding: '20px 22px',
          marginBottom: 18,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--sk-text)', letterSpacing: '-0.2px' }}>
            {t('overview.publications_title')}
          </div>
          <Link
            href="/dashboard/entreprise/annonces"
            style={{ fontSize: 13, fontWeight: 600, color: domain.primaryColor, textDecoration: 'none' }}
          >
            {t('overview.see_annonces')} →
          </Link>
        </div>

        <div
          className="sk-dash-grid"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}
        >
          <PubTile label={t('overview.pub_published')} value={pubCounts.published} dot="#16A34A" loading={isLoadingData} />
          <PubTile label={t('overview.pub_review')} value={pubCounts.review} dot="#CA8A04" loading={isLoadingData} />
          <PubTile label={t('overview.pub_drafts')} value={pubCounts.drafts} dot="#94a3b8" loading={isLoadingData} />
          <PubTile label={t('overview.pub_closed')} value={pubCounts.closed} dot="#94a3b8" loading={isLoadingData} />
        </div>
      </section>

      {/* ──────────────── BLOC 2 — Suivi des candidatures ──────────────── */}
      <section
        style={{
          background: 'var(--sk-surface)',
          border: '1px solid var(--sk-border)',
          borderRadius: 14,
          padding: '20px 22px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--sk-text)', letterSpacing: '-0.2px' }}>
            {t('overview.candidatures_title')}
          </div>
          <Link
            href="/dashboard/entreprise/candidatures"
            style={{ fontSize: 13, fontWeight: 600, color: domain.primaryColor, textDecoration: 'none' }}
          >
            {t('overview.see_candidatures')} →
          </Link>
        </div>

        {/* Total en lead */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 38, fontWeight: 800, color: 'var(--sk-text)', lineHeight: 1, letterSpacing: '-1px' }}>
            {isLoadingData ? '…' : candCounts.total}
          </span>
          <span style={{ fontSize: 13, color: 'var(--sk-muted)', fontWeight: 500 }}>
            {t('funnel.total_suffix')}
          </span>
        </div>

        {/* 4 buckets entonnoir */}
        <div
          className="sk-dash-grid"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}
        >
          <FunnelTile
            label={t('funnel.to_review')}
            value={candCounts.to_review}
            accent
            loading={isLoadingData}
          />
          <FunnelTile
            label={t('funnel.in_progress')}
            value={candCounts.in_progress}
            color="var(--sk-text)"
            loading={isLoadingData}
          />
          <FunnelTile
            label={t('funnel.accepted')}
            value={candCounts.accepted}
            color="#16A34A"
            loading={isLoadingData}
          />
          <FunnelTile
            label={t('funnel.rejected')}
            value={candCounts.rejected}
            color="var(--sk-muted)"
            loading={isLoadingData}
          />
        </div>
      </section>

      {!isApproved && annonces.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--sk-faint)', marginTop: 18, textAlign: 'center' }}>
          {t('publish_disabled_tooltip')}
        </p>
      )}
    </div>
  )
}

function PubTile({
  label,
  value,
  dot,
  loading,
}: {
  label: string
  value: number
  dot: string
  loading: boolean
}) {
  return (
    <div className="sk-dash-tile">
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--sk-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} />
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--sk-text)', lineHeight: 1.1, letterSpacing: '-0.5px' }}>
        {loading ? '…' : value}
      </div>
    </div>
  )
}

function FunnelTile({
  label,
  value,
  color,
  accent,
  loading,
}: {
  label: string
  value: number
  color?: string
  accent?: boolean
  loading: boolean
}) {
  return (
    <div className={`sk-dash-tile${accent ? ' is-accent' : ''}`}>
      <div style={{ fontSize: 11, color: accent ? 'var(--sk-accent-ink)' : 'var(--sk-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 700,
          color: accent ? 'var(--sk-accent-ink)' : (color ?? 'var(--sk-text)'),
          lineHeight: 1.1,
          letterSpacing: '-0.5px',
        }}
      >
        {loading ? '…' : value}
      </div>
    </div>
  )
}

