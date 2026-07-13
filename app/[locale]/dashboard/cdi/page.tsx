'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Plus_Jakarta_Sans } from 'next/font/google'
import { Link, useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { supabase } from '@/lib/supabase'
import {
  useCdiProfile,
  type CdiProfile,
  type CdiStatus,
  type CdiUser,
} from '@/lib/hooks/useCdiProfile'
import { useCdiApplications } from '@/lib/hooks/useCdiApplications'
import CdiStatusToggle from '@/components/cdi/CdiStatusToggle'
import CrossOpenToggle from '@/components/dashboard/CrossOpenToggle'
import AvatarUploadModal from '@/components/AvatarUploadModal'
import DndEmptyState from '@/components/dashboard/DndEmptyState'
import { deriveVerificationUiState } from '@/lib/verification-state'
import { emitAvailabilityChanged } from '@/lib/availability-actions'
import { useSecureFetch } from '@/lib/secure-fetch'
import {
  MATCHING_TRIGGER_FAST_POLL_MS,
  MATCHING_TRIGGER_NORMAL_POLL_MS,
  clearMatchingTrigger,
  isWithinMatchingWindow,
  markMatchingTriggered,
  readMatchingTrigger,
} from '@/lib/matching-resync-hint'
import MissionCastingCard from '@/components/dashboard/MissionCastingCard'
import CandidatureCastingCard from '@/components/dashboard/CandidatureCastingCard'
import CastingRow from '@/components/dashboard/CastingRow'
import type { MissionCardData } from '@/components/dashboard/MissionCard'
import { useLiveResource } from '@/hooks/useLiveResource'

/**
 * Dashboard CDI — page content (SC7a Lot UX Finitions 2).
 *
 * Le shell (sidebar + topbar) est désormais monté par cdi/layout.tsx via
 * DashboardShell side='cdi'. Cette page ne contient plus que le contenu
 * principal : greeting, status écoute marché, KPIs, complétion profil,
 * candidatures, suggestions.
 */

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
})

const fontJakarta = 'var(--font-jakarta), system-ui, sans-serif'

// Lot disponibilité : 2 statuts uniquement.
// 'employed' = "Ne pas déranger" (rouge — barrière matching + feed).
// 'open_to_work' = "À l'écoute du marché" (vert).
const STATUS_BADGE_COLORS: Record<CdiStatus, string> = {
  employed: '#ef4444',
  open_to_work: '#10b981',
}

// Champs essentiels pour le calcul de complétion (9 critères)
function calculateCompletion(profile: CdiProfile | null): number {
  if (!profile) return 0
  const fields = [
    !!profile.title?.trim(),
    !!profile.summary?.trim(),
    !!profile.branch_id,
    !!profile.speciality_id,
    (profile.skills?.length ?? 0) >= 3,
    !!profile.cdi_status,
    profile.cdi_salary_min != null,
    profile.cdi_salary_max != null,
    !!profile.cdi_notice_period,
  ]
  const filled = fields.filter(Boolean).length
  return Math.round((filled / fields.length) * 100)
}

function getGreetingName(user: CdiUser | null, fallback: string): string {
  if (!user) return fallback
  const first = user.first_name?.trim()
  if (first) return first
  const full = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()
  return full || fallback
}

function initialsOf(user: CdiUser | null): string {
  if (!user) return '?'
  const fn = (user.first_name ?? '').trim().charAt(0)
  const ln = (user.last_name ?? '').trim().charAt(0)
  return (fn + ln).toUpperCase() || '?'
}

export default function DashboardCDI() {
  const t = useTranslations('dashboard_cdi')
  const tc = useTranslations('missions.casting')
  const tProfile = useTranslations('cdi_profile_view')
  const router = useRouter()
  const domain = useDomain()
  const locale = useLocale()
  const state = useCdiProfile()
  const { loading, authenticated, forbidden, error, user, profile } = state
  const apps = useCdiApplications()

  // Suggestions pour vous — mirror EXACT du freelance home (useLiveResource
  // + slice(0,3) + holdNewItems=false). La route /api/me/missions est
  // user_type-agnostic au niveau du contrat : runMatching ne crée des
  // matches QUE pour le user_type cohérent (expert_cdi → type='offre').
  // Donc cette home reçoit les offres CDI matchées de l'expert.
  const isVerified = !!user?.is_verified
  // Lot bandeau vérif : état réel pour le badge greeting (plus de "vérifié"
  // affiché à tort quand en attente de validation admin).
  const isApprovedState =
    deriveVerificationUiState({
      visible: (profile?.visible ?? null) as boolean | null,
      verificationStatus: (profile?.verification_status ?? null) as string | null,
    }) === 'approved'
  // Lot UX refetch auto post-matching (parité freelance) : pendant la fenêtre
  // d'analyse (verified_at récent OU trigger client récent), on poll vite (3s)
  // et on affiche un état transitoire "Analyse en cours". Hors fenêtre = 30s.
  const [matchingTick, setMatchingTick] = useState<number>(() => Date.now())
  const lastTriggerMs = readMatchingTrigger(user?.id ?? null)
  const matchingInWindow = isWithinMatchingWindow({
    now: matchingTick,
    verifiedAt: (profile as { verified_at?: string | null } | null)?.verified_at ?? null,
    lastTriggerMs,
  })
  const missionsPollMs = matchingInWindow
    ? MATCHING_TRIGGER_FAST_POLL_MS
    : MATCHING_TRIGGER_NORMAL_POLL_MS

  // Lot A : `expert_status.is_dnd` pour l'empty-state rouge.
  const missionsLive = useLiveResource<
    {
      missions: MissionCardData[]
      expert_status?: { is_dnd: boolean }
    },
    MissionCardData
  >({
    url: isApprovedState ? `/api/me/missions?locale=${encodeURIComponent(locale)}` : null,
    pollMs: missionsPollMs,
    itemsOf: (d) => d.missions ?? [],
    identityOf: (m) => m.match_id,
    versionOf: (m) => `${m.ai_score}`,
    enabled: isApprovedState,
    holdNewItems: false,
  })
  // Casting home : on parcourt TOUTES les suggestions (carrousel sous
  // projecteur → ne rallonge pas le home). Plus de slice top-N.
  const recommendedOffres = useMemo(
    () => missionsLive.data?.missions ?? null,
    [missionsLive.data],
  )

  const [status, setStatus] = useState<CdiStatus | null>(null)
  const [statusUpdating, setStatusUpdating] = useState(false)
  // Ouverture croisée : voir aussi les missions freelance matchées (opt-in, défaut false).
  const [openToFreelance, setOpenToFreelance] = useState(false)
  const [crossOpenUpdating, setCrossOpenUpdating] = useState(false)
  const secureFetch = useSecureFetch()
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [avatarModalOpen, setAvatarModalOpen] = useState(false)

  // Sync local status from server
  useEffect(() => {
    setStatus(profile?.cdi_status ?? null)
  }, [profile?.cdi_status])

  // Sync ouverture croisée depuis le profil (défaut false).
  useEffect(() => {
    setOpenToFreelance(profile?.open_to_freelance === true)
  }, [profile?.open_to_freelance])

  // Lot global C1 : resync `status` quand le statut d'écoute change depuis
  // n'importe quelle surface (toggle, bouton "Réactiver" du DndEmptyState).
  // useCdiProfile ne refetch pas seul après une UPDATE supabase ; sans ce
  // listener, le toggle visuel resterait figé sur 'employed' jusqu'au reload.
  // On lit DIRECTEMENT cdi_status pour éviter de réécrire le hook entier.
  useEffect(() => {
    const refetchCdiStatus = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const { data } = await supabase
        .from('profiles')
        .select('cdi_status')
        .eq('user_id', session.user.id)
        .maybeSingle()
      const raw = (data as { cdi_status?: string | null } | null)?.cdi_status ?? null
      if (raw === 'employed' || raw === 'open_to_work') setStatus(raw)
    }
    const onAvailChanged = () => { void refetchCdiStatus() }
    window.addEventListener('sk:availability-changed', onAvailChanged)
    return () => { window.removeEventListener('sk:availability-changed', onAvailChanged) }
  }, [])


  // Redirect non-auth → /connexion
  useEffect(() => {
    if (!loading && !authenticated) {
      router.push('/connexion')
    }
  }, [loading, authenticated, router])

  // Toast auto-dismiss 3s
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(id)
  }, [toast])

  // Lot UX refetch auto post-matching : tick 3s pendant la fenêtre d'analyse
  // (re-évaluation de isWithinMatchingWindow), clear quand missions arrivent
  // ou que la fenêtre est écoulée.
  useEffect(() => {
    if (!matchingInWindow) {
      if (user?.id) clearMatchingTrigger(user.id)
      return
    }
    const id = window.setInterval(() => setMatchingTick(Date.now()), MATCHING_TRIGGER_FAST_POLL_MS)
    return () => window.clearInterval(id)
  }, [matchingInWindow, user?.id])

  const recommendedOffresLength = missionsLive.data?.missions?.length ?? 0
  useEffect(() => {
    if (recommendedOffresLength > 0 && user?.id) {
      clearMatchingTrigger(user.id)
      setMatchingTick(Date.now())
    }
  }, [recommendedOffresLength, user?.id])

  const handleStatusChange = async (next: CdiStatus) => {
    if (!user || !profile || statusUpdating || next === status) return
    const previous = status
    setStatus(next) // optimistic
    setStatusUpdating(true)
    try {
      const { error: upErr } = await supabase
        .from('profiles')
        .update({ cdi_status: next })
        .eq('user_id', user.id)
      if (upErr) {
        setStatus(previous) // rollback
        setToast({ type: 'error', text: t('toast.status_error') })
      } else {
        setToast({ type: 'success', text: t('toast.status_updated') })
        // Lot A : notifie la pill topbar ET les useLiveResource (mutate
        // /api/me/missions → home Suggestions + page Offres se mettent à
        // jour SANS reload. Toggle ↔ liste vidée/repeuplée, instantané).
        emitAvailabilityChanged()
        // Lot matching réconcilié : sortie du DND → ping sync-matching
        // côté serveur pour aligner les matches avec les offres publiées.
        if (next === 'open_to_work' && previous === 'employed') {
          if (user?.id) markMatchingTriggered(user.id)
          setMatchingTick(Date.now())
          void secureFetch('/api/me/sync-matching', { method: 'POST' }).catch((err) => {
            console.warn('[dashboard:cdi] sync-matching ping failed', err)
          })
        }
      }
    } catch {
      setStatus(previous)
      setToast({ type: 'error', text: t('toast.status_error') })
    } finally {
      setStatusUpdating(false)
    }
  }

  // Ouverture croisée : même pattern que le statut (write client-direct RLS +
  // relance matching, cooldown M2 hérité). Déclenché à CHAQUE bascule (on/off).
  const handleCrossOpenChange = async (next: boolean) => {
    if (!user || !profile || crossOpenUpdating || next === openToFreelance) return
    const previous = openToFreelance
    setOpenToFreelance(next) // optimistic
    setCrossOpenUpdating(true)
    try {
      const { error: upErr } = await supabase
        .from('profiles')
        .update({ open_to_freelance: next })
        .eq('user_id', user.id)
      if (upErr) {
        setOpenToFreelance(previous) // rollback
        setToast({ type: 'error', text: t('toast.status_error') })
      } else {
        setToast({ type: 'success', text: t('toast.status_updated') })
        // Le pool matching change → on relance et on rafraîchit le feed.
        emitAvailabilityChanged()
        markMatchingTriggered(user.id)
        setMatchingTick(Date.now())
        void secureFetch('/api/me/sync-matching', { method: 'POST' }).catch((err) => {
          console.warn('[dashboard:cdi] sync-matching ping failed (cross-open)', err)
        })
      }
    } catch {
      setOpenToFreelance(previous)
      setToast({ type: 'error', text: t('toast.status_error') })
    } finally {
      setCrossOpenUpdating(false)
    }
  }

  const completionPercent = useMemo(() => calculateCompletion(profile), [profile])

  // ----- LOADING / waiting auth ---------------------------------------------
  if (loading || (!authenticated && !error && !forbidden)) {
    return (
      <div className={jakarta.variable} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 360 }}>
        <style>{`@keyframes sk-spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 40, height: 40, borderRadius: '50%',
              border: `3px solid ${domain.primaryColor}22`, borderTopColor: domain.primaryColor,
              margin: '0 auto 12px', animation: 'sk-spin 0.9s linear infinite',
            }}
          />
          <div style={{ fontSize: 14, color: 'var(--sk-muted)' }}>{t('loading')}</div>
        </div>
      </div>
    )
  }

  // ----- FORBIDDEN ----------------------------------------------------------
  if (forbidden) {
    return (
      <div className={jakarta.variable} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, flex: 1, minHeight: 360 }}>
        <div style={{ background: 'var(--sk-surface)', border: '1px solid var(--sk-border)', borderRadius: 16, padding: 32, maxWidth: 440, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden>🔒</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--sk-text)', marginBottom: 8 }}>403</div>
          <button
            type="button"
            onClick={() => router.push('/')}
            style={{
              background: domain.primaryColor, color: '#fff', border: 'none',
              borderRadius: 10, padding: '10px 18px', fontSize: 14, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            ←
          </button>
        </div>
      </div>
    )
  }

  // isVerified déjà défini en début de fonction (utilisé par le hook live).
  const greetingName = getGreetingName(user, tProfile('fallback_user_name'))
  const currentStatus = status
  const statusBadgeColor = currentStatus ? STATUS_BADGE_COLORS[currentStatus] : null

  return (
    <div className={jakarta.variable} style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
        @keyframes sk-spin { to { transform: rotate(360deg); } }
        .stat-card {
          border-radius: 14px;
          padding: 18px 20px;
          background: #fff;
          border: 1px solid #e2e8f0;
          transition: transform 0.2s, box-shadow 0.2s;
          animation: fadeInUp 0.4s ease both;
        }
        .stat-card:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.06); }
        .main-card {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          padding: 22px 24px;
          margin-bottom: 16px;
          animation: fadeInUp 0.45s ease both;
        }
        .pulse-dot {
          width: 8px; height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
          animation: pulse 2s ease-in-out infinite;
        }
        .progress-bar {
          height: 8px;
          background: #f1f5f9;
          border-radius: 999px;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          border-radius: 999px;
          transition: width 1s ease;
        }
        @media (max-width: 767px) {
          /* Lot état 'selected' : 4 KPI — 2 colonnes en mobile. */
          .stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .greeting-row { flex-direction: column !important; align-items: flex-start !important; gap: 10px !important; }
          .verif-steps { flex-wrap: wrap !important; }
        }
        @media (min-width: 768px) {
          .stats-grid { grid-template-columns: repeat(4, 1fr) !important; }
        }
      `}</style>

      <div style={{ padding: 28 }}>

          {error && (
            <div
              role="alert"
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 12,
                padding: '12px 16px',
                marginBottom: 16,
                color: '#991b1b',
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              {error}
            </div>
          )}

          {/* SECTION 1 — Hello + verified badge inline + status badge.
              Lot A : tuile "Score IA" retirée (UI placeholder vide qui
              n'alimentait rien). On garde le layout greeting-row mais
              la colonne droite (score-box) n'existe plus. */}
          <div
            className="greeting-row"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              marginBottom: 22,
              gap: 16,
              animation: 'fadeInUp 0.4s ease',
            }}
          >
            <div>
              <h1
                style={{
                  fontSize: 26,
                  fontWeight: 800,
                  color: '#0f172a',
                  letterSpacing: '-0.4px',
                  fontFamily: fontJakarta,
                  marginBottom: 8,
                }}
              >
                {t('hello', { firstName: greetingName })}
              </h1>

              {/* Verified badge inline (parité freelance) — état réel */}
              {isApprovedState && (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    marginRight: 8,
                    animation: 'fadeIn 0.6s ease 0.3s both',
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <circle cx="12" cy="12" r="10" fill={domain.primaryColor} />
                    <path
                      d="M8 12l3 3 5-5"
                      stroke="white"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span
                    style={{ fontSize: 13, color: domain.primaryColor, fontWeight: 500 }}
                  >
                    {t('verified_badge')}
                  </span>
                </div>
              )}

              {/* Status écoute marché badge (existant) */}
              {currentStatus && statusBadgeColor && (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    background: `${statusBadgeColor}15`,
                    border: `1px solid ${statusBadgeColor}55`,
                    padding: '4px 10px',
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 600,
                    color: statusBadgeColor,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: statusBadgeColor,
                    }}
                    aria-hidden
                  />
                  <span>{tProfile(`status_badges.${currentStatus}`)}</span>
                </div>
              )}
            </div>

            {/* Lot A : tuile "Score IA" supprimée — voir commentaire en
                tête de SECTION 1. */}
          </div>

          {/* SECTION 2 — Hero "Statut écoute marché" */}
          <div className="main-card" style={{ animationDelay: '0.05s' }}>
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: '#0f172a',
                  letterSpacing: '-0.2px',
                  fontFamily: fontJakarta,
                  marginBottom: 6,
                }}
              >
                {t('market_status_card.title')}
              </div>
              <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.55 }}>
                {t('market_status_card.description')}
              </div>
            </div>
            <CdiStatusToggle
              value={currentStatus}
              onChange={handleStatusChange}
              disabled={statusUpdating || !profile || !isApprovedState}
            />
            <CrossOpenToggle
              checked={openToFreelance}
              onChange={handleCrossOpenChange}
              label={t('market_status_card.cross_open_label')}
              hint={t('market_status_card.cross_open_hint')}
              disabled={crossOpenUpdating || !profile || !isApprovedState}
              accentColor={domain.primaryColor}
            />
          </div>

          {/* SECTION 3 — KPIs (parité freelance, Lot état 'selected').
                Postulées / En discussion / Acceptées / Refusées.
                en_discussion = unlocked uniquement, retenues (label DB) = selected. */}
          <div
            className="stats-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 14,
              marginBottom: 16,
            }}
          >
            <KpiCard
              label={t('kpis.posted')}
              value={!isVerified ? '—' : apps.loading ? '…' : String(apps.postulees)}
              delay="0.1s"
              accentColor={domain.primaryColor}
              isPlaceholder={!isVerified}
            />
            <KpiCard
              label={t('kpis.in_discussion')}
              value={!isVerified ? '—' : apps.loading ? '…' : String(apps.en_discussion)}
              delay="0.13s"
              isPlaceholder={!isVerified}
            />
            <KpiCard
              label={t('kpis.retained')}
              value={!isVerified ? '—' : apps.loading ? '…' : String(apps.retenues)}
              delay="0.16s"
              accentColor="#D97706"
              isPlaceholder={!isVerified}
            />
            <KpiCard
              label={t('kpis.refused')}
              value={!isVerified ? '—' : apps.loading ? '…' : String(apps.refusees)}
              delay="0.2s"
              isPlaceholder={!isVerified}
            />
          </div>

          {/* SECTION 6 — Profil X% complet */}
          <div className="main-card" style={{ animationDelay: '0.25s', borderColor: `${domain.primaryColor}55` }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: '#0f172a',
                  fontFamily: fontJakarta,
                }}
              >
                {t('profile_completion.title', { percent: completionPercent })}
              </div>
              <Link
                href="/dashboard/cdi/mon-profil"
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: domain.primaryColor,
                  textDecoration: 'none',
                }}
              >
                {t('profile_completion.cta')}
              </Link>
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  background: `linear-gradient(90deg, ${domain.primaryColor}, ${domain.secondaryColor})`,
                  width: `${completionPercent}%`,
                }}
              />
            </div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 10, lineHeight: 1.55 }}>
              {t('profile_completion.hint')}
            </div>
          </div>

          {/* SECTION — Suggestions pour vous (REORDONNEE : au-dessus de
              Mes candidatures, parite home freelance). Cablée sur
              /api/me/missions via useLiveResource (mirror exact freelance).
              CHECK : MissionCastingCard side='cdi' route ses liens vers
              /dashboard/cdi/missions/[id] (cf. dashboardUrlForUserType
              implicit via side prop). Le 'Voir tout' pointe vers
              /dashboard/cdi/missions (page "Offres" du CDI). */}
          {/* Suggestions — section TOUJOURS visible (parité avec les autres
              cartes ET avec la home freelance). Si non approuvé : état vide
              "profil pas encore validé", JAMAIS le cache périmé (le fetch reste
              gated sur isApprovedState = verification_status === 'approved'). */}
          <div className="main-card" style={{ animationDelay: '0.3s' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.2px', fontFamily: fontJakarta }}>
                  {t('suggestions_section.title')}
                </span>
                <span style={{ background: '#ede9fe', color: '#6d28d9', fontSize: 12, fontWeight: 500, padding: '4px 12px', borderRadius: 20 }}>
                  {t('suggestions_section.ai_badge')}
                </span>
              </div>
              <Link href="/dashboard/cdi/missions" style={{ color: domain.primaryColor, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>{t('suggestions_section.see_all')}</Link>
            </div>
            {!isApprovedState ? (
              <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 22, textAlign: 'center', fontSize: 14, color: '#9ca3af', lineHeight: 1.8 }}>
                {t('suggestions_section.empty_unverified')}
              </div>
            ) : (recommendedOffres === null) ? (
              <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 22, textAlign: 'center', fontSize: 14, color: '#9ca3af' }}>
                {t('loading')}
              </div>
            ) : recommendedOffres.length === 0 ? (
              // 3 empty-states distincts (priorité explicite, parité freelance) :
              //   DND ('employed') → ROUGE + bouton "Repasser À l'écoute" (Lot A).
              //   matching IA en cours (fenêtre <120s) → état TRANSITOIRE
              //     "Analyse en cours…" (Lot UX refetch auto).
              //   sinon 0 match → GRIS neutre.
              missionsLive.data?.expert_status?.is_dnd && user?.id ? (
                <DndEmptyState side="cdi" userId={user.id} />
              ) : matchingInWindow ? (
                <div
                  role="status"
                  aria-live="polite"
                  style={{
                    background: '#f9fafb',
                    border: '1px solid #e5e7eb',
                    borderRadius: 10,
                    padding: 22,
                    textAlign: 'center',
                    fontSize: 14,
                    color: '#475569',
                    lineHeight: 1.8,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 18,
                      height: 18,
                      border: `2px solid ${domain.primaryColor}44`,
                      borderTopColor: domain.primaryColor,
                      borderRadius: '50%',
                      animation: 'sk-spin 0.8s linear infinite',
                    }}
                  />
                  <span>{t('suggestions_section.analyzing', { ecosystem: domain.ecosystemName })}</span>
                  <style>{`@keyframes sk-spin { to { transform: rotate(360deg) } }`}</style>
                </div>
              ) : (
                <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 22, textAlign: 'center', fontSize: 14, color: '#9ca3af', lineHeight: 1.8 }}>
                  {t('suggestions_section.empty_verified')}
                </div>
              )
            ) : (
              <CastingRow<MissionCardData>
                items={recommendedOffres}
                getKey={(m) => m.match_id}
                labels={{ prevAria: tc('prev_aria'), nextAria: tc('next_aria'), empty: tc('empty') }}
                renderItem={(m) => <MissionCastingCard mission={m} side="cdi" />}
              />
            )}
          </div>

          {/* SECTION — Mes candidatures (apres Suggestions, parite freelance). */}
          <div className="main-card" style={{ animationDelay: '0.35s' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 14,
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: '#0f172a',
                  letterSpacing: '-0.2px',
                  fontFamily: fontJakarta,
                }}
              >
                {t('applications_section.title')}
              </div>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: domain.primaryColor,
                  cursor: 'not-allowed',
                  opacity: 0.6,
                }}
                title="V1 — placeholder"
              >
                {t('applications_section.view_opportunities_cta')}
              </span>
            </div>
            {apps.loading ? (
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: 20,
                  textAlign: 'center',
                  fontSize: 14,
                  color: '#94a3b8',
                }}
              >
                {t('loading')}
              </div>
            ) : apps.count === 0 ? (
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px dashed #cbd5e1',
                  borderRadius: 10,
                  padding: 22,
                  textAlign: 'center',
                  fontSize: 14,
                  color: '#64748b',
                  lineHeight: 1.6,
                }}
              >
                {t('applications_section.empty_state')}
              </div>
            ) : (
              <CastingRow
                items={apps.items}
                getKey={(item) => item.id}
                labels={{ prevAria: tc('prev_aria'), nextAria: tc('next_aria'), empty: tc('empty') }}
                renderItem={(item) => (
                  <CandidatureCastingCard
                    side="cdi"
                    candidature={{
                      id: item.id,
                      publication: item.publication,
                      org: item.org,
                      skills_required: item.skills_required,
                      status: item.status ?? '',
                      viewed_by_me: item.viewed_by_me,
                    }}
                  />
                )}
              />
            )}
          </div>
      </div>

      {/* Avatar upload modal — réutilise le composant freelance.
          NOTE: AvatarUploadModal utilise en interne useTranslations
          ('dashboard_freelance.avatar_modal') — cross-namespace accepté
          pour V1. À factoriser au merge V1+V3 (namespace en prop). */}
      <AvatarUploadModal
        open={avatarModalOpen}
        onClose={() => setAvatarModalOpen(false)}
        onSaved={() => setToast({ type: 'success', text: t('toast.photo_updated') })}
      />

      {/* TOAST top-right */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: 76,
            right: 24,
            zIndex: 1001,
            background: toast.type === 'success' ? '#dcfce7' : '#fef2f2',
            border: `1px solid ${toast.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
            color: toast.type === 'success' ? '#15803d' : '#991b1b',
            padding: '12px 18px',
            borderRadius: 12,
            fontSize: 14,
            fontWeight: 600,
            boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            animation: 'fadeInUp 0.3s ease',
          }}
        >
          <span aria-hidden>{toast.type === 'success' ? '✓' : '⚠'}</span>
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  )
}

// =========================================================================
// KPI Card
// =========================================================================
function KpiCard({
  label,
  value,
  delay,
  isPlaceholder = false,
  accentColor,
}: {
  label: string
  value: string
  delay: string
  isPlaceholder?: boolean
  accentColor?: string
}) {
  return (
    <div className="stat-card" style={{ animationDelay: delay }}>
      <div
        style={{
          fontSize: 12,
          color: '#64748b',
          fontWeight: 600,
          marginBottom: 8,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 800,
          color: isPlaceholder ? '#cbd5e1' : (accentColor ?? '#0f172a'),
          fontFamily: fontJakarta,
          letterSpacing: '-0.5px',
        }}
      >
        {value}
      </div>
    </div>
  )
}
