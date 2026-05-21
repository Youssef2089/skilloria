'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { Plus_Jakarta_Sans } from 'next/font/google'
import { useDomain } from '@/context/DomainContext'
import { supabase } from '@/lib/supabase'
import { useSecureLogout } from '@/lib/secure-fetch'
import LanguageSwitcher from '@/components/LanguageSwitcher'

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
type AvailabilityStatus = 'available' | 'busy_soon' | 'unavailable'

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
  seniority: Seniority | null
  years_experience: number | null
  years_total_experience: number | null
  skills: string[] | null
  certifications: Certification[] | null
  branch_id: string | null
  speciality_id: string | null
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
}

type UserData = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  is_verified: boolean | null
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
  busy_soon: '#f59e0b',
  unavailable: '#9ca3af',
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
  const tDash = useTranslations('dashboard_freelance')
  const tCommon = useTranslations('common')
  const locale = useLocale()
  const router = useRouter()
  const domain = useDomain()
  const secureLogout = useSecureLogout()

  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [user, setUser] = useState<UserData | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [experiences, setExperiences] = useState<Experience[]>([])
  const [educations, setEducations] = useState<Education[]>([])
  const [languages, setLanguages] = useState<LanguageItem[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [specialities, setSpecialities] = useState<Speciality[]>([])
  const [countries, setCountries] = useState<Country[]>([])
  const [expandedDesc, setExpandedDesc] = useState<Set<string>>(new Set())

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
        .select('id, email, first_name, last_name, is_verified, user_type, domain_id')
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
          'id, title, summary, seniority, years_experience, years_total_experience, skills, certifications, branch_id, speciality_id, work_modes, tjm_min, tjm_max, availability_date, availability_status, linkedin_url, visible, city, country, photo_url',
        )
        .eq('user_id', session.user.id)
        .maybeSingle()

      if (cancelled) return

      if (profileErr) {
        setErrorMsg(t('error'))
        setLoading(false)
        return
      }

      if (!profileData) {
        router.push('/dashboard/freelance/profil')
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

  const specialityName = useMemo(() => {
    if (!profile?.speciality_id) return null
    return specialities.find(s => s.id === profile.speciality_id)?.name ?? null
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
  const isVerified = user?.is_verified === true
  const isVisible = profile?.visible === true
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
    if (v === 'available' || v === 'busy_soon' || v === 'unavailable') return v
    return null
  })()

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
          <div className="ds-main" style={{ flex: 1, padding: 30 }}>
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

  if (!profile || !user) return null

  const skills = Array.isArray(profile.skills) ? profile.skills.filter(s => s?.trim()) : []
  const certifications = Array.isArray(profile.certifications) ? profile.certifications.filter(c => c?.name?.trim()) : []
  const workModes = Array.isArray(profile.work_modes) ? profile.work_modes : []
  const hasLinks = !!profile.linkedin_url?.trim()
  const hasTjm = profile.tjm_min != null && profile.tjm_max != null
  const hasAvailability = !!profile.availability_date || !!profile.availability_status || workModes.length > 0
  const hasExpertise = !!branchName || !!specialityName || skills.length > 0

  // Banner publication
  const banner = isVisible ? (
    <div
      style={{
        background: '#dcfce7',
        border: '1px solid #bbf7d0',
        borderRadius: 12,
        padding: '14px 18px',
        marginBottom: 20,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        animation: 'fadeInUp 0.4s ease both',
      }}
    >
      <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>✓</span>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#15803d', marginBottom: 2 }}>
          {t('publication_status.published_banner_title')}
        </div>
        <div style={{ fontSize: 13, color: '#166534', lineHeight: 1.5 }}>
          {t('publication_status.published_banner_text')}
        </div>
      </div>
    </div>
  ) : (
    <div
      style={{
        background: '#fffbeb',
        border: '1px solid #fde68a',
        borderRadius: 12,
        padding: '14px 18px',
        marginBottom: 20,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        animation: 'fadeInUp 0.4s ease both',
      }}
    >
      <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>⏳</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#92400e', marginBottom: 2 }}>
          {t('publication_status.draft_banner_title')}
        </div>
        <div style={{ fontSize: 13, color: '#92400e', lineHeight: 1.5, marginBottom: 10 }}>
          {t('publication_status.draft_banner_text')}
        </div>
        <Link
          href="/dashboard/freelance/profil/valider"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            fontSize: 13,
            fontWeight: 600,
            color: '#92400e',
            background: '#fff',
            border: '1px solid #fde68a',
            borderRadius: 8,
            padding: '8px 14px',
            textDecoration: 'none',
          }}
        >
          {t('publication_status.draft_banner_cta')}
        </Link>
      </div>
    </div>
  )

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: domain.primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {domain.logoUrl ? (
              <img src={domain.logoUrl} alt={domain.name} width={18} height={18} />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L12 22M2 12L22 12M5 5L19 19M19 5L5 19" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            )}
          </div>
          <span style={{ fontSize: 17, fontWeight: 700, color: '#111827' }}>{domain.name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <LanguageSwitcher />
          {isVerified ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#dcfce7', border: '1px solid #bbf7d0', padding: '7px 16px', borderRadius: 20 }}>
              <div className="pulse-dot" style={{ background: '#22c55e' }} />
              <span style={{ fontSize: 13, fontWeight: 500, color: '#15803d', whiteSpace: 'nowrap' }}>
                {tDash('topbar.available')}
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fef9c3', border: '1px solid #fde68a', padding: '7px 16px', borderRadius: 20 }}>
              <div className="pulse-dot" style={{ background: '#eab308' }} />
              <span style={{ fontSize: 13, fontWeight: 500, color: '#92400e', whiteSpace: 'nowrap' }}>
                {tDash('topbar.pending')}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="ds-layout" style={{ display: 'flex', minHeight: 'calc(100vh - 58px)' }}>
        {/* ─── Sidebar (duplicated from dashboard, with "Mon profil" active) ─── */}
        <div className="ds-sidebar" style={{ width: 248, background: '#fff', borderRight: '1px solid #e2e8f0', padding: '22px 0', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '0 20px 20px', marginBottom: 14, borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>
            <div style={{ position: 'relative', display: 'inline-block', marginBottom: 14 }}>
              {profile.photo_url ? (
                <img
                  src={profile.photo_url}
                  alt={fullName}
                  style={{
                    width: 76,
                    height: 76,
                    borderRadius: '50%',
                    objectFit: 'cover',
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 76,
                    height: 76,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 26,
                    fontWeight: 600,
                    background: `linear-gradient(135deg, ${domain.primaryColor}44, ${domain.secondaryColor}44)`,
                    color: domain.primaryColor,
                  }}
                >
                  {initials}
                </div>
              )}
              <div className="pulse-dot" style={{ position: 'absolute', bottom: 3, right: 3, width: 14, height: 14, background: isVerified ? '#22c55e' : '#eab308', border: '2px solid #fff' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginBottom: 5 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>{fullName}</div>
              {isVerified && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" fill={domain.primaryColor} />
                  <path d="M8 12l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>
              {tDash('sidebar.role_freelance')} · {domain.ecosystemName}
            </div>
          </div>

          <div style={{ fontSize: 11, color: '#9ca3af', padding: '8px 20px 6px', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600 }}>
            {tDash('sidebar.sections.main')}
          </div>
          <Link href="/dashboard/freelance" className="nav-item">
            {tDash('sidebar.nav.dashboard')}
          </Link>
          <Link href="/dashboard/freelance/mon-profil" className="nav-item-active">
            {tDash('sidebar.nav.profile')}
          </Link>
          <div className="nav-item" style={{ color: isVerified ? '#4b5563' : '#d1d5db', cursor: isVerified ? 'pointer' : 'not-allowed' }}>
            {tDash('sidebar.nav.missions')}
            {!isVerified && <span style={{ fontSize: 12 }}>🔒</span>}
          </div>
          <div className="nav-item" style={{ color: isVerified ? '#4b5563' : '#d1d5db', cursor: isVerified ? 'pointer' : 'not-allowed' }}>
            {tDash('sidebar.nav.applications')}
            {!isVerified && <span style={{ fontSize: 12 }}>🔒</span>}
          </div>
          <div className="nav-item">{tDash('sidebar.nav.messages')}</div>

          <div style={{ fontSize: 11, color: '#9ca3af', padding: '16px 20px 6px', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600 }}>
            {tDash('sidebar.sections.publish')}
          </div>
          <div className="nav-item" style={{ color: isVerified ? domain.primaryColor : '#d1d5db', cursor: isVerified ? 'pointer' : 'not-allowed' }}>
            {tDash('sidebar.nav.availability_alert')}
            {!isVerified && <span style={{ fontSize: 12 }}>🔒</span>}
          </div>
          <div className="nav-item" style={{ color: isVerified ? domain.primaryColor : '#d1d5db', cursor: isVerified ? 'pointer' : 'not-allowed' }}>
            {tDash('sidebar.nav.subcontracting')}
            {!isVerified && <span style={{ fontSize: 12 }}>🔒</span>}
          </div>

          <div style={{ fontSize: 11, color: '#9ca3af', padding: '16px 20px 6px', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600 }}>
            {tDash('sidebar.sections.account')}
          </div>
          <div className="nav-item">{tDash('sidebar.nav.payments')}</div>
          <div className="nav-item">{tDash('sidebar.nav.settings')}</div>

          <div style={{ marginTop: 'auto', padding: '16px 8px 0', borderTop: '1px solid #e2e8f0' }}>
            <div
              className="nav-item"
              style={{ color: '#ef4444' }}
              onClick={() => void secureLogout({ redirectTo: '/' })}
            >
              {tDash('sidebar.nav.logout')}
            </div>
          </div>
        </div>

        {/* ─── Main ─── */}
        <div className="ds-main" style={{ flex: 1, padding: 30, maxWidth: 960, width: '100%' }}>
          {/* Sticky action bar */}
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
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <Link href="/dashboard/freelance" className="icon-btn">
              {t('back_to_dashboard')}
            </Link>
            <Link
              href="/dashboard/freelance/profil/valider"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 18px',
                borderRadius: 10,
                background: domain.primaryColor,
                color: '#fff',
                fontSize: 14,
                fontWeight: 600,
                textDecoration: 'none',
                boxShadow: `0 6px 20px ${domain.primaryColor}33`,
                transition: 'transform 0.18s ease, box-shadow 0.18s ease',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'translateY(-1px)'
                e.currentTarget.style.boxShadow = `0 8px 24px ${domain.primaryColor}55`
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = `0 6px 20px ${domain.primaryColor}33`
              }}
            >
              {t('edit_button')}
            </Link>
          </div>

          {/* Page title */}
          <div style={{ marginBottom: 16, animation: 'fadeInUp 0.4s ease both' }}>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: '#0f172a', margin: 0, marginBottom: 6, letterSpacing: '-0.4px' }}>
              {t('page_title')}
            </h1>
            <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>{t('page_subtitle')}</p>
          </div>

          {/* Banner publication */}
          {banner}

          {/* Profile hero card */}
          <Card style={{ padding: '24px 26px' }}>
            <div className="profile-hero" style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
              {profile.photo_url ? (
                <img
                  src={profile.photo_url}
                  alt={fullName}
                  className="profile-hero-avatar"
                  style={{
                    width: 120,
                    height: 120,
                    borderRadius: '50%',
                    objectFit: 'cover',
                    flexShrink: 0,
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
                    flexShrink: 0,
                    border: `3px solid ${domain.primaryColor}22`,
                  }}
                >
                  {initials}
                </div>
              )}

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                  <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: 0, letterSpacing: '-0.4px' }}>
                    {fullName}
                  </h2>
                  {isVerified && (
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
              {availabilityKey && (
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
    </div>
  )
}
