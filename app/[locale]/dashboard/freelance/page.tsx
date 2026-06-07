'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { useDomain } from '@/context/DomainContext'
import TJMQuickEditModal from '@/components/TJMQuickEditModal'
import AvatarUploadModal from '@/components/AvatarUploadModal'
import VerificationBanner from '@/components/dashboard/VerificationBanner'
import { useLiveResource } from '@/hooks/useLiveResource'
import MissionMiniCard from '@/components/dashboard/MissionMiniCard'
import CandidatureMiniCard from '@/components/dashboard/CandidatureMiniCard'
import type { MissionCardData } from '@/components/dashboard/MissionCard'
import AvailabilityToggle, {
  type AvailabilityStatus,
} from '@/components/freelance/AvailabilityToggle'

type ProfileData = {
  tjm_min: number | null
  tjm_max: number | null
  photo_url: string | null
  verification_status?: string | null
  review_reason?: string | null
  verification_data?: Record<string, unknown> | null
  availability_status?: string | null
}

/**
 * Calcul léger de complétude profil (Lot nettoyage).
 *
 *  Règle :
 *   - Si verification_status='approved' (côté caller) → 100% (le profil est
 *     déjà passé par la gate IA, garanti complet).
 *   - Sinon : signal pragmatique basé sur les champs critiques côté user/profile.
 *
 *  À l'avenir on pourra le brancher sur `profiles.profile_score` (déjà existant
 *  en BDD). Pour V1 c'est un placeholder lisible plutôt que 0% systématique.
 */
function computeCompletionPct(user: any, profile: ProfileData | null): number {
  if (!user || !profile) return 0
  const fields: Array<unknown> = [
    user.first_name, user.last_name, user.email, user.phone,
    profile.tjm_min ?? profile.tjm_max,
    profile.photo_url,
  ]
  const filled = fields.filter(v => v != null && String(v).trim() !== '').length
  const pct = Math.round((filled / fields.length) * 100)
  return Math.max(0, Math.min(100, pct))
}

export default function DashboardFreelance() {
  const t = useTranslations('dashboard_freelance')
  const tCommon = useTranslations('common')
  const locale = useLocale()
  const router = useRouter()
  const domain = useDomain()
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tjmModalOpen, setTjmModalOpen] = useState(false)
  const [avatarModalOpen, setAvatarModalOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  // Lot disponibilité : mirror local de profiles.availability_status pour
  // l'update optimiste depuis AvailabilityToggle. Réécrit serveur via
  // supabase.from('profiles').update() (RLS — l'expert n'écrit que son
  // propre profil). La barrière matching/feed est appliquée côté serveur
  // (lib/matching/index.ts + /api/me/missions).
  const [availability, setAvailability] = useState<AvailabilityStatus | null>(null)
  const [availabilityUpdating, setAvailabilityUpdating] = useState(false)

  // Types minimaux pour les ressources live.
  type CandidatureLite = {
    id: string
    publication_id: string
    publication: { id: string; type: string; title: string; status: string } | null
    status: string
    ai_match_score: number | null
    conversation_id: string | null
    created_at: string
  }
  // Lot polish UX SC5 : on utilise MissionCardData (déjà aligné sur la
  // PublicationSynthesis renvoyée par /api/me/missions).
  type RecommendedMission = MissionCardData

  // Lot polish UX — useLiveResource × 3 (missions, candidatures, conversations).
  // - Loading affiché UNIQUEMENT au 1er mount (data en cache préservée pendant
  //   les revalidations → fin du flicker home).
  // - holdNewItems=false ici : la home doit refléter en direct (compteurs,
  //   missions recommandées top 3).
  // - Le calcul des stats est ensuite dérivé via useMemo : pas de nouvelle
  //   réf si data inchangée.
  const liveEnabled = !loading
  const missionsLive = useLiveResource<{ missions: RecommendedMission[] }, RecommendedMission>({
    url: liveEnabled ? `/api/me/missions?locale=${encodeURIComponent(locale)}` : null,
    itemsOf: (d) => d.missions ?? [],
    identityOf: (m) => m.match_id,
    versionOf: (m) => `${m.ai_score}`,
    enabled: liveEnabled,
    holdNewItems: false,
  })
  const candidaturesLive = useLiveResource<{ candidatures: CandidatureLite[] }, CandidatureLite>({
    url: liveEnabled ? '/api/me/candidatures' : null,
    itemsOf: (d) => d.candidatures ?? [],
    identityOf: (c) => c.id,
    versionOf: (c) => `${c.status}|${c.conversation_id ?? ''}`,
    enabled: liveEnabled,
    holdNewItems: false,
  })
  const conversationsLive = useLiveResource<{ conversations: { unread_count: number }[] }, { unread_count: number }>({
    url: liveEnabled ? '/api/me/conversations' : null,
    itemsOf: () => null,    // pas de diff par item — on lit l'agrégat unread
    identityOf: () => '',
    enabled: liveEnabled,
  })

  // Dérivation memo : stats / recentCandidatures / recommendedMissions.
  const missions = missionsLive.data?.missions ?? null
  const candidaturesAll = candidaturesLive.data?.candidatures ?? null
  const conversations = conversationsLive.data?.conversations ?? null

  const recommendedMissions = useMemo(() => missions === null ? null : missions.slice(0, 3), [missions])
  const recentCandidatures = useMemo(() => candidaturesAll === null ? null : candidaturesAll.slice(0, 3), [candidaturesAll])
  const stats = useMemo(() => {
    if (missions === null && candidaturesAll === null && conversations === null) {
      return {
        missions_count: null, candidatures_count: null, postulees: null,
        en_discussion: null, retenues: null, refusees: null, messages_unread: null,
        completion_pct: null,
      } as const
    }
    // Lot état 'selected' :
    //   en_discussion = UNLOCKED uniquement (l'expert et l'org échangent).
    //                   in_review / shortlisted = encore "en attente côté org"
    //                   → ne comptent plus comme "en discussion" V1.
    //   retenues      = SELECTED uniquement (l'expert a été retenu).
    //   refusees      = REJECTED (inchangé).
    let postulees = 0, enDiscussion = 0, retenues = 0, refusees = 0
    if (candidaturesAll) {
      postulees = candidaturesAll.length
      for (const c of candidaturesAll) {
        if (c.status === 'unlocked') enDiscussion++
        else if (c.status === 'selected') retenues++
        else if (c.status === 'rejected') refusees++
      }
    }
    const unread = (conversations ?? []).reduce((acc, c) => acc + (c.unread_count ?? 0), 0)
    const isApproved = (profile?.verification_status ?? null) === 'approved'
    const completion = isApproved ? 100 : computeCompletionPct(user, profile)
    return {
      missions_count: missions?.length ?? null,
      candidatures_count: candidaturesAll?.length ?? null,
      postulees: candidaturesAll === null ? null : postulees,
      en_discussion: candidaturesAll === null ? null : enDiscussion,
      retenues: candidaturesAll === null ? null : retenues,
      refusees: candidaturesAll === null ? null : refusees,
      messages_unread: conversations === null ? null : unread,
      completion_pct: completion,
    } as const
  }, [missions, candidaturesAll, conversations, user, profile])

  useEffect(() => {
    const getUser = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/connexion')
        return
      }
      const [{ data: userData }, { data: profileData }] = await Promise.all([
        supabase
          .from('users')
          .select('*, domains(slug, name)')
          .eq('id', session.user.id)
          .single(),
        supabase
          .from('profiles')
          .select('tjm_min, tjm_max, photo_url, verification_status, review_reason, verification_data, availability_status')
          .eq('user_id', session.user.id)
          .maybeSingle(),
      ])
      setUser(userData)
      setProfile(profileData ?? { tjm_min: null, tjm_max: null, photo_url: null })
      // Init local availability — coalesce vers 'available' (défaut produit).
      const rawAvail = (profileData as { availability_status?: string | null } | null)?.availability_status ?? null
      const safeAvail: AvailabilityStatus =
        rawAvail === 'do_not_disturb' ? 'do_not_disturb' : 'available'
      setAvailability(safeAvail)
      setLoading(false)
    }
    getUser()
  }, [])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(id)
  }, [toast])

  const handleAvailabilityChange = async (next: AvailabilityStatus) => {
    if (!user || availabilityUpdating || next === availability) return
    const previous = availability
    setAvailability(next) // optimistic
    setAvailabilityUpdating(true)
    try {
      const { error: upErr } = await supabase
        .from('profiles')
        .update({ availability_status: next })
        .eq('user_id', user.id)
      if (upErr) {
        setAvailability(previous) // rollback
        setToast(t('availability_card.toast_error'))
      } else {
        setToast(t('availability_card.toast_updated'))
        // Notifie DashboardShell pour rafraîchir la pill topbar.
        try {
          window.dispatchEvent(new CustomEvent('sk:availability-changed'))
        } catch { /* SSR-safe noop */ }
      }
    } catch {
      setAvailability(previous)
      setToast(t('availability_card.toast_error'))
    } finally {
      setAvailabilityUpdating(false)
    }
  }

  // Câblage compteurs home + Missions recommandées — Lot polish UX.
  //  Les 3 ressources (missions/candidatures/conversations) sont gérées par
  //  useLiveResource × 3 (SWR + dedup + revalidate focus + bump). Les stats
  //  sont dérivées via useMemo : aucune nouvelle référence si data inchangée.
  //  Plus de useEffect manuel.

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', fontSize: 16, color: '#6b7280' }}>
      {t('loading')}
    </div>
  )

  const isVerified = user?.is_verified === true
  const firstName = (user?.first_name ?? '').trim()
  const lastName = (user?.last_name ?? '').trim()
  const fullName = `${firstName} ${lastName}`.trim() || tCommon('user_fallback')
  const initials =
    ((firstName[0] ?? '') + (lastName[0] ?? '')).toUpperCase() ||
    fullName.substring(0, 2).toUpperCase() ||
    '??'

  return (
    <div style={{ fontFamily: 'inherit' }}>

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.95); }
        }
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-16px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes countUp {
          from { opacity: 0; transform: scale(0.7); }
          to { opacity: 1; transform: scale(1); }
        }
        .nav-item {
          padding: 11px 16px;
          font-size: 14px;
          color: #4b5563;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-radius: 8px;
          margin: 2px 8px;
          transition: background 0.18s, transform 0.18s;
          animation: slideInLeft 0.35s ease both;
        }
        .nav-item:hover { background: #f9fafb; transform: translateX(4px); }
        .nav-item-active {
          padding: 11px 16px;
          font-size: 14px;
          color: #111827;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-radius: 8px;
          margin: 2px 8px;
          background: #f3f4f6;
          font-weight: 500;
          animation: slideInLeft 0.35s ease both;
        }
        .stat-card {
          border-radius: 12px;
          padding: 20px 22px;
          transition: transform 0.22s, box-shadow 0.22s;
          animation: fadeInUp 0.5s ease both;
          cursor: default;
        }
        .stat-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 8px 24px rgba(0,0,0,0.09);
        }
        .main-card {
          background: #fff;
          border-radius: 14px;
          border: 1px solid #e5e7eb;
          padding: 22px 26px;
          margin-bottom: 18px;
          animation: fadeInUp 0.5s ease both;
          transition: box-shadow 0.2s;
        }
        .main-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
        .voir-tout {
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: transform 0.18s, opacity 0.18s;
          display: inline-block;
          text-decoration: none;
        }
        .voir-tout:hover { transform: translateX(4px); opacity: 0.75; }
        .pulse-dot {
          width: 8px; height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
          animation: pulse 2s ease-in-out infinite;
        }
        .avatar {
          width: 76px; height: 76px;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 26px; font-weight: 600;
          margin: 0 auto;
          transition: transform 0.3s;
          animation: fadeIn 0.5s ease;
        }
        .avatar:hover { transform: scale(1.06); }
        .score-box {
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          padding: 16px 22px;
          text-align: center;
          min-width: 104px;
          animation: fadeIn 0.5s ease 0.1s both;
          transition: box-shadow 0.2s, transform 0.2s;
        }
        .score-box:hover { box-shadow: 0 6px 20px rgba(0,0,0,0.08); transform: translateY(-2px); }
        .progress-bar { height: 7px; background: #f3f4f6; border-radius: 10px; overflow: hidden; }
        .progress-fill {
          height: 100%;
          border-radius: 10px;
          transition: width 1.2s ease;
        }
        @media (max-width: 767px) {
          .dashboard-layout { flex-direction: column !important; }
          .dashboard-sidebar { display: none !important; }
          .dashboard-main { padding: 20px !important; }
          /* Lot état 'selected' : 5 tuiles (4 KPI + TJM) — 2 colonnes en mobile. */
          .stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (min-width: 768px) and (max-width: 1099px) {
          /* Tablette : 3 colonnes pour éviter l'écrasement à 5×~150px. */
          .stats-grid { grid-template-columns: repeat(3, 1fr) !important; }
        }
        @media (min-width: 768px) {
          .dashboard-layout { flex-direction: row !important; }
          .dashboard-sidebar { display: flex !important; }
        }
      `}</style>

      {/* Lot refonte UX : sidebar + topbar centralisées dans DashboardShell
          (sub-layout parent freelance/layout.tsx). Cette page ne rend plus
          que le CONTENU central. */}

        <div style={{ padding: '24px 26px', minWidth: 0 }}>

          {/* Bandeau statut vérification expert (Lot vérif expert) */}
          <VerificationBanner
            status={(profile?.verification_status ?? null) as string | null}
            reviewReason={(profile?.review_reason ?? null) as string | null}
          />

          {/* Titre + Score IA */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 26, animation: 'fadeInUp 0.4s ease' }}>
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 700, color: '#111827', marginBottom: 8 }}>{t('greeting')}</h1>
              {isVerified && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, animation: 'fadeIn 0.6s ease 0.3s both' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" fill={domain.primaryColor}/>
                    <path d="M8 12l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span style={{ fontSize: 13, color: domain.primaryColor, fontWeight: 500 }}>{t('verified_badge')}</span>
                </div>
              )}
            </div>
            <div className="score-box">
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>{t('ai_score.label')}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: domain.primaryColor }}>—</div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>{t('ai_score.empty')}</div>
            </div>
          </div>

          {/* Bannière vérification */}
          {!isVerified && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: 20, marginBottom: 20, animation: 'fadeInUp 0.4s ease' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div style={{ fontSize: 22, flexShrink: 0 }}>⏳</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#92400e', marginBottom: 6 }}>{t('verification_banner.title')}</div>
                  <div style={{ fontSize: 13, color: '#92400e', opacity: .8, lineHeight: 1.7, marginBottom: 12 }}>
                    {t.rich('verification_banner.description', {
                      strong: chunks => <strong>{chunks}</strong>,
                    })}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {[
                      { label: t('verification_banner.steps.account_created'), done: true },
                      { label: t('verification_banner.steps.ai_analysis'), active: true },
                      { label: t('verification_banner.steps.verified_badge'), done: false },
                    ].map((step, i) => (
                      <div key={step.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {i > 0 && <span style={{ color: '#d1d5db', fontSize: 13 }}>→</span>}
                        <span style={{ fontSize: 13, color: step.active ? domain.primaryColor : step.done ? '#92400e' : '#9ca3af', fontWeight: step.active ? 500 : 400 }}>
                          {step.done ? '✓ ' : step.active ? '⏳ ' : ''}{step.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <button onClick={() => router.push('/dashboard/freelance/profil')} style={{ marginTop: 14, fontSize: 13, fontWeight: 600, padding: '9px 16px', borderRadius: 8, background: '#fff', border: '1px solid #fde68a', color: '#92400e', cursor: 'pointer', width: '100%' }}>
                {t('verification_banner.cta')}
              </button>
            </div>
          )}

          {/* Lot état 'selected' : 4 stat-cards de comptage (Postulées, En
              discussion, Retenues, Refusées) + TJM card = 5 tuiles total. La
              media query .stats-grid bascule en grid auto-fit min 140 sur
              mobile pour rester lisible (cf. styles ci-dessous). */}
          <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 22 }}>
            {[
              { label: t('stats.posted'),        value: !isVerified ? '—' : (stats.postulees ?? '…').toString(),      delay: '0.1s'  },
              { label: t('stats.in_discussion'), value: !isVerified ? '—' : (stats.en_discussion ?? '…').toString(), delay: '0.13s' },
              { label: t('stats.retained'),      value: !isVerified ? '—' : (stats.retenues ?? '…').toString(),      delay: '0.15s', accent: '#D97706' },
              { label: t('stats.refused'),       value: !isVerified ? '—' : (stats.refusees ?? '…').toString(),       delay: '0.17s' },
            ].map((stat) => (
              <div key={stat.label} className="stat-card" style={{ background: '#f3f4f6', animationDelay: stat.delay }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>{stat.label}</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: !isVerified ? '#d1d5db' : (stat.accent ?? '#111827'), animation: `countUp 0.5s ease ${stat.delay} both` }}>{stat.value}</div>
              </div>
            ))}
            <div className="stat-card" style={{ background: '#fff', border: `1px solid ${domain.primaryColor}55`, animationDelay: '0.25s' }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>{t('stats.daily_rate')}</div>
              <div style={{ fontSize: profile?.tjm_min != null && profile?.tjm_max != null ? 18 : 24, fontWeight: 700, color: domain.primaryColor }}>
                {profile?.tjm_min != null && profile?.tjm_max != null
                  ? t('stats.daily_rate_range', { min: profile.tjm_min, max: profile.tjm_max })
                  : '— €'}
              </div>
              <button
                type="button"
                onClick={() => setTjmModalOpen(true)}
                style={{ background: 'transparent', border: 'none', padding: 0, fontSize: 12, color: domain.primaryColor, cursor: 'pointer', marginTop: 6, fontFamily: 'inherit', fontWeight: 500 }}
              >
                {t('stats.daily_rate_set')}
              </button>
            </div>
          </div>

          {/* Lot disponibilité — Hero "Disponibilité" (miroir CDI market_status_card).
              Écrit profiles.availability_status. La barrière matching/feed est
              appliquée côté serveur (lib/matching/index.ts + /api/me/missions). */}
          <div className="main-card" style={{ animationDelay: '0.28s' }}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#111827', marginBottom: 6 }}>
                {t('availability_card.title')}
              </div>
              <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.55 }}>
                {t('availability_card.description')}
              </div>
            </div>
            <AvailabilityToggle
              value={availability}
              onChange={handleAvailabilityChange}
              disabled={availabilityUpdating || !user}
            />
          </div>

          {/* Complétion profil */}
          <div className="main-card" style={{ borderColor: `${domain.primaryColor}55`, animationDelay: '0.3s' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>
                {t('completion.title', { percent: stats.completion_pct ?? 0 })}
              </div>
              <Link href="/dashboard/freelance/profil/valider" className="voir-tout" style={{ color: domain.primaryColor }}>{t('completion.cta')}</Link>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ background: `linear-gradient(90deg, ${domain.primaryColor}, ${domain.secondaryColor})`, width: `${stats.completion_pct ?? 0}%` }}></div>
            </div>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 10, lineHeight: 1.6 }}>{t('completion.hint')}</div>
          </div>

          {/* Missions recommandées */}
          <div className="main-card" style={{ opacity: isVerified ? 1 : 0.6, animationDelay: '0.35s' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>{t('cards.recommended_missions.title')}</span>
                <span style={{ background: '#ede9fe', color: '#6d28d9', fontSize: 12, fontWeight: 500, padding: '4px 12px', borderRadius: 20 }}>{t('cards.recommended_missions.ai_badge')}</span>
              </div>
              {!isVerified
                ? <span style={{ background: '#f3f4f6', color: '#9ca3af', fontSize: 12, padding: '4px 10px', borderRadius: 20 }}>{t('cards.locked_chip')}</span>
                : <Link href="/dashboard/freelance/missions" className="voir-tout" style={{ color: domain.primaryColor }}>{t('cards.see_all')}</Link>
              }
            </div>
            {!isVerified ? (
              <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 22, textAlign: 'center', fontSize: 14, color: '#9ca3af', lineHeight: 1.8 }}>
                {t('cards.empty_unverified')}
              </div>
            ) : (recommendedMissions === null) ? (
              <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 22, textAlign: 'center', fontSize: 14, color: '#9ca3af' }}>
                {t('loading')}
              </div>
            ) : recommendedMissions.length === 0 ? (
              <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 22, textAlign: 'center', fontSize: 14, color: '#9ca3af', lineHeight: 1.8 }}>
                {t('cards.recommended_missions.empty_verified', { ecosystem: domain.ecosystemName })}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {recommendedMissions.map((m) => (
                  <MissionMiniCard key={m.match_id} mission={m} side="freelance" />
                ))}
              </div>
            )}
          </div>

          {/* SC2 — Section "Vos candidatures" (3 dernières) */}
          {isVerified && (
            <div className="main-card" style={{ animationDelay: '0.38s' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>{t('cards.your_candidatures.title')}</span>
                <Link href="/dashboard/freelance/candidatures" className="voir-tout" style={{ color: domain.primaryColor }}>{t('cards.see_all')}</Link>
              </div>
              {recentCandidatures === null ? (
                <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 22, textAlign: 'center', fontSize: 14, color: '#9ca3af' }}>
                  {t('loading')}
                </div>
              ) : recentCandidatures.length === 0 ? (
                <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 22, textAlign: 'center', fontSize: 14, color: '#9ca3af', lineHeight: 1.8 }}>
                  {t('cards.your_candidatures.empty')}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {recentCandidatures.map((c) => (
                    <CandidatureMiniCard key={c.id} candidature={c} side="freelance" />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Collaboration experts */}
          <div className="main-card" style={{ opacity: isVerified ? 1 : 0.6, marginBottom: 0, animationDelay: '0.4s' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>{t('cards.expert_collaboration.title')}</span>
                <span style={{ background: '#dcfce7', color: '#15803d', fontSize: 12, fontWeight: 500, padding: '4px 12px', borderRadius: 20 }}>{t('cards.expert_collaboration.new_badge')}</span>
              </div>
              {!isVerified
                ? <span style={{ background: '#f3f4f6', color: '#9ca3af', fontSize: 12, padding: '4px 10px', borderRadius: 20 }}>{t('cards.locked_chip')}</span>
                : <span className="voir-tout" style={{ color: domain.primaryColor }}>{t('cards.see_all')}</span>
              }
            </div>
            <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 22, textAlign: 'center', fontSize: 14, color: '#9ca3af', lineHeight: 1.8 }}>
              {isVerified ? t('cards.expert_collaboration.empty_verified') : t('cards.empty_unverified')}
            </div>
          </div>

        </div>

      <TJMQuickEditModal
        open={tjmModalOpen}
        initialMin={profile?.tjm_min ?? null}
        initialMax={profile?.tjm_max ?? null}
        onClose={() => setTjmModalOpen(false)}
        onSaved={(newMin, newMax) => {
          setProfile(prev => ({
            ...(prev ?? { tjm_min: null, tjm_max: null, photo_url: null }),
            tjm_min: newMin,
            tjm_max: newMax,
          }))
          setToast(t('tjm_modal.success'))
        }}
      />

      <AvatarUploadModal
        open={avatarModalOpen}
        currentPhotoUrl={profile?.photo_url ?? null}
        onClose={() => setAvatarModalOpen(false)}
        onSaved={newUrl => {
          setProfile(prev => ({
            ...(prev ?? { tjm_min: null, tjm_max: null, photo_url: null }),
            photo_url: newUrl,
          }))
          setToast(t('avatar_modal.success'))
        }}
      />

      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: 76,
            right: 24,
            zIndex: 1001,
            background: '#dcfce7',
            border: '1px solid #bbf7d0',
            color: '#15803d',
            padding: '12px 18px',
            borderRadius: 12,
            fontSize: 14,
            fontWeight: 600,
            boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
            animation: 'fadeInUp 0.3s ease',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>✓</span>
          <span>{toast}</span>
        </div>
      )}
    </div>
  )
}
