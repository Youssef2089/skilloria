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
import EtatDeRecherche from '@/components/dashboard/EtatDeRecherche'
import { useRechercheDeMissions } from '@/hooks/useRechercheDeMissions'
import { emitAvailabilityChanged } from '@/lib/availability-actions'

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
  // La lecture du profil a-t-elle échoué ? Vrai = l'écran montre le DERNIER
  // état connu, pas la vérité du moment — et il le dit.
  const [lectureProfilEnPanne, setLectureProfilEnPanne] = useState(false)
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
  // LA RECHERCHE DE MISSIONS — elle attend la fin du moteur, pas un chronomètre.
  const recherche = useRechercheDeMissions()

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

  // ── CE QUI A DISPARU D'ICI, ET POURQUOI ────────────────────────────────
  //
  //  Deux chronomètres décidaient de ce que l'expert voyait :
  //    · une fenêtre de CENT VINGT SECONDES en `sessionStorage`
  //      (`matching-resync-hint`), pendant laquelle l'écran affichait
  //      « analyse en cours » et sondait toutes les trois secondes ;
  //    · une roue de SOIXANTE-QUINZE SECONDES (`useMatchingAnalyzing`),
  //      retirée « en silence » à l'expiration.
  //
  //  AUCUN DES DEUX NE MESURAIT UN TRAVAIL : ils mesuraient le temps. Et le
  //  travail, lui, était programmé pour SOIXANTE MINUTES plus tard. Les deux
  //  chronomètres expiraient donc systématiquement avant que rien ne se
  //  produise, et l'écran concluait « aucune mission ne correspond à votre
  //  profil » — un résultat affirmé sans recherche.
  //
  //  La recherche attend désormais la fin du moteur et rend une issue nommée.
  //  Le sondage rapide n'a plus d'objet : quand la réponse arrive, le travail
  //  est fini.
  const missionsPollMs = 30_000

  // `expert_status.is_dnd` fait partie du CONTRAT de /api/me/missions et reste
  // déclaré ici pour que le type dise la vérité sur la réponse. Il n'est PLUS
  // LU par cet écran : la disponibilité se lit sur la page, une seule fois
  // (cf. le bandeau plus bas). Le commentaire d'avant disait « pour l'empty-state
  // rouge » — il était vrai, et c'est précisément ce qui rendait le défaut
  // invisible (§E.29).
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

  // LA RECHERCHE, LANCÉE PAR UN GESTE ET ATTENDUE JUSQU'AU BOUT.
  //
  //  Ce bloc lisait la réponse pour un seul motif : reprogrammer le POST après
  //  un 429. Un refus de débit y était donc traité, et TOUTES les autres
  //  réponses passaient en `warn` — y compris l'inéligibilité, qui était déjà
  //  connue au clic. C'est le hook qui porte désormais le cycle complet, et il
  //  ne reprogramme rien : un refus se DIT (« trop de recherches coup sur
  //  coup »), il ne se contourne pas en silence une minute plus tard.
  const lancerRecherche = (): void => {
    void recherche.chercher().then(() => {
      // Le moteur a fini d'écrire : on va chercher la liste qu'il vient de
      // produire, tout de suite, au lieu d'attendre le prochain sondage.
      void missionsLive.refresh()
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
      // ⚠️ LES RÉSULTATS SONT LIÉS ENTIERS. `const [{ data: x }]` jetait
      //    l'`error` à l'écriture même de la ligne : il n'y avait plus rien à
      //    oublier de lire (§E.22, forme ①-bis).
      const [userRes, profileRes] = await Promise.all([
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
      // ── UNE PANNE NE DOIT PAS ÉCRASER UN ÉTAT VALIDE ─────────────────────
      //  Ce chargement est RELANCÉ sur `sk:availability-changed`. Une panne au
      //  refetch effaçait donc un état déjà bon — le même aggravant que dans
      //  `DashboardShell`, corrigé au lot précédent (§E.20).
      if (userRes.error) {
        console.error('[dashboard/freelance] lecture users en panne', userRes.error.message)
      } else {
        setUser(userRes.data)
      }
      const profileData = profileRes.error ? null : profileRes.data
      if (profileRes.error) {
        console.error('[dashboard/freelance] lecture profiles en panne', profileRes.error.message)
        setLectureProfilEnPanne(true)
      } else {
        setLectureProfilEnPanne(false)
        // Le profil FABRIQUÉ ne se pose que si la lecture a ABOUTI : un profil
        // vide inventé sur une panne affichait un TJM disparu et un titre vide
        // à un expert dont le profil est complet.
        setProfile(profileRes.data ?? { tjm_min: null, tjm_max: null, photo_url: null })
      }
      // Sync local availability depuis la DB. Tolérance NULL → 'available'
      // (défaut produit). Réutilisé par le listener sk:availability-changed
      // ci-dessous pour resync après bascule depuis le bouton "Réactiver".
      // ⚠️ « TOLÉRANCE NULL → available » EST UN DÉFAUT PRODUIT LÉGITIME — pour
      //    une colonne RÉELLEMENT nulle. Sur une panne de lecture, il affirmait
      //    « Disponible » à un expert qui s'était mis en NE PAS DÉRANGER, et le
      //    faisait au moment exact où il vient de basculer l'interrupteur.
      //    On ne touche donc à rien quand on n'a pas su lire : l'écran garde le
      //    dernier état connu, et le bandeau dit pourquoi.
      if (!profileRes.error) {
        const rawAvail = (profileData as { availability_status?: string | null } | null)?.availability_status ?? null
        const safeAvail: AvailabilityStatus =
          rawAvail === 'do_not_disturb' ? 'do_not_disturb' : 'available'
        setAvailability(safeAvail)
        setOpenToCdi((profileData as { open_to_cdi?: boolean | null } | null)?.open_to_cdi === true)
      }
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
        // ── L'ÉTAT BASCULE ICI, LA RECHERCHE PART ICI ───────────────────
        //  Les deux sont instantanés et indépendants : le bouton ne s'est
        //  jamais fait attendre par le moteur, et n'attend pas davantage.
        //  Ce qui change, c'est que la recherche part POUR DE VRAI, au lieu
        //  d'une échéance posée à soixante minutes.
        if (next === 'available' && previous === 'do_not_disturb') {
          lancerRecherche()
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
        // Le périmètre change → on cherche. Si l'ouverture croisée se FERME,
        // la route dérive le sens côté serveur et se contente d'un élagage
        // SQL : elle ne rend alors aucune issue, et rien ne s'affiche ici.
        emitAvailabilityChanged()
        lancerRecherche()
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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', fontSize: 16, color: 'var(--sk-muted)' }}>
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
          color: var(--sk-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-radius: 8px;
          margin: 2px 8px;
          transition: background 0.18s, transform 0.18s;
          animation: slideInLeft 0.35s ease both;
        }
        .nav-item:hover { background: var(--sk-surface-2); transform: translateX(4px); }
        .nav-item-active {
          padding: 11px 16px;
          font-size: 14px;
          color: var(--sk-text);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-radius: 8px;
          margin: 2px 8px;
          background: var(--sk-surface-2);
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
          box-shadow: 0 8px 24px color-mix(in srgb, var(--sk-text) 9%, transparent);
        }
        /* Tuile cliquable : affordance + focus clavier portés par le <a>. */
        .stat-card.is-link { cursor: pointer; }
        .stat-card.is-link:focus-visible {
          outline: 2px solid var(--sk-accent);
          outline-offset: 2px;
        }
        .main-card {
          background: var(--sk-surface);
          border-radius: 14px;
          border: 1px solid var(--sk-border);
          padding: 22px 26px;
          margin-bottom: 18px;
          animation: fadeInUp 0.5s ease both;
          transition: box-shadow 0.2s;
        }
        .main-card:hover { box-shadow: 0 4px 20px color-mix(in srgb, var(--sk-text) 6%, transparent); }
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
        .progress-bar { height: 7px; background: var(--sk-surface-2); border-radius: 10px; overflow: hidden; }
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

      {/* ── L'ÉCRAN DIT QUAND IL MONTRE UN ÉTAT PÉRIMÉ ──────────────────────
          Sans ce bandeau, une panne de lecture laissait l'écran afficher son
          dernier état connu SANS LE DIRE — ce qui est mieux qu'un « Disponible »
          inventé, mais toujours une affirmation qu'on ne peut pas tenir (§E.19). */}
      {lectureProfilEnPanne && (
        <div
          role="status"
          aria-live="polite"
          style={{
            background: 'var(--sk-amber-soft)',
            border: '1px solid var(--sk-amber-soft)',
            borderRadius: 12,
            padding: '12px 16px',
            margin: '0 0 16px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: 'var(--sk-amber)', fontSize: 14, marginBottom: 4 }}>
              {t('lecture_en_panne.titre')}
            </div>
            <div style={{ color: 'var(--sk-amber)', fontSize: 13, lineHeight: 1.5 }}>
              {t('lecture_en_panne.corps')}
            </div>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              background: 'var(--sk-amber)',
              color: 'var(--sk-sur-accent)',
              border: 'none',
              borderRadius: 8,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('lecture_en_panne.reessayer')}
          </button>
        </div>
      )}

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
            accentColor={'var(--sk-accent)'}
          />

          {/* Lot A : tuile "Score IA" retirée (UI placeholder vide qui
              n'alimentait rien). Le titre garde le même bloc d'en-tête. */}
          <div style={{ marginBottom: 26, animation: 'fadeInUp 0.4s ease' }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--sk-text)', marginBottom: 8 }}>{t('greeting', { firstName: greetingName })}</h1>
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
              { label: t('stats.retained'),            value: apps.stats?.facets.selected,         facet: 'selected',        delay: '0.17s', accent: 'var(--sk-amber)' },
            ].map((stat) => {
              const text = !isVerified ? '—' : (stat.value ?? '…').toString()
              const body = (
                <>
                  <div style={{ fontSize: 12, color: 'var(--sk-muted)', marginBottom: 10 }}>{stat.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: !isVerified ? 'var(--sk-border)' : (stat.accent ?? 'var(--sk-text)'), animation: `countUp 0.5s ease ${stat.delay} both` }}>{text}</div>
                </>
              )
              if (!isVerified) {
                return (
                  <div key={stat.label} className="stat-card" style={{ background: 'var(--sk-surface-2)', animationDelay: stat.delay }}>
                    {body}
                  </div>
                )
              }
              return (
                <Link
                  key={stat.label}
                  href={`/dashboard/freelance/candidatures?filter=active${stat.facet ? `&facet=${stat.facet}` : ''}`}
                  className="stat-card is-link"
                  style={{ background: 'var(--sk-surface-2)', animationDelay: stat.delay, textDecoration: 'none', color: 'inherit', display: 'block' }}
                >
                  {body}
                </Link>
              )
            })}
            <div className="stat-card" style={{ background: 'var(--sk-surface)', border: `1px solid color-mix(in srgb, var(--sk-accent) 33%, transparent)`, animationDelay: '0.25s' }}>
              <div style={{ fontSize: 12, color: 'var(--sk-muted)', marginBottom: 10 }}>{t('stats.daily_rate')}</div>
              <div style={{ fontSize: profile?.tjm_min != null && profile?.tjm_max != null ? 18 : 24, fontWeight: 700, color: 'var(--sk-accent)' }}>
                {profile?.tjm_min != null && profile?.tjm_max != null
                  ? t('stats.daily_rate_range', { min: profile.tjm_min, max: profile.tjm_max })
                  : '— €'}
              </div>
              <button
                type="button"
                onClick={() => setTjmModalOpen(true)}
                style={{ background: 'transparent', border: 'none', padding: 0, fontSize: 12, color: 'var(--sk-accent)', cursor: 'pointer', marginTop: 6, fontFamily: 'inherit', fontWeight: 500 }}
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
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--sk-text)', marginBottom: 6 }}>
                {t('availability_card.title')}
              </div>
              <div style={{ fontSize: 13, color: 'var(--sk-muted)', lineHeight: 1.55 }}>
                {t('availability_card.description')}
              </div>
            </div>
            <AvailabilityToggle
              value={availability}
              onChange={handleAvailabilityChange}
              disabled={availabilityUpdating || recherche.enCours || !user || !isApproved}
            />
            <CrossOpenToggle
              checked={openToCdi}
              onChange={handleCrossOpenChange}
              label={t('availability_card.cross_open_label')}
              hint={t('availability_card.cross_open_hint')}
              disabled={crossOpenUpdating || recherche.enCours || !user || !isApproved}
              accentColor={'var(--sk-accent)'}
            />
          </div>

          {/* Complétion profil */}
          <div className="main-card" style={{ borderColor: `color-mix(in srgb, var(--sk-accent) 33%, transparent)`, animationDelay: '0.3s' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--sk-text)' }}>
                {t('completion.title', { percent: completionPct })}
              </div>
              <Link href="/dashboard/freelance/profil/valider" className="voir-tout" style={{ color: 'var(--sk-accent)' }}>{t('completion.cta')}</Link>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ background: `linear-gradient(90deg, var(--sk-accent), ${'var(--sk-accent)'})`, width: `${completionPct}%` }}></div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--sk-muted)', marginTop: 10, lineHeight: 1.6 }}>{t('completion.hint')}</div>
          </div>

          {/* Missions recommandées — section TOUJOURS visible (parité avec les
              autres cartes). Si non approuvé : état vide "profil pas encore
              validé" via la même primitive empty-state que les autres sections,
              JAMAIS le cache périmé (le fetch reste gated sur isApproved). */}
          <div className="main-card" style={{ animationDelay: '0.35s' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--sk-text)' }}>{t('cards.recommended_missions.title')}</span>
                <span style={{ background: 'var(--sk-accent-soft)', color: 'var(--sk-accent)', fontSize: 12, fontWeight: 500, padding: '4px 12px', borderRadius: 20 }}>{t('cards.recommended_missions.ai_badge')}</span>
              </div>
              {/* C3 : lien désactivé tant que non vérifié (rien à voir avant
                  validation), même traitement que le bloc Collaboration. */}
              {!isVerified
                ? <span style={{ background: 'var(--sk-surface-2)', color: 'var(--sk-faint)', fontSize: 12, padding: '4px 10px', borderRadius: 20 }}>{t('cards.locked_chip')}</span>
                : <Link href="/dashboard/freelance/missions" className="voir-tout" style={{ color: 'var(--sk-accent)' }}>{t('cards.see_all')}</Link>}
            </div>
            {!isApproved ? (
              <div style={{ background: 'var(--sk-surface-2)', border: '1px solid var(--sk-border)', borderRadius: 10, padding: 22, textAlign: 'center', fontSize: 14, color: 'var(--sk-muted)', lineHeight: 1.8 }}>
                {t('cards.recommended_missions.empty_unverified')}
              </div>
            ) : (recommendedMissions === null) ? (
              <div style={{ background: 'var(--sk-surface-2)', border: '1px solid var(--sk-border)', borderRadius: 10, padding: 22, textAlign: 'center', fontSize: 14, color: 'var(--sk-muted)' }}>
                {t('loading')}
              </div>
            ) : recommendedMissions.length === 0 ? (
              // 3 empty-states distincts (priorité explicite) :
              //   DND          → ROUGE + bouton "Repasser À l'écoute" (Lot A).
              //   matching IA en cours (fenêtre <120s post-trigger) → état
              //     TRANSITOIRE "Analyse en cours…" (Lot UX refetch auto).
              //   sinon 0 match → GRIS neutre "Aucune mission ne correspond…".
              // ⚠️ LA DISPONIBILITÉ SE LIT SUR LA PAGE, PAS SUR LE RÉSEAU.
              //
              //    Cette ligne lisait `missionsLive.data.expert_status.is_dnd`,
              //    c'est-à-dire la réponse de /api/me/missions. Trois lecteurs
              //    du même fait coexistaient : le bouton (état local), la
              //    pastille de l'en-tête (requête propre du shell), et ce
              //    bandeau. Les deux premiers basculaient au clic ; le
              //    troisième, jamais.
              //
              //    LA CAUSE ÉTAIT EXACTE ET MESURÉE : useLiveResource ne met
              //    `displayed` à jour que si la LISTE change. Un expert sans
              //    mission a une liste vide avant ET après : le hook ne voyait
              //    « aucun changement métier » et gardait l'ancienne métadonnée.
              //    Le bandeau n'apparaissait qu'au changement de page, qui
              //    remonte le composant.
              //
              //    La parade du hook — `metadataHash` — existait, et son
              //    commentaire nomme littéralement `expert_status.is_dnd`. Elle
              //    avait été appliquée aux pages /missions et PAS aux deux
              //    tableaux de bord, c'est-à-dire pas aux deux pages qui
              //    portent le bouton (§E.20). Elle n'est plus nécessaire ici :
              //    la page ne lit plus cette métadonnée du tout.
              // ⚠️ L'ORDRE DIT LA PRIORITÉ, ET LA RECHERCHE PASSE AVANT LE VIDE.
              //    Le bloc « aucune mission ne correspond » ne s'affiche plus
              //    QUE lorsque rien d'autre n'a quelque chose à dire : ni un
              //    « ne pas déranger » actif, ni une recherche en cours, ni une
              //    issue nommée. Il affirme un résultat — il ne doit donc
              //    jamais boucher un trou.
              availability === 'do_not_disturb' && user?.id ? (
                <DndEmptyState side="freelance" userId={user.id} onReprise={lancerRecherche} />
              ) : recherche.etat.phase !== 'repos' ? (
                <EtatDeRecherche
                  etat={recherche.etat}
                  side="freelance"
                  ecosystem={domain.ecosystemName}
                  onReessayer={lancerRecherche}
                />
              ) : (
                <div style={{ background: 'var(--sk-surface-2)', border: '1px solid var(--sk-border)', borderRadius: 10, padding: 22, textAlign: 'center', fontSize: 14, color: 'var(--sk-muted)', lineHeight: 1.8 }}>
                  {t('cards.recommended_missions.empty_verified', { ecosystem: domain.ecosystemName })}
                </div>
              )
            ) : (
              // Liste non vide : la recherche s'annonce en tête de section,
              // cartes atténuées à 0.35, jamais vidées.
              <>
                <EtatDeRecherche
                  etat={recherche.etat}
                  side="freelance"
                  ecosystem={domain.ecosystemName}
                  onReessayer={lancerRecherche}
                />
                <div style={{ opacity: recherche.enCours ? 0.35 : 1, transition: 'opacity .2s ease' }}>
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
                <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--sk-text)' }}>{t('cards.your_candidatures.title')}</span>
                {/* C3 : lien désactivé tant que non vérifié. */}
                {!isVerified
                  ? <span style={{ background: 'var(--sk-surface-2)', color: 'var(--sk-faint)', fontSize: 12, padding: '4px 10px', borderRadius: 20 }}>{t('cards.locked_chip')}</span>
                  : <Link href="/dashboard/freelance/candidatures" className="voir-tout" style={{ color: 'var(--sk-accent)' }}>{t('cards.see_all')}</Link>}
              </div>
              {recentCandidatures === null ? (
                <div style={{ background: 'var(--sk-surface-2)', border: '1px solid var(--sk-border)', borderRadius: 10, padding: 22, textAlign: 'center', fontSize: 14, color: 'var(--sk-muted)' }}>
                  {t('loading')}
                </div>
              ) : recentCandidatures.length === 0 ? (
                <div style={{ background: 'var(--sk-surface-2)', border: '1px solid var(--sk-border)', borderRadius: 10, padding: 22, textAlign: 'center', fontSize: 14, color: 'var(--sk-muted)', lineHeight: 1.8 }}>
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
            background: 'var(--sk-success-soft)',
            border: '1px solid var(--sk-success-soft)',
            color: 'var(--sk-success)',
            padding: '12px 18px',
            borderRadius: 12,
            fontSize: 14,
            fontWeight: 600,
            boxShadow: '0 8px 24px color-mix(in srgb, var(--sk-text) 10%, transparent)',
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
