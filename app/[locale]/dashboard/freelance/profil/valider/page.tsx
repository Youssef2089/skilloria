'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Plus_Jakarta_Sans } from 'next/font/google'
import { useDomain } from '@/context/DomainContext'
import { supabase } from '@/lib/supabase'
import { useSecureFetch } from '@/lib/secure-fetch'
import CountrySelect from '@/components/CountrySelect'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import CompactListItem from '@/components/CompactListItem'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
})

const fontJakarta = 'var(--font-jakarta), system-ui, sans-serif'
const fontInter = 'Inter, system-ui, sans-serif'

type Seniority = 'junior' | 'confirmed' | 'senior' | 'expert'
type WorkMode = 'remote' | 'onsite' | 'hybrid'
type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'native'
type ExperienceType = 'career' | 'project'

type Certification = {
  _uid?: string
  name: string
  issuer: string | null
  year: number | null
}

type Branch = { id: string; name: string; slug: string }
type Speciality = { id: string; name: string; slug: string; branch_id: string }

type ExperienceItem = {
  _uid?: string
  experience_type: ExperienceType
  role: string
  employer: string
  client_name: string
  sector: string
  start_date: string
  end_date: string
  is_current: boolean
  description: string
}

type EducationItem = {
  _uid?: string
  school: string
  degree: string
  field: string
  start_year: string
  end_year: string
  location: string
}

type LanguageItem = {
  _uid?: string
  language: string
  level: CefrLevel
  is_primary: boolean
}

function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `_${Math.random().toString(36).slice(2, 11)}_${Date.now()}`
}

function ensureUid<T extends { _uid?: string }>(item: T): T {
  return item._uid ? item : { ...item, _uid: uid() }
}

const SENIORITY_VALUES: Seniority[] = ['junior', 'confirmed', 'senior', 'expert']
const WORK_MODE_VALUES: WorkMode[] = ['remote', 'onsite', 'hybrid']
const CEFR_LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native']

const FIELD_ORDER = [
  'title',
  'summary',
  'skills',
  'branch_id',
  'speciality_id',
  'work_modes',
  'experiences',
  'languages_structured',
] as const

type FieldKey = (typeof FIELD_ORDER)[number]

function emptyExperience(type: ExperienceType): ExperienceItem {
  return {
    _uid: uid(),
    experience_type: type,
    role: '',
    employer: '',
    client_name: '',
    sector: '',
    start_date: '',
    end_date: '',
    is_current: false,
    description: '',
  }
}

function emptyEducation(): EducationItem {
  return {
    _uid: uid(),
    school: '',
    degree: '',
    field: '',
    start_year: '',
    end_year: '',
    location: '',
  }
}

function emptyLanguage(): LanguageItem {
  return { _uid: uid(), language: '', level: 'B2', is_primary: false }
}

function emptyCertification(): Certification {
  return { _uid: uid(), name: '', issuer: null, year: null }
}

function SectionHeader({
  n,
  color,
  title,
  action,
}: {
  n: string
  color: string
  title: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 18,
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
      {action}
    </div>
  )
}

const SECTION_COLORS = {
  identite: '',
  expertise: '#6366f1',
  certifications: '#a855f7',
  disponibilite: '#10b981',
  liens: '#06b6d4',
  coordonnees: '#f59e0b',
  parcours: '#ec4899',
  missions: '#f43f5e',
  formation: '#14b8a6',
} as const

export default function ValiderProfilPage() {
  const router = useRouter()
  const domain = useDomain()
  const secureFetch = useSecureFetch()
  const tProfile = useTranslations('profile_validation')
  const locale = useLocale()

  const SENIORITY_LABELS: Record<Seniority, string> = {
    junior: tProfile('sections.identity.seniority_options.junior'),
    confirmed: tProfile('sections.identity.seniority_options.confirmed'),
    senior: tProfile('sections.identity.seniority_options.senior'),
    expert: tProfile('sections.identity.seniority_options.expert'),
  }
  const WORK_MODE_LABELS: Record<WorkMode, string> = {
    remote: tProfile('sections.availability.work_mode_remote'),
    onsite: tProfile('sections.availability.work_mode_onsite'),
    hybrid: tProfile('sections.availability.work_mode_hybrid'),
  }
  const CEFR_LABELS: Record<CefrLevel, string> = {
    A1: tProfile('sections.availability.level_options.A1'),
    A2: tProfile('sections.availability.level_options.A2'),
    B1: tProfile('sections.availability.level_options.B1'),
    B2: tProfile('sections.availability.level_options.B2'),
    C1: tProfile('sections.availability.level_options.C1'),
    C2: tProfile('sections.availability.level_options.C2'),
    native: tProfile('sections.availability.level_options.native'),
  }
  const FIELD_LABELS: Record<FieldKey, string> = {
    title: tProfile('field_labels_short.title'),
    summary: tProfile('field_labels_short.summary'),
    skills: tProfile('field_labels_short.skills'),
    branch_id: tProfile('field_labels_short.branch_id'),
    speciality_id: tProfile('field_labels_short.speciality_id'),
    work_modes: tProfile('field_labels_short.work_modes'),
    experiences: tProfile('field_labels_short.experiences'),
    languages_structured: tProfile('field_labels_short.languages_structured'),
  }
  const FIELD_INLINE_ERRORS: Record<FieldKey, string> = {
    title: tProfile('field_errors.title'),
    summary: tProfile('field_errors.summary'),
    skills: tProfile('field_errors.skills'),
    branch_id: tProfile('field_errors.branch_id'),
    speciality_id: tProfile('field_errors.speciality_id'),
    work_modes: tProfile('field_errors.work_modes'),
    experiences: tProfile('field_errors.experiences'),
    languages_structured: tProfile('field_errors.languages_structured'),
  }

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [missingFields, setMissingFields] = useState<string[] | null>(null)
  const [parsingFailed, setParsingFailed] = useState(false)

  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [specialities, setSpecialities] = useState<Speciality[]>([])

  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [seniority, setSeniority] = useState<Seniority | ''>('')
  const [yearsExperience, setYearsExperience] = useState('')
  const [branchId, setBranchId] = useState('')
  const [specialityId, setSpecialityId] = useState('')
  const [skills, setSkills] = useState<string[]>([])
  const [skillDraft, setSkillDraft] = useState('')
  const [certifications, setCertifications] = useState<Certification[]>([])
  const [workModes, setWorkModes] = useState<WorkMode[]>([])
  const [location, setLocation] = useState('')
  const [tjmMin, setTjmMin] = useState('')
  const [tjmMax, setTjmMax] = useState('')
  const [availabilityDate, setAvailabilityDate] = useState('')
  const [linkedinUrl, setLinkedinUrl] = useState('')

  const [languagesStructured, setLanguagesStructured] = useState<LanguageItem[]>([])

  const [phone, setPhone] = useState('')
  const [birthYear, setBirthYear] = useState('')
  const [addressLine, setAddressLine] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [city, setCity] = useState('')
  const [country, setCountry] = useState('FR')

  const [experiences, setExperiences] = useState<ExperienceItem[]>([])
  const [educations, setEducations] = useState<EducationItem[]>([])

  const fieldRefs = {
    title: useRef<HTMLInputElement>(null),
    summary: useRef<HTMLTextAreaElement>(null),
    skills: useRef<HTMLDivElement>(null),
    branch_id: useRef<HTMLSelectElement>(null),
    speciality_id: useRef<HTMLSelectElement>(null),
    work_modes: useRef<HTMLDivElement>(null),
    experiences: useRef<HTMLDivElement>(null),
    languages_structured: useRef<HTMLDivElement>(null),
  }

  const [focusedField, setFocusedField] = useState<FieldKey | null>(null)

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)

  type SectionKey = 'cert' | 'lang' | 'career' | 'project' | 'edu'
  const [expandedSections, setExpandedSections] = useState<Set<SectionKey>>(new Set())
  const SHOW_MORE_THRESHOLD = 3

  const toggleExpand = (id: string) =>
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleSection = (key: SectionKey) =>
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  useEffect(() => {
    if (!focusedField) return
    const t = setTimeout(() => setFocusedField(null), 1500)
    return () => clearTimeout(t)
  }, [focusedField])

  const showFieldError = (missing: string[]) => {
    setErrorMsg(tProfile('errors.incomplete_check_below'))
    setMissingFields(missing)

    const firstMissing = FIELD_ORDER.find(f => missing.includes(f))
    if (!firstMissing) return

    setTimeout(() => {
      const el = fieldRefs[firstMissing].current
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setFocusedField(firstMissing)
      if (typeof (el as HTMLElement).focus === 'function') {
        setTimeout(() => (el as HTMLElement).focus({ preventScroll: true }), 400)
      }
    }, 100)
  }

  const FieldError = ({ field }: { field: FieldKey }) =>
    isMissing(field) ? (
      <div
        style={{
          fontSize: 12,
          color: '#dc2626',
          marginTop: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: fontJakarta,
        }}
      >
        <span aria-hidden>⚠️</span> {FIELD_INLINE_ERRORS[field]}
      </div>
    ) : null

  const focusClass = (field: FieldKey) =>
    focusedField === field ? 'sk-focus-highlight' : undefined

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        router.push('/connexion')
        return
      }
      if (cancelled) return
      setAccessToken(session.access_token)

      const { data: userRow, error: userErr } = await supabase
        .from('users')
        .select('domain_id')
        .eq('id', session.user.id)
        .single()
      if (userErr || !userRow) {
        if (!cancelled) {
          setErrorMsg(tProfile('errors.account_load_failed'))
          setLoading(false)
        }
        return
      }
      const domainId = userRow.domain_id as string

      const { data: profile, error: profErr } = await supabase
        .from('profiles')
        .select(
          'id, title, summary, seniority, years_experience, skills, certifications, branch_id, speciality_id, languages, location, work_modes, tjm_min, tjm_max, availability_date, linkedin_url, cv_parsing_status, visible, phone, address_line, postal_code, city, country, birth_year, photo_url, years_total_experience, availability_status',
        )
        .eq('user_id', session.user.id)
        .single()

      if (profErr || !profile) {
        router.push('/dashboard/freelance/profil')
        return
      }
      if (cancelled) return

      setParsingFailed(profile.cv_parsing_status === 'failed')
      setTitle(profile.title ?? '')
      setSummary(profile.summary ?? '')
      setSeniority((profile.seniority as Seniority | null) ?? '')
      setYearsExperience(
        profile.years_experience != null ? String(profile.years_experience) : '',
      )
      setBranchId(profile.branch_id ?? '')
      setSpecialityId(profile.speciality_id ?? '')
      setSkills(Array.isArray(profile.skills) ? (profile.skills as string[]) : [])
      setCertifications(
        Array.isArray(profile.certifications)
          ? (profile.certifications as Certification[]).map(ensureUid)
          : [],
      )
      setWorkModes(
        Array.isArray(profile.work_modes) ? (profile.work_modes as WorkMode[]) : [],
      )
      setLocation(profile.location ?? '')
      setTjmMin(profile.tjm_min != null ? String(profile.tjm_min) : '')
      setTjmMax(profile.tjm_max != null ? String(profile.tjm_max) : '')
      setAvailabilityDate(profile.availability_date ?? '')
      setLinkedinUrl(profile.linkedin_url ?? '')

      setPhone(profile.phone ?? '')
      setBirthYear(profile.birth_year != null ? String(profile.birth_year) : '')
      setAddressLine(profile.address_line ?? '')
      setPostalCode(profile.postal_code ?? '')
      setCity(profile.city ?? '')
      setCountry(profile.country ?? 'FR')

      const taxonomyPromise = fetch(
        `/api/taxonomy?locale=${encodeURIComponent(locale)}&domain_id=${encodeURIComponent(domainId)}`,
        { cache: 'no-store' },
      )
        .then(r => (r.ok ? r.json() : { branches: [], specialities: [] }))
        .catch(() => ({ branches: [], specialities: [] }))

      const [taxonomy, { data: exps }, { data: edus }, { data: langs }] =
        await Promise.all([
          taxonomyPromise,
          supabase
            .from('profile_experiences')
            .select(
              'role, employer, client_name, sector, start_date, end_date, is_current, description, experience_type, sort_order',
            )
            .eq('profile_id', profile.id)
            .order('sort_order', { ascending: true }),
          supabase
            .from('profile_educations')
            .select('school, degree, field, start_year, end_year, location')
            .eq('profile_id', profile.id)
            .order('end_year', { ascending: false, nullsFirst: true }),
          supabase
            .from('profile_languages')
            .select('language, level, is_primary')
            .eq('profile_id', profile.id),
        ])
      const brs = taxonomy.branches as Branch[] | undefined
      const sps = taxonomy.specialities as Speciality[] | undefined
      if (cancelled) return

      setBranches((brs ?? []) as Branch[])
      setSpecialities((sps ?? []) as Speciality[])

      const raw: Array<ExperienceItem & { _so: number }> = (exps ?? []).map(
        (e: any) => ({
          _uid: uid(),
          experience_type: (e.experience_type ?? 'career') as ExperienceType,
          role: e.role ?? '',
          employer: e.employer ?? '',
          client_name: e.client_name ?? '',
          sector: e.sector ?? '',
          start_date: e.start_date ?? '',
          end_date: e.end_date ?? '',
          is_current: !!e.is_current,
          description: e.description ?? '',
          _so: typeof e.sort_order === 'number' ? e.sort_order : 0,
        }),
      )

      const careers = raw
        .filter(e => e.experience_type === 'career')
        .sort((a, b) => {
          const aEnd = a.end_date || '9999-12-31'
          const bEnd = b.end_date || '9999-12-31'
          if (aEnd !== bEnd) return bEnd.localeCompare(aEnd)
          return (b.start_date || '').localeCompare(a.start_date || '')
        })
      const projects = raw
        .filter(e => e.experience_type === 'project')
        .sort((a, b) => a._so - b._so)

      setExperiences(
        [...careers, ...projects].map(({ _so, ...rest }) => rest),
      )

      setEducations(
        (edus ?? []).map((e: any) => ({
          _uid: uid(),
          school: e.school ?? '',
          degree: e.degree ?? '',
          field: e.field ?? '',
          start_year: e.start_year != null ? String(e.start_year) : '',
          end_year: e.end_year != null ? String(e.end_year) : '',
          location: e.location ?? '',
        })),
      )

      setLanguagesStructured(
        (langs ?? []).map((l: any) => ({
          _uid: uid(),
          language: l.language ?? '',
          level: (l.level ?? 'B2') as CefrLevel,
          is_primary: !!l.is_primary,
        })),
      )

      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [router])

  const branchesById = useMemo(
    () => new Map(branches.map(b => [b.id, b])),
    [branches],
  )
  const specialitiesById = useMemo(
    () => new Map(specialities.map(s => [s.id, s])),
    [specialities],
  )
  const filteredSpecialities = useMemo(
    () => (branchId ? specialities.filter(s => s.branch_id === branchId) : []),
    [branchId, specialities],
  )

  const careerEntries = useMemo(
    () =>
      experiences
        .map((e, i) => ({ ...e, _idx: i }))
        .filter(e => e.experience_type === 'career'),
    [experiences],
  )
  const projectEntries = useMemo(
    () =>
      experiences
        .map((e, i) => ({ ...e, _idx: i }))
        .filter(e => e.experience_type === 'project'),
    [experiences],
  )

  const onBranchChange = (id: string) => {
    setBranchId(id)
    if (specialityId) {
      const sp = specialitiesById.get(specialityId)
      if (!sp || sp.branch_id !== id) setSpecialityId('')
    }
  }

  const addSkill = () => {
    const s = skillDraft.trim()
    if (!s) return
    if (!skills.includes(s)) setSkills([...skills, s])
    setSkillDraft('')
  }
  const removeSkill = (s: string) => setSkills(skills.filter(x => x !== s))

  const addCert = () => {
    const item = emptyCertification()
    setCertifications([...certifications, item])
    setExpandedIds(prev => new Set(prev).add(item._uid!))
  }
  const updateCert = (i: number, patch: Partial<Certification>) =>
    setCertifications(
      certifications.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    )
  const removeCert = (i: number) =>
    setCertifications(certifications.filter((_, idx) => idx !== i))

  const addLanguage = () => {
    const item = emptyLanguage()
    setLanguagesStructured([...languagesStructured, item])
    setExpandedIds(prev => new Set(prev).add(item._uid!))
  }
  const updateLanguage = (i: number, patch: Partial<LanguageItem>) =>
    setLanguagesStructured(
      languagesStructured.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    )
  const removeLanguage = (i: number) =>
    setLanguagesStructured(languagesStructured.filter((_, idx) => idx !== i))
  const setLanguagePrimary = (i: number) =>
    setLanguagesStructured(
      languagesStructured.map((l, idx) => ({ ...l, is_primary: idx === i })),
    )

  const addExperience = (type: ExperienceType) => {
    const item = emptyExperience(type)
    setExperiences([...experiences, item])
    setExpandedIds(prev => new Set(prev).add(item._uid!))
  }
  const updateExperience = (i: number, patch: Partial<ExperienceItem>) =>
    setExperiences(experiences.map((e, idx) => (idx === i ? { ...e, ...patch } : e)))
  const removeExperience = (i: number) =>
    setExperiences(experiences.filter((_, idx) => idx !== i))

  const toggleWorkMode = (m: WorkMode) =>
    setWorkModes(prev =>
      prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m],
    )

  const addEducation = () => {
    const item = emptyEducation()
    setEducations([...educations, item])
    setExpandedIds(prev => new Set(prev).add(item._uid!))
  }
  const updateEducation = (i: number, patch: Partial<EducationItem>) =>
    setEducations(educations.map((e, idx) => (idx === i ? { ...e, ...patch } : e)))
  const removeEducation = (i: number) =>
    setEducations(educations.filter((_, idx) => idx !== i))

  // ── Confirm delete helpers ──
  const requestDelete = (id: string) => setConfirmingDeleteId(id)
  const cancelDelete = () => setConfirmingDeleteId(null)
  const confirmDeleteAndRun = (id: string, runDelete: () => void) => () => {
    runDelete()
    setConfirmingDeleteId(null)
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  const validateForPublish = (): string[] => {
    const missing: string[] = []
    if (!title.trim()) missing.push('title')
    if (!summary.trim() || summary.trim().length < 20) missing.push('summary')
    if (skills.length < 3) missing.push('skills')
    if (!branchId) missing.push('branch_id')
    if (!specialityId) missing.push('speciality_id')
    if (workModes.length === 0) missing.push('work_modes')
    if (experiences.filter(e => e.role.trim()).length < 1) missing.push('experiences')
    if (languagesStructured.filter(l => l.language.trim()).length < 1)
      missing.push('languages_structured')
    return missing
  }

  const save = async (visible: boolean) => {
    if (!accessToken || saving) return
    setErrorMsg(null)
    setSuccessMsg(null)
    setMissingFields(null)

    if (visible) {
      const missing = validateForPublish()
      if (missing.length) {
        showFieldError(missing)
        return
      }
    }

    setSaving(true)

    const cleanedExperiences = experiences
      .filter(e => e.role.trim())
      .map(e => ({
        experience_type: e.experience_type,
        role: e.role.trim(),
        employer: e.employer.trim() || null,
        client_name: e.client_name.trim() || null,
        sector: e.sector.trim() || null,
        start_date: e.start_date || '',
        end_date: e.is_current ? null : e.end_date || null,
        is_current: e.is_current,
        description: e.description.trim() || null,
      }))

    const cleanedEducations = educations
      .filter(e => e.school.trim() && e.degree.trim())
      .map(e => ({
        school: e.school.trim(),
        degree: e.degree.trim(),
        field: e.field.trim() || null,
        start_year: e.start_year === '' ? null : Number(e.start_year),
        end_year: e.end_year === '' ? null : Number(e.end_year),
        location: e.location.trim() || null,
      }))

    const cleanedLanguages = languagesStructured
      .filter(l => l.language.trim())
      .map(l => ({
        language: l.language.trim(),
        level: l.level,
        is_primary: l.is_primary,
      }))

    const body: Record<string, unknown> = {
      title: title.trim() || null,
      summary: summary.trim() || null,
      seniority: seniority || null,
      years_experience:
        yearsExperience.trim() === '' ? null : Number(yearsExperience),
      skills,
      certifications: certifications
        .filter(c => c.name.trim())
        .map(c => ({
          name: c.name.trim(),
          issuer: c.issuer?.toString().trim() || null,
          year: c.year ?? null,
        })),
      branch_slug: branchId ? branchesById.get(branchId)?.slug ?? null : null,
      speciality_slug: specialityId
        ? specialitiesById.get(specialityId)?.slug ?? null
        : null,
      languages: cleanedLanguages.map(l => l.language),
      location: location.trim() || null,
      work_modes: workModes,
      tjm_min: tjmMin.trim() === '' ? null : Number(tjmMin),
      tjm_max: tjmMax.trim() === '' ? null : Number(tjmMax),
      availability_date: availabilityDate || null,
      linkedin_url: linkedinUrl.trim() || null,
      phone: phone.trim() || null,
      address_line: addressLine.trim() || null,
      postal_code: postalCode.trim() || null,
      city: city.trim() || null,
      country: country || null,
      birth_year: birthYear.trim() === '' ? null : Number(birthYear),
      experiences: cleanedExperiences,
      educations: cleanedEducations,
      languages_structured: cleanedLanguages,
      visible,
    }

    try {
      // accessToken state reste comme guard "session prête" — secureFetch
      // s'occupe d'injecter Authorization + cookie + interception 403 (11F).
      const res = await secureFetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await res.json().catch(() => ({} as any))

      if (!res.ok) {
        if (
          res.status === 400 &&
          payload?.code === 'incomplete' &&
          Array.isArray(payload?.missing)
        ) {
          showFieldError(payload.missing)
        } else {
          setErrorMsg(payload?.error || tProfile('errors.save_failed'))
        }
        setSaving(false)
        return
      }

      if (visible) {
        router.push('/dashboard/freelance')
        return
      }

      setSuccessMsg(tProfile('success.draft_saved'))
      setSaving(false)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      console.error('[profil valider] patch error', err)
      setErrorMsg(tProfile('errors.save_failed'))
      setSaving(false)
    }
  }

  const isMissing = (field: string) =>
    Array.isArray(missingFields) && missingFields.includes(field)

  const inputStyle = (field?: string): React.CSSProperties => ({
    width: '100%',
    padding: '10px 14px',
    border: `1.5px solid ${field && isMissing(field) ? '#dc2626' : '#e2e8f0'}`,
    borderRadius: 10,
    fontSize: 14,
    color: '#0f172a',
    outline: 'none',
    background: '#fff',
    fontFamily: 'inherit',
  })

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#374151',
    marginBottom: 6,
    fontFamily: fontJakarta,
  }

  const sectionStyle: React.CSSProperties = {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 16,
    padding: 24,
    marginBottom: 20,
  }

  const primaryAddBtnStyle: React.CSSProperties = {
    background: domain.primaryColor,
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    padding: '10px 18px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    flexShrink: 0,
    fontFamily: fontJakarta,
  }

  const inlineAddBtnStyle: React.CSSProperties = {
    background: `${domain.primaryColor}14`,
    color: domain.primaryColor,
    border: `1px solid ${domain.primaryColor}33`,
    borderRadius: 8,
    padding: '6px 12px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: fontJakarta,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  }

  // Formatters pour le titre compact des cards
  const formatDate = (s: string) => {
    if (!s) return ''
    const m = s.match(/^(\d{4})-(\d{2})/)
    if (!m) return s
    return `${m[2]}/${m[1]}`
  }
  const formatExperienceSubtitle = (e: ExperienceItem) => {
    const start = formatDate(e.start_date)
    const end = e.is_current ? '…' : formatDate(e.end_date)
    if (!start && !end) return ''
    return `${start || '—'} → ${end || '—'}`
  }

  const tagStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: `${domain.primaryColor}15`,
    color: domain.primaryColor,
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    fontFamily: fontJakarta,
  }

  const ShowMoreToggle = ({
    sectionKey,
    total,
    labelKey,
  }: {
    sectionKey: SectionKey
    total: number
    labelKey:
      | 'show_more_certifications'
      | 'show_more_career'
      | 'show_more_missions'
      | 'show_more_education'
      | 'show_more_languages'
  }) => {
    if (total <= SHOW_MORE_THRESHOLD) return null
    const isOpen = expandedSections.has(sectionKey)
    return (
      <button
        type="button"
        onClick={() => toggleSection(sectionKey)}
        className="show-more-btn"
        style={{
          display: 'block',
          margin: '12px auto 0',
          background: 'transparent',
          color: domain.primaryColor,
          border: `1px solid ${domain.primaryColor}33`,
          borderRadius: 999,
          padding: '8px 18px',
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: fontJakarta,
          transition: 'transform 150ms ease, background 150ms ease',
        }}
      >
        {isOpen ? tProfile('show_less') : tProfile(labelKey, { count: total })}
      </button>
    )
  }

  const renderExperienceFields = (
    exp: ExperienceItem,
    idx: number,
    type: ExperienceType,
  ) => {
    const isCareer = type === 'career'
    return (
      <>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>
            {isCareer
              ? tProfile('sections.career.role_label')
              : tProfile('sections.missions.role_label')}
          </label>
          <input
            type="text"
            value={exp.role}
            onChange={e => updateExperience(idx, { role: e.target.value })}
            placeholder={
              isCareer
                ? tProfile('sections.career.role_placeholder')
                : tProfile('sections.missions.role_placeholder')
            }
            style={inputStyle()}
          />
        </div>

        {isCareer ? (
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>{tProfile('sections.career.employer_label')}</label>
            <input
              type="text"
              value={exp.employer}
              onChange={e => updateExperience(idx, { employer: e.target.value })}
              placeholder={tProfile('sections.career.employer_placeholder')}
              style={inputStyle()}
            />
          </div>
        ) : (
          <div
            className="profil-row"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div>
              <label style={labelStyle}>{tProfile('sections.missions.client_label')}</label>
              <input
                type="text"
                value={exp.client_name}
                onChange={e =>
                  updateExperience(idx, { client_name: e.target.value })
                }
                placeholder={tProfile('sections.missions.client_placeholder')}
                style={inputStyle()}
              />
            </div>
            <div>
              <label style={labelStyle}>{tProfile('sections.missions.sector_label')}</label>
              <input
                type="text"
                value={exp.sector}
                onChange={e => updateExperience(idx, { sector: e.target.value })}
                placeholder={tProfile('sections.missions.sector_placeholder')}
                style={inputStyle()}
              />
            </div>
          </div>
        )}

        <div
          className="profil-row"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 12,
            marginBottom: 8,
          }}
        >
          <div>
            <label style={labelStyle}>{tProfile('sections.experience_card.start_date_label')}</label>
            <input
              type="date"
              value={exp.start_date}
              onChange={e => updateExperience(idx, { start_date: e.target.value })}
              style={inputStyle()}
            />
          </div>
          <div>
            <label style={labelStyle}>{tProfile('sections.experience_card.end_date_label')}</label>
            <input
              type="date"
              value={exp.is_current ? '' : exp.end_date}
              disabled={exp.is_current}
              onChange={e => updateExperience(idx, { end_date: e.target.value })}
              style={{ ...inputStyle(), opacity: exp.is_current ? 0.55 : 1 }}
            />
          </div>
        </div>

        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
            cursor: 'pointer',
            fontSize: 13,
            color: '#374151',
            fontWeight: 500,
            fontFamily: fontJakarta,
          }}
        >
          <input
            type="checkbox"
            checked={exp.is_current}
            onChange={e =>
              updateExperience(idx, {
                is_current: e.target.checked,
                end_date: e.target.checked ? '' : exp.end_date,
              })
            }
            style={{ accentColor: domain.primaryColor }}
          />
          {isCareer
            ? tProfile('sections.career.is_current_label')
            : tProfile('sections.missions.is_current_label')}
        </label>

        <div>
          <label style={labelStyle}>{tProfile('sections.experience_card.description_label')}</label>
          <textarea
            rows={isCareer ? 4 : 6}
            value={exp.description}
            onChange={e => updateExperience(idx, { description: e.target.value })}
            placeholder={
              isCareer
                ? tProfile('sections.career.description_placeholder')
                : tProfile('sections.missions.description_placeholder')
            }
            style={{
              ...inputStyle(),
              resize: 'vertical',
              minHeight: isCareer ? 96 : 140,
            }}
          />
        </div>
      </>
    )
  }

  return (
    <div
      className={jakarta.variable}
      style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: fontInter }}
    >
      <style>{`
        @keyframes sk-spin { to { transform: rotate(360deg); } }
        @keyframes sk-focus-ring {
          0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0); }
          50% { box-shadow: 0 0 0 4px rgba(220, 38, 38, 0.25); }
        }
        .sk-focus-highlight { animation: sk-focus-ring 0.7s ease-out 2; border-radius: 10px; }
        @keyframes sk-fade-in {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .compact-extra { animation: sk-fade-in 200ms ease-out both; }
        .show-more-btn:hover { transform: translateY(-1px); background: ${domain.primaryColor}10; }
        @media (max-width: 767px) {
          .profil-main { padding: 18px !important; }
          .profil-title { font-size: 26px !important; }
          .profil-row { grid-template-columns: 1fr !important; }
          .profil-actions {
            position: sticky; bottom: 0; z-index: 20;
            margin-left: -18px; margin-right: -18px;
            border-radius: 0; border-top: 1px solid #e2e8f0;
            padding: 14px 18px;
            flex-direction: column-reverse;
          }
        }
      `}</style>

      {/* Header */}
      <div
        style={{
          background: '#fff',
          borderBottom: '1px solid #e5e7eb',
          padding: '0 20px',
          height: 58,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: domain.primaryColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {domain.logoUrl ? (
              <img src={domain.logoUrl} alt={domain.name} width={18} height={18} />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 2L12 22M2 12L22 12M5 5L19 19M19 5L5 19"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </div>
          <span
            style={{
              fontSize: 17,
              fontWeight: 700,
              color: '#111827',
              fontFamily: fontJakarta,
            }}
          >
            {domain.name}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <LanguageSwitcher />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: '#fef9c3',
              border: '1px solid #fde68a',
              padding: '7px 14px',
              borderRadius: 20,
            }}
          >
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#eab308' }} />
            <span
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: '#92400e',
                whiteSpace: 'nowrap',
                fontFamily: fontJakarta,
              }}
            >
              {tProfile('topbar_pending')}
            </span>
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="profil-main" style={{ maxWidth: 860, margin: '0 auto', padding: 32 }}>
        {loading ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 80,
              color: '#64748b',
              fontSize: 14,
              fontFamily: fontJakarta,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                border: `3px solid ${domain.primaryColor}22`,
                borderTopColor: domain.primaryColor,
                marginBottom: 16,
                animation: 'sk-spin 0.9s linear infinite',
              }}
            />
            {tProfile('loading')}
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => router.push('/dashboard/freelance/profil')}
              style={{
                background: 'transparent',
                border: 'none',
                color: domain.primaryColor,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                padding: 0,
                marginBottom: 24,
                fontFamily: fontJakarta,
              }}
            >
              {tProfile('back_link')}
            </button>

            {errorMsg && (
              <div
                role="alert"
                aria-live="assertive"
                style={{
                  position: 'sticky',
                  top: 16,
                  zIndex: 50,
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 12,
                  padding: '12px 16px',
                  marginBottom: 20,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  boxShadow: '0 6px 24px rgba(220, 38, 38, 0.08)',
                }}
              >
                <div
                  style={{
                    color: '#dc2626',
                    fontSize: 13,
                    flex: 1,
                    lineHeight: 1.55,
                    fontFamily: fontJakarta,
                  }}
                >
                  {Array.isArray(missingFields) && missingFields.length > 0
                    ? tProfile('banner_error', {
                        count: missingFields.length,
                        fields: missingFields
                          .filter((f): f is FieldKey => f in FIELD_LABELS)
                          .map(f => FIELD_LABELS[f])
                          .join(', '),
                      })
                    : errorMsg}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null)
                    setMissingFields(null)
                  }}
                  aria-label={tProfile('close_aria')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#991b1b',
                    fontSize: 20,
                    cursor: 'pointer',
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  ×
                </button>
              </div>
            )}

            {successMsg && !errorMsg && (
              <div
                role="status"
                aria-live="polite"
                style={{
                  position: 'sticky',
                  top: 16,
                  zIndex: 50,
                  background: '#ecfdf5',
                  border: '1px solid #a7f3d0',
                  borderRadius: 12,
                  padding: '12px 16px',
                  marginBottom: 20,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  boxShadow: '0 6px 24px rgba(16, 185, 129, 0.10)',
                }}
              >
                <div
                  style={{
                    color: '#065f46',
                    fontSize: 13,
                    flex: 1,
                    lineHeight: 1.55,
                    fontFamily: fontJakarta,
                    fontWeight: 600,
                  }}
                >
                  ✅ {successMsg}
                </div>
                <button
                  type="button"
                  onClick={() => router.push('/dashboard/freelance')}
                  style={{
                    background: '#10b981',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    padding: '8px 14px',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontFamily: fontJakarta,
                    flexShrink: 0,
                  }}
                >
                  {tProfile('success.back_to_dashboard')}
                </button>
                <button
                  type="button"
                  onClick={() => setSuccessMsg(null)}
                  aria-label={tProfile('close_aria')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#065f46',
                    fontSize: 20,
                    cursor: 'pointer',
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  ×
                </button>
              </div>
            )}

            {parsingFailed && !errorMsg && !successMsg && (
              <div
                style={{
                  background: '#fff7ed',
                  border: '1px solid #fed7aa',
                  borderRadius: 12,
                  padding: '12px 16px',
                  marginBottom: 20,
                  fontSize: 13,
                  color: '#9a3412',
                  lineHeight: 1.55,
                  fontFamily: fontJakarta,
                }}
              >
                {tProfile('parsing_failed_message')}
              </div>
            )}

            <h1
              className="profil-title"
              style={{
                fontSize: 32,
                fontWeight: 800,
                color: '#0f172a',
                letterSpacing: '-0.3px',
                marginBottom: 8,
                fontFamily: fontJakarta,
              }}
            >
              {tProfile('page_title')}
            </h1>
            <p
              style={{
                fontSize: 15,
                color: '#64748b',
                lineHeight: 1.6,
                marginBottom: 20,
                maxWidth: 640,
                fontFamily: fontJakarta,
              }}
            >
              {tProfile('page_subtitle')}
            </p>

            <div
              style={{
                background: `${domain.primaryColor}10`,
                border: `1px solid ${domain.primaryColor}33`,
                borderRadius: 12,
                padding: '12px 16px',
                marginBottom: 24,
                fontSize: 13,
                color: domain.primaryColor,
                fontWeight: 500,
                fontFamily: fontJakarta,
              }}
            >
              {tProfile('ai_banner')}
            </div>

            {/* Section 1 — Identité pro */}
            <div style={sectionStyle}>
              <SectionHeader n="1" color={domain.primaryColor} title={tProfile('sections.identity.title')} />

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>{tProfile('sections.identity.title_label')}</label>
                <input
                  ref={fieldRefs.title}
                  className={focusClass('title')}
                  type="text"
                  maxLength={200}
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder={tProfile('sections.identity.title_placeholder')}
                  style={inputStyle('title')}
                />
                <FieldError field="title" />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>{tProfile('sections.identity.summary_label')}</label>
                <textarea
                  ref={fieldRefs.summary}
                  className={focusClass('summary')}
                  rows={4}
                  maxLength={500}
                  value={summary}
                  onChange={e => setSummary(e.target.value)}
                  placeholder={tProfile('sections.identity.summary_placeholder')}
                  style={{ ...inputStyle('summary'), resize: 'vertical', minHeight: 100 }}
                />
                <div
                  style={{
                    fontSize: 11,
                    color: '#94a3b8',
                    marginTop: 4,
                    fontFamily: fontJakarta,
                  }}
                >
                  {tProfile('sections.identity.summary_counter', { count: summary.trim().length })}
                </div>
                <FieldError field="summary" />
              </div>

              <div
                className="profil-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                }}
              >
                <div>
                  <label style={labelStyle}>{tProfile('sections.identity.seniority_label')}</label>
                  <select
                    value={seniority}
                    onChange={e => setSeniority(e.target.value as Seniority | '')}
                    style={inputStyle()}
                  >
                    <option value="">{tProfile('sections.identity.seniority_placeholder')}</option>
                    {SENIORITY_VALUES.map(s => (
                      <option key={s} value={s}>
                        {SENIORITY_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>{tProfile('sections.identity.years_label')}</label>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    value={yearsExperience}
                    onChange={e => setYearsExperience(e.target.value)}
                    style={inputStyle()}
                  />
                </div>
              </div>
            </div>

            {/* Section 2 — Expertise */}
            <div style={sectionStyle}>
              <SectionHeader n="2" color={SECTION_COLORS.expertise} title={tProfile('sections.expertise.title')} />

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>{tProfile('sections.expertise.branch_label')}</label>
                <select
                  ref={fieldRefs.branch_id}
                  className={focusClass('branch_id')}
                  value={branchId}
                  onChange={e => onBranchChange(e.target.value)}
                  style={inputStyle('branch_id')}
                >
                  <option value="">{tProfile('sections.expertise.branch_placeholder')}</option>
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <FieldError field="branch_id" />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>{tProfile('sections.expertise.speciality_label')}</label>
                <select
                  ref={fieldRefs.speciality_id}
                  className={focusClass('speciality_id')}
                  value={specialityId}
                  onChange={e => setSpecialityId(e.target.value)}
                  disabled={!branchId}
                  style={{ ...inputStyle('speciality_id'), opacity: branchId ? 1 : 0.55 }}
                >
                  <option value="">{tProfile('sections.expertise.speciality_placeholder')}</option>
                  {filteredSpecialities.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <FieldError field="speciality_id" />
              </div>

              <div
                ref={fieldRefs.skills}
                className={focusClass('skills')}
                style={{ padding: 2 }}
              >
                <label style={labelStyle}>
                  {tProfile('sections.expertise.skills_label')}{' '}
                  <span style={{ color: '#94a3b8', fontWeight: 400 }}>
                    · {skills.length}{' '}
                    {skills.length < 3 ? tProfile('sections.expertise.skills_min_hint') : ''}
                  </span>
                </label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <input
                    type="text"
                    value={skillDraft}
                    onChange={e => setSkillDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addSkill()
                      }
                    }}
                    placeholder={tProfile('sections.expertise.skills_placeholder')}
                    style={{ ...inputStyle('skills'), flex: 1 }}
                  />
                  <button type="button" onClick={addSkill} style={primaryAddBtnStyle}>
                    {tProfile('sections.expertise.skills_add_button')}
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {skills.map(s => (
                    <span key={s} style={tagStyle}>
                      {s}
                      <button
                        type="button"
                        onClick={() => removeSkill(s)}
                        aria-label={tProfile('sections.expertise.skill_remove_aria', { name: s })}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: domain.primaryColor,
                          cursor: 'pointer',
                          fontSize: 14,
                          lineHeight: 1,
                          padding: 0,
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <FieldError field="skills" />
              </div>
            </div>

            {/* Section 3 — Certifications */}
            <div style={sectionStyle}>
              <SectionHeader
                n="3"
                color={SECTION_COLORS.certifications}
                title={tProfile('sections.certifications.title')}
                action={
                  <button type="button" onClick={addCert} style={inlineAddBtnStyle}>
                    {tProfile('sections.certifications.add_button')}
                  </button>
                }
              />

              {certifications.length === 0 && (
                <div
                  style={{
                    fontSize: 13,
                    color: '#94a3b8',
                    padding: '10px 0 14px',
                    fontFamily: fontJakarta,
                  }}
                >
                  {tProfile('sections.certifications.empty')}
                </div>
              )}

              {(expandedSections.has('cert')
                ? certifications
                : certifications.slice(0, SHOW_MORE_THRESHOLD)
              ).map((c, i) => (
                <div
                  key={c._uid}
                  className={i >= SHOW_MORE_THRESHOLD ? 'compact-extra' : undefined}
                >
                <CompactListItem
                  id={c._uid!}
                  title={c.name || tProfile('sections.certifications.name_placeholder')}
                  subtitle={[c.issuer, c.year].filter(Boolean).join(' · ')}
                  isExpanded={expandedIds.has(c._uid!)}
                  onToggleExpand={() => toggleExpand(c._uid!)}
                  confirmingDelete={confirmingDeleteId === c._uid}
                  onRequestDelete={() => requestDelete(c._uid!)}
                  onConfirmDelete={confirmDeleteAndRun(c._uid!, () => removeCert(i))}
                  onCancelDelete={cancelDelete}
                  accentColor={SECTION_COLORS.certifications}
                >
                  <div
                    className="profil-row"
                    style={{ display: 'grid', gridTemplateColumns: '2fr 1.3fr 0.7fr', gap: 10 }}
                  >
                    <div>
                      <label style={labelStyle}>{tProfile('sections.certifications.name_label')}</label>
                      <input
                        type="text"
                        value={c.name}
                        onChange={e => updateCert(i, { name: e.target.value })}
                        placeholder={tProfile('sections.certifications.name_placeholder')}
                        style={inputStyle()}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>{tProfile('sections.certifications.issuer_label')}</label>
                      <input
                        type="text"
                        value={c.issuer ?? ''}
                        onChange={e => updateCert(i, { issuer: e.target.value || null })}
                        placeholder={tProfile('sections.certifications.issuer_placeholder')}
                        style={inputStyle()}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>{tProfile('sections.certifications.year_label')}</label>
                      <input
                        type="number"
                        min={1990}
                        max={new Date().getFullYear() + 1}
                        value={c.year ?? ''}
                        onChange={e =>
                          updateCert(i, {
                            year: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        style={inputStyle()}
                      />
                    </div>
                  </div>
                </CompactListItem>
                </div>
              ))}

              <ShowMoreToggle
                sectionKey="cert"
                total={certifications.length}
                labelKey="show_more_certifications"
              />
            </div>

            {/* Section 4 — Disponibilité */}
            <div style={sectionStyle}>
              <SectionHeader
                n="4"
                color={SECTION_COLORS.disponibilite}
                title={tProfile('sections.availability.title')}
              />

              <div
                ref={fieldRefs.work_modes}
                className={focusClass('work_modes')}
                style={{ marginBottom: 14 }}
              >
                <label style={labelStyle}>
                  {tProfile('sections.availability.work_modes_label')}{' '}
                  <span style={{ color: '#94a3b8', fontWeight: 400 }}>
                    · {tProfile('sections.availability.work_modes_hint')}
                  </span>
                </label>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {WORK_MODE_VALUES.map(m => {
                    const active = workModes.includes(m)
                    return (
                      <label
                        key={m}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '10px 14px',
                          border: `1.5px solid ${
                            active
                              ? domain.primaryColor
                              : isMissing('work_modes')
                                ? '#dc2626'
                                : '#e2e8f0'
                          }`,
                          borderRadius: 10,
                          background: active ? `${domain.primaryColor}10` : '#fff',
                          cursor: 'pointer',
                          fontSize: 13,
                          fontWeight: 600,
                          color: active ? domain.primaryColor : '#374151',
                          fontFamily: fontJakarta,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={() => toggleWorkMode(m)}
                          style={{ accentColor: domain.primaryColor }}
                        />
                        {WORK_MODE_LABELS[m]}
                      </label>
                    )
                  })}
                </div>
                <FieldError field="work_modes" />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>{tProfile('sections.availability.location_label')}</label>
                <input
                  type="text"
                  maxLength={100}
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  placeholder={tProfile('sections.availability.location_placeholder')}
                  style={inputStyle()}
                />
              </div>

              <div
                className="profil-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                  marginBottom: 14,
                }}
              >
                <div>
                  <label style={labelStyle}>{tProfile('sections.availability.tjm_min_label')}</label>
                  <input
                    type="number"
                    min={0}
                    value={tjmMin}
                    onChange={e => setTjmMin(e.target.value)}
                    style={inputStyle()}
                  />
                </div>
                <div>
                  <label style={labelStyle}>{tProfile('sections.availability.tjm_max_label')}</label>
                  <input
                    type="number"
                    min={0}
                    value={tjmMax}
                    onChange={e => setTjmMax(e.target.value)}
                    style={inputStyle()}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>{tProfile('sections.availability.available_from_label')}</label>
                <input
                  type="date"
                  value={availabilityDate}
                  onChange={e => setAvailabilityDate(e.target.value)}
                  style={inputStyle()}
                />
              </div>

              {/* Langues CEFR */}
              <div
                ref={fieldRefs.languages_structured}
                className={focusClass('languages_structured')}
                style={{ padding: 2 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>
                    {tProfile('sections.availability.languages_label')}{' '}
                    <span style={{ color: '#94a3b8', fontWeight: 400 }}>
                      · {languagesStructured.filter(l => l.language.trim()).length}
                      {languagesStructured.filter(l => l.language.trim()).length < 1
                        ? ' ' + tProfile('sections.availability.languages_min_hint')
                        : ''}
                    </span>
                  </label>
                  <button type="button" onClick={addLanguage} style={inlineAddBtnStyle}>
                    {tProfile('sections.availability.language_add_button')}
                  </button>
                </div>

                {languagesStructured.length === 0 && (
                  <div
                    style={{
                      fontSize: 13,
                      color: '#94a3b8',
                      padding: '4px 0 10px',
                      fontFamily: fontJakarta,
                    }}
                  >
                    {tProfile('sections.availability.languages_empty')}
                  </div>
                )}

                {(expandedSections.has('lang')
                  ? languagesStructured
                  : languagesStructured.slice(0, SHOW_MORE_THRESHOLD)
                ).map((l, i) => (
                  <div
                    key={l._uid}
                    className={i >= SHOW_MORE_THRESHOLD ? 'compact-extra' : undefined}
                  >
                  <CompactListItem
                    id={l._uid!}
                    title={
                      <>
                        {l.language || tProfile('sections.availability.language_placeholder')}
                        {l.is_primary && (
                          <span style={{ marginLeft: 8, fontSize: 11, color: domain.primaryColor, fontWeight: 700 }}>★</span>
                        )}
                      </>
                    }
                    subtitle={CEFR_LABELS[l.level]}
                    isExpanded={expandedIds.has(l._uid!)}
                    onToggleExpand={() => toggleExpand(l._uid!)}
                    confirmingDelete={confirmingDeleteId === l._uid}
                    onRequestDelete={() => requestDelete(l._uid!)}
                    onConfirmDelete={confirmDeleteAndRun(l._uid!, () => removeLanguage(i))}
                    onCancelDelete={cancelDelete}
                    accentColor={domain.primaryColor}
                  >
                    <div
                      className="profil-row"
                      style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr auto', gap: 10, alignItems: 'center' }}
                    >
                      <input
                        type="text"
                        value={l.language}
                        onChange={e => updateLanguage(i, { language: e.target.value })}
                        placeholder={tProfile('sections.availability.language_placeholder')}
                        style={inputStyle('languages_structured')}
                      />
                      <select
                        value={l.level}
                        onChange={e =>
                          updateLanguage(i, { level: e.target.value as CefrLevel })
                        }
                        style={inputStyle()}
                      >
                        {CEFR_LEVELS.map(lv => (
                          <option key={lv} value={lv}>
                            {CEFR_LABELS[lv]}
                          </option>
                        ))}
                      </select>
                      <label
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          color: l.is_primary ? domain.primaryColor : '#64748b',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          fontFamily: fontJakarta,
                        }}
                      >
                        <input
                          type="radio"
                          name="language_primary"
                          checked={l.is_primary}
                          onChange={() => setLanguagePrimary(i)}
                          style={{ accentColor: domain.primaryColor }}
                        />
                        {tProfile('sections.availability.primary_label')}
                      </label>
                    </div>
                  </CompactListItem>
                  </div>
                ))}

                <ShowMoreToggle
                  sectionKey="lang"
                  total={languagesStructured.length}
                  labelKey="show_more_languages"
                />

                <FieldError field="languages_structured" />
              </div>
            </div>

            {/* Section 5 — Liens */}
            <div style={sectionStyle}>
              <SectionHeader n="5" color={SECTION_COLORS.liens} title={tProfile('sections.links.title')} />
              <label style={labelStyle}>{tProfile('sections.links.linkedin_label')}</label>
              <input
                type="url"
                maxLength={500}
                value={linkedinUrl}
                onChange={e => setLinkedinUrl(e.target.value)}
                placeholder={tProfile('sections.links.linkedin_placeholder')}
                style={inputStyle()}
              />
            </div>

            {/* Section 6 — Coordonnées */}
            <div style={sectionStyle}>
              <SectionHeader
                n="6"
                color={SECTION_COLORS.coordonnees}
                title={tProfile('sections.contact.title')}
              />

              <div
                className="profil-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                  marginBottom: 14,
                }}
              >
                <div>
                  <label style={labelStyle}>{tProfile('sections.contact.phone_label')}</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder={tProfile('sections.contact.phone_placeholder')}
                    style={inputStyle()}
                  />
                </div>
                <div>
                  <label style={labelStyle}>{tProfile('sections.contact.birth_year_label')}</label>
                  <input
                    type="number"
                    min={1900}
                    max={new Date().getFullYear()}
                    value={birthYear}
                    onChange={e => setBirthYear(e.target.value)}
                    placeholder={tProfile('sections.contact.birth_year_placeholder')}
                    style={inputStyle()}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>{tProfile('sections.contact.address_label')}</label>
                <input
                  type="text"
                  value={addressLine}
                  onChange={e => setAddressLine(e.target.value)}
                  placeholder={tProfile('sections.contact.address_placeholder')}
                  style={inputStyle()}
                />
              </div>

              <div
                className="profil-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 2fr',
                  gap: 12,
                  marginBottom: 14,
                }}
              >
                <div>
                  <label style={labelStyle}>{tProfile('sections.contact.postal_code_label')}</label>
                  <input
                    type="text"
                    value={postalCode}
                    onChange={e => setPostalCode(e.target.value)}
                    placeholder={tProfile('sections.contact.postal_code_placeholder')}
                    style={inputStyle()}
                  />
                </div>
                <div>
                  <label style={labelStyle}>{tProfile('sections.contact.city_label')}</label>
                  <input
                    type="text"
                    value={city}
                    onChange={e => setCity(e.target.value)}
                    placeholder={tProfile('sections.contact.city_placeholder')}
                    style={inputStyle()}
                  />
                </div>
              </div>

              <div>
                <label style={labelStyle}>{tProfile('sections.contact.country_label')}</label>
                <CountrySelect
                  value={country}
                  onChange={setCountry}
                  primaryColor={domain.primaryColor}
                />
              </div>
            </div>

            {/* Section 7 — Parcours professionnel (carrière) */}
            <div
              ref={fieldRefs.experiences}
              className={focusClass('experiences')}
              style={sectionStyle}
            >
              <SectionHeader
                n="7"
                color={SECTION_COLORS.parcours}
                title={tProfile('sections.career.title')}
                action={
                  <button
                    type="button"
                    onClick={() => addExperience('career')}
                    style={inlineAddBtnStyle}
                  >
                    {tProfile('sections.career.add_button')}
                  </button>
                }
              />
              <FieldError field="experiences" />

              {careerEntries.length === 0 && (
                <div
                  style={{
                    fontSize: 13,
                    color: '#94a3b8',
                    padding: '4px 0 12px',
                    fontFamily: fontJakarta,
                  }}
                >
                  {tProfile('sections.career.empty')}
                </div>
              )}
              {(expandedSections.has('career')
                ? careerEntries
                : careerEntries.slice(0, SHOW_MORE_THRESHOLD)
              ).map((entry, localIdx) => (
                <div
                  key={entry._uid}
                  className={localIdx >= SHOW_MORE_THRESHOLD ? 'compact-extra' : undefined}
                >
                  <CompactListItem
                    id={entry._uid!}
                    title={
                      entry.role
                        ? entry.employer
                          ? `${entry.role} @ ${entry.employer}`
                          : entry.role
                        : tProfile('sections.career.role_placeholder')
                    }
                    subtitle={formatExperienceSubtitle(entry)}
                    isExpanded={expandedIds.has(entry._uid!)}
                    onToggleExpand={() => toggleExpand(entry._uid!)}
                    confirmingDelete={confirmingDeleteId === entry._uid}
                    onRequestDelete={() => requestDelete(entry._uid!)}
                    onConfirmDelete={confirmDeleteAndRun(entry._uid!, () => removeExperience(entry._idx))}
                    onCancelDelete={cancelDelete}
                    accentColor={SECTION_COLORS.parcours}
                  >
                    {renderExperienceFields(entry, entry._idx, 'career')}
                  </CompactListItem>
                </div>
              ))}

              <ShowMoreToggle
                sectionKey="career"
                total={careerEntries.length}
                labelKey="show_more_career"
              />
            </div>

            {/* Section 8 — Missions / Projets */}
            <div style={sectionStyle}>
              <SectionHeader
                n="8"
                color={SECTION_COLORS.missions}
                title={tProfile('sections.missions.title')}
                action={
                  <button
                    type="button"
                    onClick={() => addExperience('project')}
                    style={inlineAddBtnStyle}
                  >
                    {tProfile('sections.missions.add_button')}
                  </button>
                }
              />

              {projectEntries.length === 0 && (
                <div
                  style={{
                    fontSize: 13,
                    color: '#94a3b8',
                    padding: '4px 0 12px',
                    fontFamily: fontJakarta,
                  }}
                >
                  {tProfile('sections.missions.empty')}
                </div>
              )}
              {(expandedSections.has('project')
                ? projectEntries
                : projectEntries.slice(0, SHOW_MORE_THRESHOLD)
              ).map((entry, localIdx) => (
                <div
                  key={entry._uid}
                  className={localIdx >= SHOW_MORE_THRESHOLD ? 'compact-extra' : undefined}
                >
                  <CompactListItem
                    id={entry._uid!}
                    title={
                      entry.role
                        ? entry.client_name
                          ? `${entry.role} · ${entry.client_name}`
                          : entry.role
                        : tProfile('sections.missions.role_placeholder')
                    }
                    subtitle={formatExperienceSubtitle(entry)}
                    isExpanded={expandedIds.has(entry._uid!)}
                    onToggleExpand={() => toggleExpand(entry._uid!)}
                    confirmingDelete={confirmingDeleteId === entry._uid}
                    onRequestDelete={() => requestDelete(entry._uid!)}
                    onConfirmDelete={confirmDeleteAndRun(entry._uid!, () => removeExperience(entry._idx))}
                    onCancelDelete={cancelDelete}
                    accentColor={SECTION_COLORS.missions}
                  >
                    {renderExperienceFields(entry, entry._idx, 'project')}
                  </CompactListItem>
                </div>
              ))}

              <ShowMoreToggle
                sectionKey="project"
                total={projectEntries.length}
                labelKey="show_more_missions"
              />
            </div>

            {/* Section 9 — Formations */}
            <div style={sectionStyle}>
              <SectionHeader
                n="9"
                color={SECTION_COLORS.formation}
                title={tProfile('sections.education.title')}
                action={
                  <button type="button" onClick={addEducation} style={inlineAddBtnStyle}>
                    {tProfile('sections.education.add_button')}
                  </button>
                }
              />

              {educations.length === 0 && (
                <div
                  style={{
                    fontSize: 13,
                    color: '#94a3b8',
                    padding: '4px 0 14px',
                    fontFamily: fontJakarta,
                  }}
                >
                  {tProfile('sections.education.empty')}
                </div>
              )}

              {(expandedSections.has('edu')
                ? educations
                : educations.slice(0, SHOW_MORE_THRESHOLD)
              ).map((edu, i) => (
                <div
                  key={edu._uid}
                  className={i >= SHOW_MORE_THRESHOLD ? 'compact-extra' : undefined}
                >
                <CompactListItem
                  id={edu._uid!}
                  title={
                    edu.degree
                      ? edu.school
                        ? `${edu.degree} · ${edu.school}`
                        : edu.degree
                      : edu.school || tProfile('sections.education.school_placeholder')
                  }
                  subtitle={[edu.field, [edu.start_year, edu.end_year].filter(Boolean).join(' — ')].filter(Boolean).join(' · ')}
                  isExpanded={expandedIds.has(edu._uid!)}
                  onToggleExpand={() => toggleExpand(edu._uid!)}
                  confirmingDelete={confirmingDeleteId === edu._uid}
                  onRequestDelete={() => requestDelete(edu._uid!)}
                  onConfirmDelete={confirmDeleteAndRun(edu._uid!, () => removeEducation(i))}
                  onCancelDelete={cancelDelete}
                  accentColor={SECTION_COLORS.formation}
                >
                  <div
                    className="profil-row"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 12,
                      marginBottom: 12,
                    }}
                  >
                    <div>
                      <label style={labelStyle}>{tProfile('sections.education.school_label')}</label>
                      <input
                        type="text"
                        value={edu.school}
                        onChange={e => updateEducation(i, { school: e.target.value })}
                        placeholder={tProfile('sections.education.school_placeholder')}
                        style={inputStyle()}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>{tProfile('sections.education.degree_label')}</label>
                      <input
                        type="text"
                        value={edu.degree}
                        onChange={e => updateEducation(i, { degree: e.target.value })}
                        placeholder={tProfile('sections.education.degree_placeholder')}
                        style={inputStyle()}
                      />
                    </div>
                  </div>

                  <div
                    className="profil-row"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 12,
                      marginBottom: 12,
                    }}
                  >
                    <div>
                      <label style={labelStyle}>{tProfile('sections.education.field_label')}</label>
                      <input
                        type="text"
                        value={edu.field}
                        onChange={e => updateEducation(i, { field: e.target.value })}
                        placeholder={tProfile('sections.education.field_placeholder')}
                        style={inputStyle()}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>{tProfile('sections.education.location_label')}</label>
                      <input
                        type="text"
                        value={edu.location}
                        onChange={e => updateEducation(i, { location: e.target.value })}
                        placeholder={tProfile('sections.education.location_placeholder')}
                        style={inputStyle()}
                      />
                    </div>
                  </div>

                  <div
                    className="profil-row"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 12,
                    }}
                  >
                    <div>
                      <label style={labelStyle}>{tProfile('sections.education.start_year_label')}</label>
                      <input
                        type="number"
                        min={1900}
                        max={new Date().getFullYear() + 1}
                        value={edu.start_year}
                        onChange={e => updateEducation(i, { start_year: e.target.value })}
                        style={inputStyle()}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>{tProfile('sections.education.end_year_label')}</label>
                      <input
                        type="number"
                        min={1900}
                        max={new Date().getFullYear() + 10}
                        value={edu.end_year}
                        onChange={e => updateEducation(i, { end_year: e.target.value })}
                        style={inputStyle()}
                      />
                    </div>
                  </div>
                </CompactListItem>
                </div>
              ))}

              <ShowMoreToggle
                sectionKey="edu"
                total={educations.length}
                labelKey="show_more_education"
              />
            </div>

            {/* Actions */}
            {/* Actions sticky — Fix C parité CDI : Publier non silencieux.
                Le bouton est désactivé tant que validateForPublish() retourne
                des manquants, avec affichage clair de la liste sous le bouton.
                Le banner d'erreur global reste en fallback. */}
            {(() => {
              const publishMissing = validateForPublish()
              const canPublish = publishMissing.length === 0
              return (
                <div
                  className="profil-actions"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    background: 'var(--sk-surface)',
                    border: '1px solid var(--sk-border)',
                    borderRadius: 16,
                    padding: '16px 20px',
                  }}
                >
                  <div style={{ display: 'flex', gap: 12 }}>
                    <button
                      type="button"
                      onClick={() => save(false)}
                      disabled={saving}
                      style={{
                        flex: 1,
                        background: 'var(--sk-surface)',
                        color: domain.primaryColor,
                        border: `1.5px solid ${domain.primaryColor}`,
                        borderRadius: 12,
                        padding: 13,
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: saving ? 'not-allowed' : 'pointer',
                        opacity: saving ? 0.6 : 1,
                        fontFamily: fontJakarta,
                      }}
                    >
                      {saving ? tProfile('actions.saving') : tProfile('actions.save_draft')}
                    </button>
                    <button
                      type="button"
                      onClick={() => save(true)}
                      disabled={saving || !canPublish}
                      aria-disabled={saving || !canPublish}
                      title={!canPublish ? tProfile('actions.publish_disabled_tooltip') : undefined}
                      style={{
                        flex: 1,
                        background: canPublish ? domain.primaryColor : 'var(--sk-surface-2)',
                        color: canPublish ? '#fff' : 'var(--sk-faint)',
                        border: canPublish ? 'none' : '1px solid var(--sk-border)',
                        borderRadius: 12,
                        padding: 13,
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: (saving || !canPublish) ? 'not-allowed' : 'pointer',
                        opacity: saving ? 0.6 : 1,
                        fontFamily: fontJakarta,
                      }}
                    >
                      {saving ? tProfile('actions.publishing') : tProfile('actions.publish')}
                    </button>
                  </div>
                  {!canPublish && (
                    <div
                      role="status"
                      style={{
                        fontSize: 12.5,
                        color: 'var(--sk-muted)',
                        lineHeight: 1.5,
                        background: 'var(--sk-amber-soft)',
                        border: '1px solid var(--sk-amber)',
                        borderRadius: 10,
                        padding: '10px 12px',
                      }}
                    >
                      <div style={{ fontWeight: 600, color: 'var(--sk-text)', marginBottom: 4 }}>
                        {tProfile('actions.publish_blocked_title', { count: publishMissing.length })}
                      </div>
                      <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                        {publishMissing.map((m) => {
                          const fieldLabel = (() => {
                            try { return tProfile(`field_labels_short.${m}` as 'field_labels_short.title') }
                            catch { return m }
                          })()
                          return <li key={m}>{fieldLabel}</li>
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              )
            })()}
          </>
        )}
      </div>
    </div>
  )
}
