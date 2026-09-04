'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import ProfilMasqueBanner from '@/components/profile/ProfilMasqueBanner'
import { Link, useRouter } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { useDomain } from '@/context/DomainContext'
import TJMQuickEditModal from '@/components/TJMQuickEditModal'
import AvatarUploadModal from '@/components/AvatarUploadModal'
import { deriveVerificationUiState } from '@/lib/verification-state'
import VerificationStatusPill from '@/components/dashboard/VerificationStatusPill'
import ExpertOnboardingGuide from '@/components/dashboard/ExpertOnboardingGuide'
import CollaborationDashboardBlock from '@/components/dashboard/CollaborationDashboardBlock'
import { useLiveResource } from '@/hooks/useLiveResource'
import MissionCastingCard from '@/components/dashboard/MissionCastingCard'
import CandidatureCastingCard from '@/components/dashboard/CandidatureCastingCard'
import CastingRow from '@/components/dashboard/CastingRow'
import type { MissionCardData } from '@/components/dashboard/MissionCard'
import {
  useExpertApplications,
  type ExpertApplicationItem,
} from '@/lib/hooks/useExpertApplications'
import AvailabilityToggle, {
  type AvailabilityStatus,
} from '@/components/freelance/AvailabilityToggle'
import DndEmptyState from '@/components/dashboard/DndEmptyState'
import CrossOpenToggle from '@/components/dashboard/CrossOpenToggle'
import { useMatchingAnalyzing } from '@/hooks/useMatchingAnalyzing'
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

type ProfileData = {
  tjm_min: number | null
  tjm_max: number | null
  photo_url: string | null
  visible?: boolean | null
  verification_status?: string | null
  verification_data?: Record<string, unknown> | null
  availability_status?: string | null
  /** Ouverture croisée : voir aussi les offres CDI matchées (opt-in, défaut false). */
  open_to_cdi?: boolean | null
  /** ISO timestamp d'approbation (auto-approve inline OU admin). Sert au
   *  flag "matching en cours" pendant la fenêtre post-approbation (Lot
   *  UX refetch auto). */
  verified_at?: string | null
  // Champs de CONTENU pour le calcul de complétion (C2). Optionnels : les
  // fallbacks partiels ({tjm_min,tjm_max,photo_url}) restent valides.
  cv_parsing_status?: string | null
  title?: string | null
  summary?: string | null
  branch_id?: string | null
  speciality_ids?: string[] | null
  seniorities?: string[] | null
  work_zone_ids?: string[] | null
  skills?: string[] | null
  languages?: string[] | null
}

/**
 * Complétude RÉELLE du profil (C2). Recalibrée : ne compte QUE les blocs de
 * CONTENU nécessaires à la publication — jamais les champs d'identité remplis
 * à l'inscription (nom, email, téléphone) qui gonflaient le score à 67 % sur un
 * profil vide. Parité STRICTE avec la home CDI (mêmes 8 critères, compensation
 * spécifique au format). Un compte neuf → 0 % ; 100 % quand tout est prêt.
 *
 *  Règle caller : si verification_status='approved' → 100 % (déjà passé la gate).
 */
function computeCompletionPct(profile: ProfileData | null): number {
  if (!profile) return 0
  const fields = [
    profile.cv_parsing_status === 'done',                 // CV parsé
    !!profile.title?.trim(),                              // Titre
    !!profile.summary?.trim(),                            // Résumé
    !!profile.branch_id,                                  // Branche
    (profile.speciality_ids?.length ?? 0) >= 1,           // Spécialités
    (profile.seniorities?.length ?? 0) >= 1,              // Séniorités
    (profile.work_zone_ids?.length ?? 0) >= 1,            // Zones de travail
    (profile.skills?.length ?? 0) >= 3,                   // Compétences
    (profile.languages?.length ?? 0) >= 1,                // Langues
    profile.tjm_min != null && profile.tjm_max != null,   // Compensation (TJM)
  ]
  const filled = fields.filter(Boolean).length
  return Math.round((filled / fields.length) * 100)
}

export default function DashboardFreelance() {
  const t = useTranslations('dashboard_freelance')
  const tCommon = useTranslations('common')
  const tc = useTranslations('missions.casting')
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
  // Ouverture croisée : voir aussi les offres CDI matchées (opt-in, défaut false).
  const [openToCdi, setOpenToCdi] = useState(false)
  const [crossOpenUpdating, setCrossOpenUpdating] = useState(false)
  const secureFetch = useSecureFetch()

  // Les candidatures (liste ACTIVE + agrégat des tuiles) viennent du hook
  // PARTAGÉ avec l'accueil CDI : lib/hooks/useExpertApplications.
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
  // Verrou missions : la section "Missions recommandées" (fetch + affichage)
  // suit STRICTEMENT verification_status === 'approved' (source de vérité
  // unique partagée avec la home CDI). Évite d'afficher des missions en cache
  // périmé quand l'expert repasse "à valider" après une re-publication.
  const isApproved = (profile?.verification_status ?? null) === 'approved'
  // Lot UX refetch auto post-matching : dérive "matching en cours" depuis
  //  - profile.verified_at récent (< 120s) → cas approbation auto/admin
  //  - sessionStorage trigger récent (< 120s) → cas toggle DND, save profil
  // Pendant cette fenêtre on poll vite (3s) ET on affiche un état transitoire
  // "Analyse en cours". Hors fenêtre = poll normal 30s + empty-state classique.
  const [matchingTick, setMatchingTick] = useState<number>(() => Date.now())
  const lastTriggerMs = readMatchingTrigger(user?.id ?? null)
  const matchingInWindow = isWithinMatchingWindow({
    now: matchingTick,
    verifiedAt: profile?.verified_at ?? null,
    lastTriggerMs,
  })
  const missionsPollMs = matchingInWindow
    ? MATCHING_TRIGGER_FAST_POLL_MS
    : MATCHING_TRIGGER_NORMAL_POLL_MS

  // Lot A : `expert_status.is_dnd` pour l'empty-state rouge.
  const missionsLive = useLiveResource<
    {
      missions: RecommendedMission[]
      expert_status?: { is_dnd: boolean }
    },
    RecommendedMission
  >({
    url: liveEnabled && isApproved ? `/api/me/missions?locale=${encodeURIComponent(locale)}` : null,
    pollMs: missionsPollMs,
    itemsOf: (d) => d.missions ?? [],
    identityOf: (m) => m.match_id,
    versionOf: (m) => `${m.relevance_tier}`,
    enabled: liveEnabled && isApproved,
    holdNewItems: false,
  })
  // Candidatures : hook PARTAGÉ avec l'accueil CDI. Il demande `?filter=active`
  // au serveur et rend l'agrégat du bucket actif — rien n'est compté ici.
  const apps = useExpertApplications({ enabled: liveEnabled })

  // Dérivation memo : recommendedMissions.
  const missions = missionsLive.data?.missions ?? null

  // Casting home : on parcourt TOUTES les recommandations / candidatures
  // (carrousel sous projecteur → ne rallonge pas le home). Plus de slice top-N.
  const recommendedMissions = useMemo(() => missions === null ? null : missions, [missions])
  // État "analyse en cours" visible même quand la liste est déjà non vide.
  const missionsSignature = (recommendedMissions ?? []).map((m) => m.match_id).join('|')
  const { analyzing, startAnalyzing, scheduleRetry } = useMatchingAnalyzing(missionsSignature)

  // Relance matching serveur AVEC lecture de la réponse (F2) — remplace le
  // fire-and-forget aveugle. `analyzing` est déjà démarré par l'appelant.
  //   - 2xx           → rien à faire, le poll révèlera la nouvelle liste.
  //   - 429           → lit retry_after_seconds (fallback 60) et programme UN
  //                     retry unique du POST après ce délai (allowRetry=false).
  //   - autre / réseau → warn, on laisse le timeout du hook finir silencieusement.
  // JAMAIS de boucle : le retry est appelé avec allowRetry=false.
  const runSyncMatching = (allowRetry: boolean): void => {
    void secureFetch('/api/me/sync-matching', { method: 'POST' })
      .then(async (res) => {
        if (res.ok) return
        if (res.status === 429 && allowRetry) {
          const body = (await res.json().catch(() => null)) as { retry_after_seconds?: number } | null
          const delaySec = typeof body?.retry_after_seconds === 'number' ? body.retry_after_seconds : 60
          scheduleRetry(() => runSyncMatching(false), delaySec * 1000)
          return
        }
        console.warn('[dashboard:freelance] sync-matching non-ok', res.status)
      })
      .catch((err) => {
        console.warn('[dashboard:freelance] sync-matching ping failed', err)
      })
  }
  // Rangée casting home : la liste SERVIE, telle quelle. Le hook demande
  // `?filter=active` — plus aucun filtrage ici. Une candidature morte n'a rien
  // à faire sous les yeux de l'expert au réveil ; elle reste consultable dans
  // l'onglet Archivées de /candidatures.
  const recentCandidatures = apps.loading ? null : apps.items
  // Le seul agrégat encore calculé côté client est la complétion du profil :
  // elle ne dépend pas des candidatures.
  const completionPct = useMemo(
    () => ((profile?.verification_status ?? null) === 'approved' ? 100 : computeCompletionPct(profile)),
    [profile],
  )

  useEffect(() => {
    const loadUserAndProfile = async () => {
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
          .select('tjm_min, tjm_max, photo_url, visible, verification_status, verification_data, availability_status, verified_at, open_to_cdi, cv_parsing_status, title, summary, branch_id, speciality_ids, seniorities, work_zone_ids, skills, languages')
          .eq('user_id', session.user.id)
          .maybeSingle(),
      ])
      setUser(userData)
      setProfile(profileData ?? { tjm_min: null, tjm_max: null, photo_url: null })
      // Sync local availability depuis la DB. Tolérance NULL → 'available'
      // (défaut produit). Réutilisé par le listener sk:availability-changed
      // ci-dessous pour resync après bascule depuis le bouton "Réactiver".
      const rawAvail = (profileData as { availability_status?: string | null } | null)?.availability_status ?? null
      const safeAvail: AvailabilityStatus =
        rawAvail === 'do_not_disturb' ? 'do_not_disturb' : 'available'
      setAvailability(safeAvail)
      setOpenToCdi((profileData as { open_to_cdi?: boolean | null } | null)?.open_to_cdi === true)
      setLoading(false)
    }
    void loadUserAndProfile()
    // Lot global C1 : resync l'état local quand le statut d'écoute change
    // depuis n'importe quelle surface (toggle, bouton "Réactiver" du
    // DndEmptyState). Sans ce listener, le toggle visuel reste figé sur
    // 'do_not_disturb' même si la DB + la pill topbar + la liste se sont
    // mises à jour. Pattern identique au DashboardShell.
    const onAvailChanged = () => { void loadUserAndProfile() }
    window.addEventListener('sk:availability-changed', onAvailChanged)
    return () => { window.removeEventListener('sk:availability-changed', onAvailChanged) }
  }, [router])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(id)
  }, [toast])

  // Lot UX refetch auto post-matching : pendant la fenêtre d'analyse, on
  // re-render toutes les 3s pour ré-évaluer isWithinMatchingWindow. Quand
  // missions arrivent (length > 0) ou que la fenêtre est écoulée, on stoppe
  // le tick et on purge le hint sessionStorage.
  useEffect(() => {
    if (!matchingInWindow) {
      if (user?.id) clearMatchingTrigger(user.id)
      return
    }
    const id = window.setInterval(() => setMatchingTick(Date.now()), MATCHING_TRIGGER_FAST_POLL_MS)
    return () => window.clearInterval(id)
  }, [matchingInWindow, user?.id])

  // Si des missions arrivent → on purge immédiatement le hint et on reprend
  // un poll normal au prochain render.

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
        // Lot A : notifie la pill topbar ET les useLiveResource (mutate
        // /api/me/missions → home Suggestions + page Offres se mettent à
        // jour SANS reload. Toggle ↔ liste vidée/repeuplée, instantané).
        emitAvailabilityChanged()
        // Lot matching réconcilié : sortie du DND → ping sync-matching
        // côté serveur pour aligner les matches avec les publis publiées.
        // Lecture de la réponse + retry unique sur 429 (F2).
        if (next === 'available' && previous === 'do_not_disturb') {
          if (user?.id) markMatchingTriggered(user.id)
          startAnalyzing()
          setMatchingTick(Date.now())
          runSyncMatching(true)
        }
      }
    } catch {
      setAvailability(previous)
      setToast(t('availability_card.toast_error'))
    } finally {
      setAvailabilityUpdating(false)
    }
  }

  // Ouverture croisée : même pattern que la dispo (write client-direct RLS +
  // relance matching, cooldown M2 hérité). Déclenché à CHAQUE bascule (on/off).
  const handleCrossOpenChange = async (next: boolean) => {
    if (!user || crossOpenUpdating || next === openToCdi) return
    const previous = openToCdi
    setOpenToCdi(next) // optimistic
    setCrossOpenUpdating(true)
    try {
      const { error: upErr } = await supabase
        .from('profiles')
        .update({ open_to_cdi: next })
        .eq('user_id', user.id)
      if (upErr) {
        setOpenToCdi(previous) // rollback
        setToast(t('availability_card.toast_error'))
      } else {
        setToast(t('availability_card.toast_updated'))
        // Le pool matching change → on relance et on rafraîchit le feed.
        // Lecture de la réponse + retry unique sur 429 (F2) : c'est LE cas du
        // décochage rapide qui heurtait le cooldown M2 et restait sans élagage.
        emitAvailabilityChanged()
        markMatchingTriggered(user.id)
        startAnalyzing()
        setMatchingTick(Date.now())
        runSyncMatching(true)
      }
    } catch {
      setOpenToCdi(previous)
      setToast(t('availability_card.toast_error'))
    } finally {
      setCrossOpenUpdating(false)
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

  // D1 : « profil vérifié » = source de vérité verification_status === 'approved'
  // (même source que la garde serveur + la pastille), jamais users.is_verified.
  // Pilote le bloc Collaboration ET les stats verrouillées (mêmes gates métier).
  const isVerified = (profile?.verification_status ?? null) === 'approved'
  // Lot bandeau vérif : état réel (badge greeting fidèle, plus de "vérifié"
  // affiché à tort quand le profil est en attente de validation admin).
  const verifState = deriveVerificationUiState({
    visible: (profile?.visible ?? null) as boolean | null,
    verificationStatus: (profile?.verification_status ?? null) as string | null,
  })
  const isApprovedState = verifState === 'approved'
  const firstName = (user?.first_name ?? '').trim()
  const lastName = (user?.last_name ?? '').trim()
  const fullName = `${firstName} ${lastName}`.trim() || tCommon('user_fallback')
  // C10 : prénom pour l'accueil personnalisé ; fallback sur le nom complet puis
  // sur le libellé générique — la phrase ne casse jamais si le prénom manque.
  const greetingName = firstName || fullName
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
        /* Tuile cliquable : affordance + focus clavier portés par le <a>. */
        .stat-card.is-link { cursor: pointer; }
        .stat-card.is-link:focus-visible {
          outline: 2px solid ${domain.primaryColor};
          outline-offset: 2px;
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

          {/* La raison NOMMÉE d'un profil invisible. Placée en tête : c'est le
              premier écran de l'expert, et c'est là qu'il vient chercher
              pourquoi il ne reçoit plus rien. Silencieuse si le profil est
              visible ou si le verdict serveur est indisponible. */}
          <ProfilMasqueBanner
            namespace="profile_validation"
            href="/dashboard/freelance/profil/valider"
            accentColor={domain.primaryColor}
          />

          {/* Lot A : tuile "Score IA" retirée (UI placeholder vide qui
              n'alimentait rien). Le titre garde le même bloc d'en-tête. */}
          <div style={{ marginBottom: 26, animation: 'fadeInUp 0.4s ease' }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#111827', marginBottom: 8 }}>{t('greeting', { firstName: greetingName })}</h1>
            {/* C6 : statut de vérification = même pastille que la topbar « Mon
                Profil » (source unique). C10 : greeting personnalisé. */}
            <div style={{ animation: 'fadeIn 0.6s ease 0.3s both' }}>
              <VerificationStatusPill state={verifState} />
            </div>
          </div>

          {/* C1 — Guide d'onboarding : visible tant que le profil n'est pas
              vérifié. Disparaît une fois approved. */}
          {!isApprovedState && (
            <ExpertOnboardingGuide
              basePath="/dashboard/freelance"
              cvDone={profile?.cv_parsing_status === 'done'}
              profileComplete={(completionPct) >= 100}
              verifState={verifState}
            />
          )}

          {/* Lot état 'selected' : 4 stat-cards de comptage + TJM card = 5
              tuiles total. La media query .stats-grid bascule en grid auto-fit
              min 140 sur mobile pour rester lisible (cf. styles ci-dessous).

              Lot facettes : chaque tuile MÈNE à ce qu'elle compte. Le chiffre
              vient de `stats.active.facets`, dérivé serveur ; le lien porte la
              MÊME facette dans l'URL de /candidatures, qui refiltre le même
              tableau avec le même prédicat. Une tuile à zéro reste cliquable :
              c'est le seul moyen de vérifier qu'on n'a effectivement rien.
              Tant que le profil n'est pas vérifié, il n'y a pas de liste à
              ouvrir — la tuile reste alors un simple affichage « — ». */}
          <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 22 }}>
            {[
              // BUCKET ACTIF UNIQUEMENT, agrégé par le serveur (hook partagé
              // avec l'accueil CDI). « Refusées » n'y figure pas : `rejected`
              // est une facette du bucket ARCHIVÉ, elle y vaudrait 0 à vie.
              // « En attente » la remplace — active par définition.
              { label: t('stats.active_applications'), value: apps.stats?.total,                   facet: null,              delay: '0.1s'  },
              { label: t('stats.in_discussion'),       value: apps.stats?.facets.exchange_open,    facet: 'exchange_open',   delay: '0.13s' },
              { label: t('stats.awaiting'),            value: apps.stats?.facets.awaiting_review,  facet: 'awaiting_review', delay: '0.15s' },
              { label: t('stats.retained'),            value: apps.stats?.facets.selected,         facet: 'selected',        delay: '0.17s', accent: '#D97706' },
            ].map((stat) => {
              const text = !isVerified ? '—' : (stat.value ?? '…').toString()
              const body = (
                <>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>{stat.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: !isVerified ? '#d1d5db' : (stat.accent ?? '#111827'), animation: `countUp 0.5s ease ${stat.delay} both` }}>{text}</div>
                </>
              )
              if (!isVerified) {
                return (
                  <div key={stat.label} className="stat-card" style={{ background: '#f3f4f6', animationDelay: stat.delay }}>
                    {body}
                  </div>
                )
              }
              return (
                <Link
                  key={stat.label}
                  href={`/dashboard/freelance/candidatures?filter=active${stat.facet ? `&facet=${stat.facet}` : ''}`}
                  className="stat-card is-link"
                  style={{ background: '#f3f4f6', animationDelay: stat.delay, textDecoration: 'none', color: 'inherit', display: 'block' }}
                >
                  {body}
                </Link>
              )
            })}
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
              disabled={availabilityUpdating || analyzing || !user || !isApproved}
            />
            <CrossOpenToggle
              checked={openToCdi}
              onChange={handleCrossOpenChange}
              label={t('availability_card.cross_open_label')}
              hint={t('availability_card.cross_open_hint')}
              disabled={crossOpenUpdating || analyzing || !user || !isApproved}
              accentColor={domain.primaryColor}
            />
          </div>

          {/* Complétion profil */}
          <div className="main-card" style={{ borderColor: `${domain.primaryColor}55`, animationDelay: '0.3s' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>
                {t('completion.title', { percent: completionPct })}
              </div>
              <Link href="/dashboard/freelance/profil/valider" className="voir-tout" style={{ color: domain.primaryColor }}>{t('completion.cta')}</Link>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ background: `linear-gradient(90deg, ${domain.primaryColor}, ${domain.secondaryColor})`, width: `${completionPct}%` }}></div>
            </div>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 10, lineHeight: 1.6 }}>{t('completion.hint')}</div>
          </div>

          {/* Missions recommandées — section TOUJOURS visible (parité avec les
              autres cartes). Si non approuvé : état vide "profil pas encore
              validé" via la même primitive empty-state que les autres sections,
              JAMAIS le cache périmé (le fetch reste gated sur isApproved). */}
          <div className="main-card" style={{ animationDelay: '0.35s' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>{t('cards.recommended_missions.title')}</span>
                <span style={{ background: '#ede9fe', color: '#6d28d9', fontSize: 12, fontWeight: 500, padding: '4px 12px', borderRadius: 20 }}>{t('cards.recommended_missions.ai_badge')}</span>
              </div>
              {/* C3 : lien désactivé tant que non vérifié (rien à voir avant
                  validation), même traitement que le bloc Collaboration. */}
              {!isVerified
                ? <span style={{ background: '#f3f4f6', color: '#9ca3af', fontSize: 12, padding: '4px 10px', borderRadius: 20 }}>{t('cards.locked_chip')}</span>
                : <Link href="/dashboard/freelance/missions" className="voir-tout" style={{ color: domain.primaryColor }}>{t('cards.see_all')}</Link>}
            </div>
            {!isApproved ? (
              <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 22, textAlign: 'center', fontSize: 14, color: '#9ca3af', lineHeight: 1.8 }}>
                {t('cards.recommended_missions.empty_unverified')}
              </div>
            ) : (recommendedMissions === null) ? (
              <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 22, textAlign: 'center', fontSize: 14, color: '#9ca3af' }}>
                {t('loading')}
              </div>
            ) : recommendedMissions.length === 0 ? (
              // 3 empty-states distincts (priorité explicite) :
              //   DND          → ROUGE + bouton "Repasser À l'écoute" (Lot A).
              //   matching IA en cours (fenêtre <120s post-trigger) → état
              //     TRANSITOIRE "Analyse en cours…" (Lot UX refetch auto).
              //   sinon 0 match → GRIS neutre "Aucune mission ne correspond…".
              missionsLive.data?.expert_status?.is_dnd && user?.id ? (
                <DndEmptyState side="freelance" userId={user.id} />
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
                  <span>{t('cards.recommended_missions.analyzing', { ecosystem: domain.ecosystemName })}</span>
                  <style>{`@keyframes sk-spin { to { transform: rotate(360deg) } }`}</style>
                </div>
              ) : (
                <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 22, textAlign: 'center', fontSize: 14, color: '#9ca3af', lineHeight: 1.8 }}>
                  {t('cards.recommended_missions.empty_verified', { ecosystem: domain.ecosystemName })}
                </div>
              )
            ) : (
              // Liste non vide : bandeau "Analyse en cours…" en tête de section
              // pendant le matching (toggle croisé/dispo), cartes atténuées à
              // 0.35, jamais vidées. L'empty-state, lui, reste inchangé.
              <>
                {analyzing && (
                  <div
                    role="status"
                    aria-live="polite"
                    style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 13, color: '#475569' }}
                  >
                    <span
                      aria-hidden
                      style={{ width: 15, height: 15, border: `2px solid ${domain.primaryColor}44`, borderTopColor: domain.primaryColor, borderRadius: '50%', animation: 'sk-spin 0.8s linear infinite' }}
                    />
                    <span>{t('cards.recommended_missions.analyzing_update')}</span>
                    <style>{`@keyframes sk-spin { to { transform: rotate(360deg) } }`}</style>
                  </div>
                )}
                <div style={{ opacity: analyzing ? 0.35 : 1, transition: 'opacity .2s ease' }}>
                  <CastingRow<MissionCardData>
                    items={recommendedMissions}
                    getKey={(m) => m.match_id}
                    labels={{ prevAria: tc('prev_aria'), nextAria: tc('next_aria'), empty: tc('empty') }}
                    renderItem={(m) => <MissionCastingCard mission={m} side="freelance" />}
                  />
                </div>
              </>
            )}
          </div>

          {/* SC2 — Section "Vos candidatures" — TOUJOURS visible (parité avec la
              section Missions et avec la home CDI où "Mes candidatures" est déjà
              toujours rendue). État vide tant qu'aucune candidature, y compris
              profil non validé. Le fetch /api/me/candidatures ne gate pas la
              vérif → renvoie [] et l'état vide s'affiche proprement. */}
            <div className="main-card" style={{ animationDelay: '0.38s' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>{t('cards.your_candidatures.title')}</span>
                {/* C3 : lien désactivé tant que non vérifié. */}
                {!isVerified
                  ? <span style={{ background: '#f3f4f6', color: '#9ca3af', fontSize: 12, padding: '4px 10px', borderRadius: 20 }}>{t('cards.locked_chip')}</span>
                  : <Link href="/dashboard/freelance/candidatures" className="voir-tout" style={{ color: domain.primaryColor }}>{t('cards.see_all')}</Link>}
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
                <CastingRow<ExpertApplicationItem>
                  items={recentCandidatures}
                  getKey={(c) => c.id}
                  labels={{ prevAria: tc('prev_aria'), nextAria: tc('next_aria'), empty: tc('empty') }}
                  renderItem={(c) => <CandidatureCastingCard candidature={c} side="freelance" />}
                />
              )}
            </div>

          {/* C9 — Collaboration experts : MES besoins publiés (miroir « Mes
              annonces » entreprise), plus les besoins reçus (doublon Missions).
              Verrou non-vérifié conservé (interne au composant). */}
          <CollaborationDashboardBlock basePath="/dashboard/freelance" isVerified={isVerified} />

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
        onClose={() => setAvatarModalOpen(false)}
        onSaved={() => setToast(t('avatar_modal.success'))}
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
