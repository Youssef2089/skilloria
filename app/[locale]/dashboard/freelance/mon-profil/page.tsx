'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { Plus_Jakarta_Sans } from 'next/font/google'
import { useDomain } from '@/context/DomainContext'
import { supabase } from '@/lib/supabase'
import { useSecureFetch } from '@/lib/secure-fetch'
import EmptyState from '@/components/ui/EmptyState'
import { deriveVerificationUiState, verificationChipColors } from '@/lib/verification-state'
import VerificationStatusPill from '@/components/dashboard/VerificationStatusPill'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import AvatarUploadModal from '@/components/AvatarUploadModal'
import AvatarEditOverlay from '@/components/dashboard/AvatarEditOverlay'
import DashboardSidebar from '@/components/shell/DashboardSidebar'
import { useAvatarUrl } from '@/hooks/useAvatarUrl'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
})

const fontJakarta = 'var(--font-jakarta), system-ui, sans-serif'

type Seniority = 'junior' | 'confirmed' | 'senior' | 'expert'
type WorkMode = 'remote' | 'onsite' | 'hybrid'
type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'native'
type ExperienceType = 'career' | 'project'
// Lot disponibilité (V1) : 2 états seulement.
//   available       — l'expert reçoit les matchs (défaut).
//   do_not_disturb  — barrière serveur (exclu matching + feed).
// 'busy_soon' a été supprimé (V1 binaire) ; les anciens 'busy_soon' sont
// migrés vers 'available' et 'unavailable' vers 'do_not_disturb' via SQL.
type AvailabilityStatus = 'available' | 'do_not_disturb'

type Branch = { id: string; name: string; slug: string }
type Speciality = { id: string; name: string; slug: string; branch_id: string }

type Country = {
  code: string
  name_fr: string
  name_en: string
  name_es: string
  name_de: string
  flag_emoji: string | null
}

type Certification = {
  name: string
  issuer: string | null
  year: number | null
}

type Experience = {
  role: string | null
  employer: string | null
  client_name: string | null
  sector: string | null
  start_date: string | null
  end_date: string | null
  is_current: boolean
  description: string | null
  experience_type: ExperienceType
  sort_order: number | null
}

type Education = {
  school: string | null
  degree: string | null
  field: string | null
  start_year: number | null
  end_year: number | null
  location: string | null
}

type LanguageItem = {
  language: string
  level: CefrLevel
  is_primary: boolean
}

type Profile = {
  id: string
  title: string | null
  summary: string | null
  seniorities: Seniority[] | null
  years_experience: number | null
  years_total_experience: number | null
  skills: string[] | null
  certifications: Certification[] | null
  branch_id: string | null
  speciality_ids: string[] | null
  work_modes: WorkMode[] | null
  tjm_min: number | null
  tjm_max: number | null
  availability_date: string | null
  availability_status: AvailabilityStatus | null
  linkedin_url: string | null
  visible: boolean | null
  city: string | null
  country: string | null
  photo_url: string | null
  cv_file_path: string | null
  cv_parsing_status: string | null
  ai_consent_at: string | null
  verification_status: string | null
  review_reason: string | null
}

type UserData = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  user_type: string | null
  domain_id: string | null
}

const LOCALE_DATE_MAP: Record<string, string> = {
  fr: 'fr-FR',
  en: 'en-GB',
  es: 'es-ES',
  de: 'de-DE',
}

const SECTION_PALETTE = {
  summary: '#0ea5e9',
  expertise: '#6366f1',
  certifications: '#a855f7',
  career: '#ec4899',
  missions: '#f43f5e',
  education: '#14b8a6',
  languages: '#f59e0b',
  availability: '#10b981',
  links: '#06b6d4',
} as const

const AVAILABILITY_COLOR: Record<AvailabilityStatus, string> = {
  available: '#22c55e',
  do_not_disturb: '#ef4444',
}

const TRUNCATE_DESC = 220

function safeDate(ymd: string | null | undefined): Date | null {
  if (!ymd) return null
  const d = new Date(ymd)
  if (isNaN(d.getTime())) return null
  return d
}

function SectionHeader({
  n,
  color,
  title,
}: {
  n: number
  color: string
  title: React.ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 28,
          height: 28,
          padding: '0 9px',
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 800,
          color: '#fff',
          background: color,
          fontFamily: fontJakarta,
          flexShrink: 0,
        }}
      >
        {n}
      </span>
      <div
        style={{
          flex: 1,
          fontSize: 16,
          fontWeight: 700,
          color: '#0f172a',
          letterSpacing: '-0.2px',
          fontFamily: fontJakarta,
        }}
      >
        {title}
      </div>
    </div>
  )
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 14,
        color: '#94a3b8',
        fontStyle: 'italic',
        lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  )
}

function Card({
  children,
  style,
}: {
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 16,
        padding: '22px 24px',
        marginBottom: 16,
        animation: 'fadeInUp 0.4s ease both',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function ExpandableDescription({
  text,
  expanded,
  onToggle,
  tMore,
  tLess,
}: {
  text: string
  expanded: boolean
  onToggle: () => void
  tMore: string
  tLess: string
}) {
  if (text.length <= TRUNCATE_DESC) {
    return (
      <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.65, marginTop: 8, whiteSpace: 'pre-wrap' }}>
        {text}
      </p>
    )
  }
  const shown = expanded ? text : text.slice(0, TRUNCATE_DESC).trimEnd() + '…'
  return (
    <div style={{ marginTop: 8 }}>
      <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.65, whiteSpace: 'pre-wrap', margin: 0 }}>
        {shown}
      </p>
      <button
        type="button"
        onClick={onToggle}
        style={{
          marginTop: 6,
          background: 'transparent',
          border: 'none',
          padding: 0,
          fontSize: 13,
          fontWeight: 600,
          color: '#0ea5e9',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {expanded ? tLess : tMore}
      </button>
    </div>
  )
}

export default function MonProfilPage() {
  const t = useTranslations('profile_view')
  const tVerifBadge = useTranslations('expert_verification.badge')
  const tRejected = useTranslations('expert_verification.rejected_details')
  const tDash = useTranslations('dashboard_freelance')
  const tShell = useTranslations('shell')
  const tCommon = useTranslations('common')
  const locale = useLocale()
  const router = useRouter()
  const domain = useDomain()
  // M3 : photo propre via URL signée serveur (le hook re-signe après upload).
  const { url: ownAvatarUrl } = useAvatarUrl()
  const secureFetch = useSecureFetch()

  // Lot CV obligatoire — bouton "Publier mon profil" depuis Mon Profil.
  // L'API (PATCH /api/profile {visible:true}) reste la barrière de validation :
  // on relaie son message d'erreur (profil incomplet ou CV manquant) tel quel.
  const [publishing, setPublishing] = useState(false)
  const [publishMsg, setPublishMsg] = useState<
    { kind: 'success' | 'error'; text: string } | null
  >(null)

  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  // Lot CV obligatoire : verrou Mon Profil tant qu'aucun CV n'a été déposé
  // (cv_file_path nul). On n'affiche plus un profil vide ni ne redirige en
  // silence : on montre un écran de blocage avec lien vers l'upload CV.
  const [needsCv, setNeedsCv] = useState(false)
  const [user, setUser] = useState<UserData | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [experiences, setExperiences] = useState<Experience[]>([])
  const [educations, setEducations] = useState<Education[]>([])
  const [languages, setLanguages] = useState<LanguageItem[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [specialities, setSpecialities] = useState<Speciality[]>([])
  const [countries, setCountries] = useState<Country[]>([])
  const [expandedDesc, setExpandedDesc] = useState<Set<string>>(new Set())
  // Lot global C3 : modal upload photo profil. Le modal écrit dans Supabase
  // Storage (bucket avatars, path <user_id>/avatar.jpg) puis PATCH /api/profile.
  // À l'upload réussi, on patch localement `profile.photo_url` (optimiste).
  const [avatarModalOpen, setAvatarModalOpen] = useState(false)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setErrorMsg(null)
      setForbidden(false)

      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        router.push('/connexion')
        return
      }

      const { data: userRow, error: userErr } = await supabase
        .from('users')
        .select('id, email, first_name, last_name, user_type, domain_id')
        .eq('id', session.user.id)
        .single()

      if (cancelled) return

      if (userErr || !userRow) {
        setErrorMsg(t('error'))
        setLoading(false)
        return
      }

      if ((userRow.user_type as string) !== 'expert_freelance') {
        setForbidden(true)
        setLoading(false)
        return
      }

      setUser(userRow as UserData)

      const { data: profileData, error: profileErr } = await supabase
        .from('profiles')
        .select(
          'id, title, summary, seniorities, years_experience, years_total_experience, skills, certifications, branch_id, speciality_ids, work_modes, tjm_min, tjm_max, availability_date, availability_status, linkedin_url, visible, city, country, photo_url, cv_file_path, cv_parsing_status, ai_consent_at, verification_status, review_reason',
        )
        .eq('user_id', session.user.id)
        .maybeSingle()

      if (cancelled) return

      if (profileErr) {
        setErrorMsg(t('error'))
        setLoading(false)
        return
      }

      // Verrou CV (Lot CV obligatoire) : pas de ligne profil OU pas de CV
      // déposé (cv_file_path nul) → écran de blocage, pas de redirection
      // silencieuse ni de profil vide affiché.
      if (!profileData || !(profileData as { cv_file_path?: string | null }).cv_file_path) {
        setNeedsCv(true)
        setLoading(false)
        return
      }

      setProfile(profileData as unknown as Profile)

      const taxonomyPromise = userRow.domain_id
        ? fetch(
            `/api/taxonomy?locale=${encodeURIComponent(locale)}&domain_id=${encodeURIComponent(userRow.domain_id as string)}`,
            { cache: 'no-store' },
          )
            .then(r => (r.ok ? r.json() : { branches: [], specialities: [] }))
            .catch(() => ({ branches: [], specialities: [] }))
        : Promise.resolve({ branches: [], specialities: [] })

      const countriesPromise = fetch('/api/countries')
        .then(r => (r.ok ? r.json() : []))
        .catch(() => [])

      const [taxonomy, countriesData, expsRes, edusRes, langsRes] = await Promise.all([
        taxonomyPromise,
        countriesPromise,
        supabase
          .from('profile_experiences')
          .select(
            'role, employer, client_name, sector, start_date, end_date, is_current, description, experience_type, sort_order',
          )
          .eq('profile_id', profileData.id)
          .order('sort_order', { ascending: true }),
        supabase
          .from('profile_educations')
          .select('school, degree, field, start_year, end_year, location')
          .eq('profile_id', profileData.id)
          .order('end_year', { ascending: false, nullsFirst: true }),
        supabase
          .from('profile_languages')
          .select('language, level, is_primary')
          .eq('profile_id', profileData.id),
      ])

      if (cancelled) return

      setBranches((taxonomy.branches ?? []) as Branch[])
      setSpecialities((taxonomy.specialities ?? []) as Speciality[])
      setCountries((countriesData ?? []) as Country[])
      setExperiences((expsRes.data ?? []) as Experience[])
      setEducations((edusRes.data ?? []) as Education[])
      setLanguages((langsRes.data ?? []) as LanguageItem[])

      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [router, locale, t])

  const branchName = useMemo(() => {
    if (!profile?.branch_id) return null
    return branches.find(b => b.id === profile.branch_id)?.name ?? null
  }, [branches, profile])

  // Plusieurs spécialités désormais : on les nomme toutes, dans l'ordre choisi.
  const specialityName = useMemo(() => {
    const ids = profile?.speciality_ids ?? []
    if (ids.length === 0) return null
    const noms = ids
      .map(id => specialities.find(s => s.id === id)?.name)
      .filter((x): x is string => !!x)
    return noms.length > 0 ? noms.join(', ') : null
  }, [specialities, profile])

  const country = useMemo(() => {
    if (!profile?.country) return null
    const c = countries.find(x => x.code === profile.country)
    if (!c) return null
    const localized =
      locale === 'fr'
        ? c.name_fr
        : locale === 'es'
          ? c.name_es
          : locale === 'de'
            ? c.name_de
            : c.name_en
    return { ...c, displayName: localized || c.name_fr }
  }, [countries, profile, locale])

  const careerSorted = useMemo(() => {
    const items = experiences.filter(e => e.experience_type === 'career')
    return items.sort((a, b) => {
      const aEnd = a.is_current ? '9999-12-31' : a.end_date ?? a.start_date ?? '0000-01-01'
      const bEnd = b.is_current ? '9999-12-31' : b.end_date ?? b.start_date ?? '0000-01-01'
      return bEnd.localeCompare(aEnd)
    })
  }, [experiences])

  const projectsSorted = useMemo(() => {
    return experiences
      .filter(e => e.experience_type === 'project')
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  }, [experiences])

  const languagesSorted = useMemo(() => {
    return [...languages].sort((a, b) =>
      a.is_primary === b.is_primary ? 0 : a.is_primary ? -1 : 1,
    )
  }, [languages])

  const yearsExperience = profile?.years_total_experience ?? profile?.years_experience ?? null

  const formatMonthYear = (ymd: string | null) => {
    const d = safeDate(ymd)
    if (!d) return null
    return new Intl.DateTimeFormat(LOCALE_DATE_MAP[locale] ?? 'en-GB', {
      year: 'numeric',
      month: 'short',
    }).format(d)
  }

  const formatFullDate = (ymd: string | null) => {
    const d = safeDate(ymd)
    if (!d) return null
    return new Intl.DateTimeFormat(LOCALE_DATE_MAP[locale] ?? 'en-GB', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(d)
  }

  const formatYearRange = (start: string | null, end: string | null, isCurrent: boolean) => {
    const s = formatMonthYear(start) ?? '—'
    if (isCurrent) return t('labels.year_range_present', { from: s })
    const e = formatMonthYear(end)
    return e ? t('labels.year_range', { from: s, to: e }) : s
  }

  const toggleDesc = (key: string) => {
    setExpandedDesc(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const firstName = (user?.first_name ?? '').trim()
  const lastName = (user?.last_name ?? '').trim()
  const fullName = `${firstName} ${lastName}`.trim() || tCommon('user_fallback')
  const initials =
    ((firstName[0] ?? '') + (lastName[0] ?? '')).toUpperCase() ||
    fullName.substring(0, 2).toUpperCase() ||
    '??'
  // D1 : « profil vérifié » (pilote la sidebar via userIsVerified) = source de
  // vérité verification_status === 'approved', jamais users.is_verified.
  const isVerified = (profile?.verification_status ?? null) === 'approved'
  // Lot bandeau vérif : badge piloté par l'état réel (plus de vert affiché
  // à tort quand pending_admin_review).
  const verifState = deriveVerificationUiState({
    visible: profile?.visible ?? null,
    verificationStatus: profile?.verification_status ?? null,
  })
  const headline = profile?.title?.trim() || null
  const cityCountry = (() => {
    const parts: string[] = []
    if (profile?.city?.trim()) parts.push(profile.city.trim())
    if (country?.displayName) parts.push(country.displayName)
    return parts.length > 0 ? parts.join(', ') : null
  })()

  const tjmText =
    profile?.tjm_min != null && profile?.tjm_max != null
      ? t('header.tjm_range', { min: profile.tjm_min, max: profile.tjm_max })
      : null

  const availabilityKey: AvailabilityStatus | null = (() => {
    const v = profile?.availability_status
    if (v === 'available' || v === 'do_not_disturb') return v
    return null
  })()

  // Lot CV obligatoire — publication depuis Mon Profil. La validation (8
  // critères + CV prêt) est faite par l'API ; on relaie son verdict.
  const handlePublish = async () => {
    if (publishing) return
    setPublishMsg(null)
    setPublishing(true)
    try {
      const res = await secureFetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visible: true }),
      })
      const payload = await res.json().catch(() => ({} as Record<string, unknown>))
      if (!res.ok) {
        const code = (payload as { code?: string }).code
        const text =
          code === 'cv_not_ready'
            ? t('publish.error_cv')
            : code === 'incomplete'
              ? t('publish.error_incomplete')
              : t('publish.error_generic') /* jamais payload.error brut */
        setPublishMsg({ kind: 'error', text })
        setPublishing(false)
        return
      }
      // Succès : profil visible (vérif IA déjà lancée côté serveur, inline).
      setProfile(prev => (prev ? { ...prev, visible: true } : prev))
      setPublishMsg({ kind: 'success', text: t('publish.success') })
    } catch {
      setPublishMsg({ kind: 'error', text: t('publish.error_generic') })
    } finally {
      setPublishing(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────

  const sharedStyles = (
    <style>{`
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes fadeInUp {
        from { opacity: 0; transform: translateY(12px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.6; transform: scale(0.95); }
      }
      @keyframes shimmer {
        0% { background-position: -468px 0; }
        100% { background-position: 468px 0; }
      }
      .pulse-dot {
        width: 8px; height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
        animation: pulse 2s ease-in-out infinite;
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
        text-decoration: none;
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
        text-decoration: none;
      }
      .skel {
        background: linear-gradient(90deg, #f1f5f9 0%, #e2e8f0 50%, #f1f5f9 100%);
        background-size: 800px 100%;
        animation: shimmer 1.4s infinite linear;
        border-radius: 8px;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        font-size: 13px;
        font-weight: 500;
        padding: 6px 12px;
        border-radius: 999px;
        transition: transform 0.18s ease, box-shadow 0.18s ease;
      }
      .pill:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(15,23,42,0.06); }
      .icon-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        border-radius: 10px;
        background: #fff;
        border: 1px solid #e2e8f0;
        color: #475569;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        text-decoration: none;
        transition: all 0.18s ease;
      }
      .icon-btn:hover { border-color: #cbd5e1; background: #f8fafc; }
      @media (max-width: 767px) {
        .ds-layout { flex-direction: column !important; }
        .ds-sidebar { display: none !important; }
        .sk-sidebar { display: none !important; }
        .ds-main { padding: 16px !important; }
        .ds-header-pad { padding: 0 16px !important; }
        .profile-hero { flex-direction: column !important; align-items: flex-start !important; gap: 16px !important; }
        .profile-hero-avatar { width: 80px !important; height: 80px !important; font-size: 26px !important; }
        .top-actions { flex-wrap: wrap !important; gap: 8px !important; }
      }
      @media (min-width: 768px) {
        .ds-layout { flex-direction: row !important; }
        .ds-sidebar { display: flex !important; }
      }
    `}</style>
  )

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div className={jakarta.variable} style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: fontJakarta }}>
        {sharedStyles}
        <div className="ds-header-pad" style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '0 28px', height: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="skel" style={{ width: 140, height: 24 }} />
          <div className="skel" style={{ width: 80, height: 36 }} />
        </div>
        <div className="ds-layout" style={{ display: 'flex', minHeight: 'calc(100vh - 58px)' }}>
          <div className="ds-sidebar" style={{ width: 248, background: '#fff', borderRight: '1px solid #e2e8f0', padding: '22px 16px' }}>
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="skel" style={{ height: 36, marginBottom: 8 }} />
            ))}
          </div>
          <div className="ds-main" style={{ flex: 1, padding: 24 }}>
            <div className="skel" style={{ height: 56, marginBottom: 16 }} />
            <div className="skel" style={{ height: 180, marginBottom: 16 }} />
            <div className="skel" style={{ height: 140, marginBottom: 16 }} />
            <div className="skel" style={{ height: 140, marginBottom: 16 }} />
          </div>
        </div>
      </div>
    )
  }

  // ── Forbidden (not freelance) ──
  if (forbidden) {
    return (
      <div className={jakarta.variable} style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: fontJakarta, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        {sharedStyles}
        <div style={{ background: '#fff', border: '1px solid #fecaca', borderRadius: 16, padding: 32, maxWidth: 480, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#991b1b', margin: 0, marginBottom: 10 }}>{t('error')}</h1>
          <p style={{ fontSize: 14, color: '#7f1d1d', marginBottom: 20 }}>{t('not_freelance')}</p>
          <Link href="/" className="icon-btn" style={{ display: 'inline-flex' }}>
            ← {t('back_to_dashboard')}
          </Link>
        </div>
      </div>
    )
  }

  // ── Hard error ──
  if (errorMsg && !profile) {
    return (
      <div className={jakarta.variable} style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: fontJakarta, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        {sharedStyles}
        <div style={{ background: '#fff', border: '1px solid #fecaca', borderRadius: 16, padding: 32, maxWidth: 480, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#991b1b', margin: 0, marginBottom: 16 }}>{errorMsg}</h1>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="icon-btn"
          >
            {t('error_retry')}
          </button>
        </div>
      </div>
    )
  }

  // ── Coquille inline (header + sidebar + main) réutilisable pour les écrans
  // de blocage (CV manquant) : c'est une page de MENU, elle doit garder la
  // sidebar et le header — jamais un plein-écran orphelin qui piège l'user.
  const renderWithShell = (main: React.ReactNode) => (
    <div className={jakarta.variable} style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: fontJakarta }}>
      {sharedStyles}
      <div
        className="ds-header-pad"
        style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '0 28px', height: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <div />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <LanguageSwitcher />
        </div>
      </div>
      <div className="ds-layout" style={{ display: 'flex', minHeight: 'calc(100vh - 58px)' }}>
        <DashboardSidebar
          side="freelance"
          userName={fullName}
          userPhotoUrl={ownAvatarUrl}
          userIsVerified={isVerified}
          userSubtitle={tShell('user_subtitle.freelance', { ecosystem: domain.ecosystemName })}
        />
        <div className="ds-main" style={{ flex: 1, padding: 24, width: '100%' }}>{main}</div>
      </div>
    </div>
  )

  // ── Verrou CV (Lot CV obligatoire) ──
  // Aucun CV déposé → écran de blocage RENDU DANS LA COQUILLE (sidebar + header
  // présents, navigation possible), avec lien vers la page d'upload.
  if (needsCv) {
    return renderWithShell(
      <EmptyState
        icon="📄"
        title={t('cv_required.title')}
        body={t('cv_required.body')}
        action={
          <Link
            href="/dashboard/freelance/profil"
            style={{
              display: 'inline-block',
              background: domain.primaryColor,
              color: '#fff',
              borderRadius: 10,
              padding: '10px 18px',
              fontSize: 14,
              fontWeight: 600,
              textDecoration: 'none',
              fontFamily: fontJakarta,
            }}
          >
            {t('cv_required.cta')}
          </Link>
        }
      />,
    )
  }

  if (!profile || !user) return null

  const skills = Array.isArray(profile.skills) ? profile.skills.filter(s => s?.trim()) : []
  const certifications = Array.isArray(profile.certifications) ? profile.certifications.filter(c => c?.name?.trim()) : []
  const workModes = Array.isArray(profile.work_modes) ? profile.work_modes : []
  const hasLinks = !!profile.linkedin_url?.trim()
  const hasTjm = profile.tjm_min != null && profile.tjm_max != null
  const hasAvailability = !!profile.availability_date || !!profile.availability_status || workModes.length > 0
  const hasExpertise = !!branchName || !!specialityName || skills.length > 0

  // Bloc « refusé » : affiche le motif de refus (review_reason) + CTA de
  // re-soumission. Seul endroit où l'expert voit désormais le motif (bandeaux
  // de statut redondants retirés). Parité stricte avec cdi/mon-profil.
  const banner = verifState === 'rejected' && profile?.review_reason ? (
    <div
      role="alert"
      style={{
        background: '#FEF2F2',
        border: '1px solid #FECACA',
        color: '#991B1B',
        borderRadius: 10,
        padding: '10px 14px',
        marginBottom: 20,
        fontSize: 13,
        lineHeight: 1.55,
        maxWidth: 560,
      }}
    >
      <span style={{ fontWeight: 700 }}>{tRejected('reason_label')} </span>
      <span style={{ whiteSpace: 'pre-wrap' }}>{profile.review_reason}</span>
      <div style={{ marginTop: 8 }}>
        <Link
          href="/dashboard/freelance/profil/valider"
          style={{ fontSize: 13, fontWeight: 600, color: '#991B1B', textDecoration: 'underline' }}
        >
          {tRejected('cta')}
        </Link>
      </div>
    </div>
  ) : null

  return (
    <div className={jakarta.variable} style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: fontJakarta }}>
      {sharedStyles}

      {/* ─── Top header (logo + LanguageSwitcher) ─── */}
      <div
        className="ds-header-pad"
        style={{
          background: '#fff',
          borderBottom: '1px solid #e2e8f0',
          padding: '0 28px',
          height: 58,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          animation: 'fadeIn 0.3s ease',
        }}
      >
        {/* Brand retiré : la sidebar partagée (<DashboardSidebar/>) rend déjà
            le logo en haut → on évite le double logo. Spacer pour garder les
            actions (langue + badge) alignées à droite via space-between. */}
        <div />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <LanguageSwitcher />
          {/* C6 : pastille de statut = SOURCE UNIQUE (VerificationStatusPill),
              rendue par les 5 états réels. Fini le binaire approved/En attente
              qui affichait « En attente » sur un brouillon. */}
          <VerificationStatusPill state={verifState} />
        </div>
      </div>

      <div className="ds-layout" style={{ display: 'flex', minHeight: 'calc(100vh - 58px)' }}>
        {/* ─── Sidebar partagée (source unique de vérité, alignée sur le
            tableau de bord : Missions/Candidatures déverrouillées, vrais
            liens, alert/sous-traitance lockées si non vérifié). ─── */}
        <DashboardSidebar
          side="freelance"
          userName={fullName}
          userPhotoUrl={ownAvatarUrl}
          userIsVerified={isVerified}
          userSubtitle={tShell('user_subtitle.freelance', { ecosystem: domain.ecosystemName })}
        />

        {/* ─── Main ─── */}
        <div className="ds-main" style={{ flex: 1, padding: 24, width: '100%' }}>
          {/* En-tête : titre à gauche, actions à droite sur la même rangée */}
          <div
            className="top-actions"
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 10,
              background: '#f8fafc',
              padding: '12px 0',
              marginBottom: 12,
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 16,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontSize: 26, fontWeight: 700, color: '#0f172a', margin: 0, marginBottom: 6, letterSpacing: '-0.4px' }}>
                {t('page_title')}
              </h1>
              <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>{t('page_subtitle')}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Édition — secondaire (outline) ; garde le lien existant. */}
              <Link
                href="/dashboard/freelance/profil/valider"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '10px 18px',
                  borderRadius: 10,
                  background: '#fff',
                  color: domain.primaryColor,
                  border: `1.5px solid ${domain.primaryColor}`,
                  fontSize: 14,
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                {t('edit_button')}
              </Link>
              {/* Publier mon profil — primaire. La validation (8 critères +
                  CV prêt) est faite par l'API ; on relaie son verdict. */}
              <button
                type="button"
                onClick={handlePublish}
                disabled={publishing}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '10px 18px',
                  borderRadius: 10,
                  background: domain.primaryColor,
                  color: '#fff',
                  border: 'none',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: publishing ? 'not-allowed' : 'pointer',
                  opacity: publishing ? 0.6 : 1,
                  fontFamily: fontJakarta,
                  boxShadow: `0 6px 20px ${domain.primaryColor}33`,
                }}
              >
                {publishing ? t('publish.publishing') : t('publish.button')}
              </button>
            </div>
          </div>
          {publishMsg && (
            <div
              role="status"
              style={{
                marginBottom: 12,
                padding: '12px 16px',
                borderRadius: 10,
                fontSize: 13.5,
                lineHeight: 1.5,
                background: publishMsg.kind === 'success' ? '#dcfce7' : '#fef2f2',
                border: `1px solid ${publishMsg.kind === 'success' ? '#bbf7d0' : '#fecaca'}`,
                color: publishMsg.kind === 'success' ? '#166534' : '#991b1b',
              }}
            >
              {publishMsg.text}
            </div>
          )}

          {/* Bloc « refusé » (motif de refus) — sinon rien */}
          {banner}

          {/* Profile hero card */}
          <Card style={{ padding: '24px 26px' }}>
            <div className="profile-hero" style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
              {/* Lot global C3 : avatar wrappé dans un conteneur relative pour
                  recevoir le bouton overlay "Modifier la photo" (entry-point
                  du AvatarUploadModal — qui était jusque-là monté mais inatteignable). */}
              <div style={{ position: 'relative', display: 'inline-block', flexShrink: 0 }}>
                {ownAvatarUrl ? (
                  <img
                    src={ownAvatarUrl}
                    alt={fullName}
                    className="profile-hero-avatar"
                    style={{
                      width: 120,
                      height: 120,
                      borderRadius: '50%',
                      objectFit: 'cover',
                      border: `3px solid ${domain.primaryColor}22`,
                    }}
                  />
                ) : (
                  <div
                    className="profile-hero-avatar"
                    style={{
                      width: 120,
                      height: 120,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 40,
                      fontWeight: 700,
                      background: `linear-gradient(135deg, ${domain.primaryColor}44, ${domain.secondaryColor}44)`,
                      color: domain.primaryColor,
                      border: `3px solid ${domain.primaryColor}22`,
                    }}
                  >
                    {initials}
                  </div>
                )}
                <AvatarEditOverlay onClick={() => setAvatarModalOpen(true)} />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                  <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: 0, letterSpacing: '-0.4px' }}>
                    {fullName}
                  </h2>
                  {verifState === 'approved' ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        background: `${domain.primaryColor}14`,
                        color: domain.primaryColor,
                        border: `1px solid ${domain.primaryColor}40`,
                        borderRadius: 999,
                        padding: '3px 10px',
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" fill={domain.primaryColor} />
                        <path d="M8 12l3 3 5-5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {t('header.verified_badge')}
                    </span>
                  ) : (
                    (() => {
                      const c = verificationChipColors(verifState)
                      return (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            background: c.bg,
                            color: c.fg,
                            border: `1px solid ${c.border}`,
                            borderRadius: 999,
                            padding: '3px 10px',
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        >
                          {tVerifBadge(verifState)}
                        </span>
                      )
                    })()
                  )}
                </div>
                <div style={{ fontSize: 15, color: '#475569', fontWeight: 500, marginBottom: 8 }}>
                  {headline ?? <span style={{ fontStyle: 'italic', color: '#94a3b8' }}>{t('header.no_title')}</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 13, color: '#64748b' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {country?.flag_emoji ? <span aria-hidden style={{ fontSize: 16 }}>{country.flag_emoji}</span> : <span aria-hidden>📍</span>}
                    {cityCountry ?? <span style={{ fontStyle: 'italic', color: '#94a3b8' }}>{t('header.location_unknown')}</span>}
                  </span>
                  {yearsExperience != null && (
                    <>
                      <span style={{ color: '#cbd5e1' }}>·</span>
                      <span>{t('header.years_experience', { count: yearsExperience })}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Hero chips: TJM | availability */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 18, paddingTop: 18, borderTop: '1px solid #f1f5f9' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 14px',
                  borderRadius: 10,
                  background: `${domain.primaryColor}10`,
                  border: `1px solid ${domain.primaryColor}33`,
                  fontSize: 13,
                  fontWeight: 600,
                  color: domain.primaryColor,
                }}
              >
                <span aria-hidden>💶</span>
                {tjmText ?? t('header.tjm_not_set')}
              </div>
              {/* Pastille dispo de la carte profil : masquée tant que le profil
                  n'est pas approuvé (non visible aux clients → pas de "Disponible"). */}
              {availabilityKey && verifState === 'approved' && (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 14px',
                    borderRadius: 10,
                    background: '#fff',
                    border: '1px solid #e2e8f0',
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#0f172a',
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: AVAILABILITY_COLOR[availabilityKey] }} aria-hidden />
                  {t(`availability_status.${availabilityKey}`)}
                </div>
              )}
            </div>
          </Card>

          {/* ─── 1. Summary ─── */}
          <Card>
            <SectionHeader n={1} color={SECTION_PALETTE.summary} title={t('sections.summary')} />
            {profile.summary?.trim() ? (
              <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>
                {profile.summary.trim()}
              </p>
            ) : (
              <EmptyText>{t('empty_states.no_summary')}</EmptyText>
            )}
          </Card>

          {/* ─── 2. Expertise ─── */}
          <Card>
            <SectionHeader n={2} color={SECTION_PALETTE.expertise} title={t('sections.expertise')} />
            {hasExpertise ? (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: skills.length > 0 ? 18 : 0 }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600, marginBottom: 4 }}>
                      {t('labels.branch')}
                    </div>
                    <div style={{ fontSize: 14, color: '#0f172a', fontWeight: 500 }}>
                      {branchName ?? <EmptyText>{t('empty_states.no_branch')}</EmptyText>}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600, marginBottom: 4 }}>
                      {t('labels.specialty')}
                    </div>
                    <div style={{ fontSize: 14, color: '#0f172a', fontWeight: 500 }}>
                      {specialityName ?? <EmptyText>{t('empty_states.no_specialty')}</EmptyText>}
                    </div>
                  </div>
                </div>
                {skills.length > 0 ? (
                  <div>
                    <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600, marginBottom: 8 }}>
                      {t('labels.skills')}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {skills.map(s => (
                        <span
                          key={s}
                          className="pill"
                          style={{
                            background: `${domain.primaryColor}14`,
                            color: domain.primaryColor,
                            border: `1px solid ${domain.primaryColor}33`,
                          }}
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <EmptyText>{t('empty_states.no_skills')}</EmptyText>
                )}
              </div>
            ) : (
              <EmptyText>{t('empty_states.no_skills')}</EmptyText>
            )}
          </Card>

          {/* ─── 3. Certifications ─── */}
          <Card>
            <SectionHeader n={3} color={SECTION_PALETTE.certifications} title={t('sections.certifications')} />
            {certifications.length > 0 ? (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {certifications.map((c, i) => (
                  <li
                    key={`cert-${i}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 0',
                      borderBottom: i < certifications.length - 1 ? '1px solid #f1f5f9' : 'none',
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: SECTION_PALETTE.certifications, flexShrink: 0 }} aria-hidden />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{c.name}</div>
                      {(c.issuer || c.year) && (
                        <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
                          {c.issuer && <span>{c.issuer}</span>}
                          {c.issuer && c.year && <span> · </span>}
                          {c.year && <span>{c.year}</span>}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyText>{t('empty_states.no_certifications')}</EmptyText>
            )}
          </Card>

          {/* ─── 4. Career ─── */}
          <Card>
            <SectionHeader n={4} color={SECTION_PALETTE.career} title={t('sections.career')} />
            {careerSorted.length > 0 ? (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {careerSorted.map((e, i) => {
                  const key = `career-${i}`
                  const desc = e.description?.trim()
                  return (
                    <li
                      key={key}
                      style={{
                        position: 'relative',
                        padding: '14px 0 14px 16px',
                        borderBottom: i < careerSorted.length - 1 ? '1px solid #f1f5f9' : 'none',
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 18,
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: SECTION_PALETTE.career,
                        }}
                      />
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                            {e.role || '—'}
                            {e.employer && <span style={{ fontWeight: 500, color: '#475569' }}> · {e.employer}</span>}
                          </div>
                          <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
                            {formatYearRange(e.start_date, e.end_date, e.is_current)}
                            {e.sector && <span> · {e.sector}</span>}
                          </div>
                        </div>
                        {e.is_current && (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              padding: '3px 8px',
                              borderRadius: 999,
                              background: `${SECTION_PALETTE.career}1c`,
                              color: SECTION_PALETTE.career,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {t('labels.current_position')}
                          </span>
                        )}
                      </div>
                      {desc && (
                        <ExpandableDescription
                          text={desc}
                          expanded={expandedDesc.has(key)}
                          onToggle={() => toggleDesc(key)}
                          tMore={t('labels.see_more')}
                          tLess={t('labels.see_less')}
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <EmptyText>{t('empty_states.no_career')}</EmptyText>
            )}
          </Card>

          {/* ─── 5. Missions / Projects ─── */}
          <Card>
            <SectionHeader n={5} color={SECTION_PALETTE.missions} title={t('sections.missions')} />
            {projectsSorted.length > 0 ? (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {projectsSorted.map((e, i) => {
                  const key = `proj-${i}`
                  const desc = e.description?.trim()
                  return (
                    <li
                      key={key}
                      style={{
                        position: 'relative',
                        padding: '14px 0 14px 16px',
                        borderBottom: i < projectsSorted.length - 1 ? '1px solid #f1f5f9' : 'none',
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 18,
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: SECTION_PALETTE.missions,
                        }}
                      />
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                            {e.role || '—'}
                            {e.client_name && <span style={{ fontWeight: 500, color: '#475569' }}> · {t('labels.client')} : {e.client_name}</span>}
                          </div>
                          <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
                            {formatYearRange(e.start_date, e.end_date, e.is_current)}
                            {e.sector && <span> · {t('labels.sector')} : {e.sector}</span>}
                          </div>
                        </div>
                        {e.is_current && (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              padding: '3px 8px',
                              borderRadius: 999,
                              background: `${SECTION_PALETTE.missions}1c`,
                              color: SECTION_PALETTE.missions,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {t('labels.current_mission')}
                          </span>
                        )}
                      </div>
                      {desc && (
                        <ExpandableDescription
                          text={desc}
                          expanded={expandedDesc.has(key)}
                          onToggle={() => toggleDesc(key)}
                          tMore={t('labels.see_more')}
                          tLess={t('labels.see_less')}
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <EmptyText>{t('empty_states.no_missions')}</EmptyText>
            )}
          </Card>

          {/* ─── 6. Education ─── */}
          <Card>
            <SectionHeader n={6} color={SECTION_PALETTE.education} title={t('sections.education')} />
            {educations.length > 0 ? (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {educations.map((edu, i) => (
                  <li
                    key={`edu-${i}`}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '12px 0',
                      borderBottom: i < educations.length - 1 ? '1px solid #f1f5f9' : 'none',
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: SECTION_PALETTE.education, flexShrink: 0, marginTop: 6 }} aria-hidden />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                        {edu.degree || '—'}
                        {edu.field && <span style={{ fontWeight: 500, color: '#475569' }}> · {edu.field}</span>}
                      </div>
                      <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
                        {edu.school && <span>{edu.school}</span>}
                        {(edu.start_year || edu.end_year) && (
                          <span>
                            {edu.school ? ' · ' : ''}
                            {edu.start_year && edu.end_year
                              ? t('labels.year_range', { from: edu.start_year, to: edu.end_year })
                              : edu.end_year
                                ? `${edu.end_year}`
                                : edu.start_year && t('labels.since', { year: edu.start_year })}
                          </span>
                        )}
                        {edu.location && <span> · {edu.location}</span>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyText>{t('empty_states.no_education')}</EmptyText>
            )}
          </Card>

          {/* ─── 7. Languages ─── */}
          <Card>
            <SectionHeader n={7} color={SECTION_PALETTE.languages} title={t('sections.languages')} />
            {languagesSorted.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {languagesSorted.map((l, i) => (
                  <span
                    key={`lang-${i}`}
                    className="pill"
                    style={{
                      background: `${SECTION_PALETTE.languages}14`,
                      color: '#92400e',
                      border: `1px solid ${SECTION_PALETTE.languages}55`,
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{l.language}</span>
                    <span style={{ margin: '0 6px', opacity: 0.5 }}>·</span>
                    <span>{t(`labels.level_${l.level}`)}</span>
                    {l.is_primary && (
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: 6,
                          background: SECTION_PALETTE.languages,
                          color: '#fff',
                        }}
                      >
                        ★
                      </span>
                    )}
                  </span>
                ))}
              </div>
            ) : (
              <EmptyText>{t('empty_states.no_languages')}</EmptyText>
            )}
          </Card>

          {/* ─── 8. Availability ─── */}
          <Card>
            <SectionHeader n={8} color={SECTION_PALETTE.availability} title={t('sections.availability')} />
            {hasAvailability ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {workModes.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600, marginBottom: 6 }}>
                      {t('labels.work_modes')}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {workModes.map(m => (
                        <span
                          key={m}
                          className="pill"
                          style={{
                            background: `${SECTION_PALETTE.availability}14`,
                            color: '#065f46',
                            border: `1px solid ${SECTION_PALETTE.availability}55`,
                          }}
                        >
                          {t(`labels.work_mode_${m}`)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {profile.availability_date && (
                  <div style={{ fontSize: 14, color: '#0f172a' }}>
                    📅 {t('labels.available_from', { date: formatFullDate(profile.availability_date) ?? profile.availability_date })}
                  </div>
                )}
                {availabilityKey && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#0f172a' }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: AVAILABILITY_COLOR[availabilityKey] }} aria-hidden />
                    {t(`availability_status.${availabilityKey}`)}
                  </div>
                )}
                {cityCountry && (
                  <div style={{ fontSize: 14, color: '#475569' }}>
                    {country?.flag_emoji ? <span aria-hidden>{country.flag_emoji} </span> : '📍 '}
                    {cityCountry}
                  </div>
                )}
              </div>
            ) : (
              <EmptyText>{t('empty_states.no_availability')}</EmptyText>
            )}
          </Card>

          {/* ─── 9. Links ─── */}
          <Card style={{ marginBottom: 30 }}>
            <SectionHeader n={9} color={SECTION_PALETTE.links} title={t('sections.links')} />
            {hasLinks ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <a
                  href={profile.linkedin_url!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="icon-btn"
                  style={{ display: 'inline-flex' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M20.5 2h-17A1.5 1.5 0 002 3.5v17A1.5 1.5 0 003.5 22h17a1.5 1.5 0 001.5-1.5v-17A1.5 1.5 0 0020.5 2zM8 19H5V8h3v11zM6.5 6.7a1.7 1.7 0 110-3.4 1.7 1.7 0 010 3.4zM19 19h-3v-5.6c0-1.4-.5-2.4-1.7-2.4a1.9 1.9 0 00-1.8 1.3c-.1.2-.1.5-.1.8V19h-3V8h3v1.3a3 3 0 012.7-1.5c2 0 3.5 1.3 3.5 4V19z" />
                  </svg>
                  {t('labels.linkedin')}
                  <span aria-hidden style={{ marginLeft: 4, fontSize: 11, color: '#94a3b8' }}>↗</span>
                </a>
              </div>
            ) : (
              <EmptyText>{t('empty_states.no_links')}</EmptyText>
            )}
          </Card>

          <div style={{ textAlign: 'center', padding: '20px 0 30px' }}>
            <Link
              href="/dashboard/freelance/profil/valider"
              style={{ fontSize: 13, color: domain.primaryColor, textDecoration: 'none', fontWeight: 600 }}
            >
              {t('edit_button')}
            </Link>
          </div>
        </div>
      </div>

      {/* Lot global C3 : modal d'upload photo (entry-point unique).
          Le modal s'occupe lui-même de l'upload Storage + PATCH /api/profile.
          On patch optimistiquement le state local au succès.
          Lot global C3 (micro-ajout) : émet `sk:profile-changed` →
          DashboardShell refetch le profil → avatar sidebar INSTANTANÉ. */}
      <AvatarUploadModal
        open={avatarModalOpen}
        onClose={() => setAvatarModalOpen(false)}
      />
    </div>
  )
}
