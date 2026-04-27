'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Plus_Jakarta_Sans } from 'next/font/google'
import { useDomain } from '@/context/DomainContext'
import { supabase } from '@/lib/supabase'
import CountrySelect from '@/components/CountrySelect'

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
  name: string
  issuer: string | null
  year: number | null
}

type Branch = { id: string; name: string; slug: string }
type Speciality = { id: string; name: string; slug: string; branch_id: string }

type ExperienceItem = {
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
  school: string
  degree: string
  field: string
  start_year: string
  end_year: string
  location: string
}

type LanguageItem = {
  language: string
  level: CefrLevel
  is_primary: boolean
}

const SENIORITY_LABELS: Record<Seniority, string> = {
  junior: 'Junior',
  confirmed: 'Confirmé',
  senior: 'Senior',
  expert: 'Expert',
}

const WORK_MODE_LABELS: Record<WorkMode, string> = {
  remote: 'Distanciel',
  onsite: 'Sur site',
  hybrid: 'Hybride',
}

const CEFR_LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native']

const CEFR_LABELS: Record<CefrLevel, string> = {
  A1: 'A1 — Débutant',
  A2: 'A2 — Élémentaire',
  B1: 'B1 — Intermédiaire',
  B2: 'B2 — Indépendant',
  C1: 'C1 — Autonome',
  C2: 'C2 — Maîtrise',
  native: 'Langue maternelle',
}

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

const FIELD_LABELS: Record<FieldKey, string> = {
  title: 'le titre professionnel',
  summary: 'le résumé (20 caractères minimum)',
  skills: 'au moins 3 compétences',
  branch_id: 'la branche principale',
  speciality_id: 'la spécialité',
  work_modes: 'au moins un mode de travail',
  experiences: 'au moins une expérience professionnelle',
  languages_structured: 'au moins une langue',
}

const FIELD_INLINE_ERRORS: Record<FieldKey, string> = {
  title: 'Renseignez votre titre professionnel',
  summary: 'Minimum 20 caractères pour publier',
  skills: 'Ajoutez au moins 3 compétences',
  branch_id: 'Sélectionnez une branche',
  speciality_id: 'Sélectionnez une spécialité',
  work_modes: 'Sélectionnez au moins un mode de travail',
  experiences: 'Ajoutez au moins une expérience (parcours ou mission)',
  languages_structured: 'Ajoutez au moins une langue',
}

function emptyExperience(type: ExperienceType): ExperienceItem {
  return {
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
    school: '',
    degree: '',
    field: '',
    start_year: '',
    end_year: '',
    location: '',
  }
}

function emptyLanguage(): LanguageItem {
  return { language: '', level: 'B2', is_primary: false }
}

function SectionHeader({
  n,
  color,
  title,
}: {
  n: string
  color: string
  title: React.ReactNode
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
  const tProfile = useTranslations('profile_validation')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
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

  useEffect(() => {
    if (!focusedField) return
    const t = setTimeout(() => setFocusedField(null), 1500)
    return () => clearTimeout(t)
  }, [focusedField])

  const showFieldError = (message: string, missing: string[]) => {
    setErrorMsg(message)
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
          setErrorMsg('Impossible de charger votre compte.')
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
          ? (profile.certifications as Certification[])
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

      const [{ data: brs }, { data: sps }, { data: exps }, { data: edus }, { data: langs }] =
        await Promise.all([
          supabase
            .from('branches')
            .select('id, name, slug')
            .eq('domain_id', domainId)
            .eq('active', true)
            .order('sort_order', { ascending: true }),
          supabase
            .from('specialities')
            .select('id, name, slug, branch_id')
            .eq('domain_id', domainId)
            .eq('active', true)
            .order('sort_order', { ascending: true }),
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
      if (cancelled) return

      setBranches((brs ?? []) as Branch[])
      setSpecialities((sps ?? []) as Speciality[])

      const raw: Array<ExperienceItem & { _so: number }> = (exps ?? []).map(
        (e: any) => ({
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

  const addCert = () =>
    setCertifications([...certifications, { name: '', issuer: null, year: null }])
  const updateCert = (i: number, patch: Partial<Certification>) =>
    setCertifications(
      certifications.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    )
  const removeCert = (i: number) =>
    setCertifications(certifications.filter((_, idx) => idx !== i))

  const addLanguage = () =>
    setLanguagesStructured([...languagesStructured, emptyLanguage()])
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

  const addExperience = (type: ExperienceType) =>
    setExperiences([...experiences, emptyExperience(type)])
  const updateExperience = (i: number, patch: Partial<ExperienceItem>) =>
    setExperiences(experiences.map((e, idx) => (idx === i ? { ...e, ...patch } : e)))
  const removeExperience = (i: number) =>
    setExperiences(experiences.filter((_, idx) => idx !== i))

  const toggleWorkMode = (m: WorkMode) =>
    setWorkModes(prev =>
      prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m],
    )

  const addEducation = () => setEducations([...educations, emptyEducation()])
  const updateEducation = (i: number, patch: Partial<EducationItem>) =>
    setEducations(educations.map((e, idx) => (idx === i ? { ...e, ...patch } : e)))
  const removeEducation = (i: number) =>
    setEducations(educations.filter((_, idx) => idx !== i))

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
    setMissingFields(null)

    if (visible) {
      const missing = validateForPublish()
      if (missing.length) {
        showFieldError(
          'Pour publier votre profil, complétez les champs surlignés ci-dessous.',
          missing,
        )
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
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'x-subdomain': domain.subdomain,
        },
        body: JSON.stringify(body),
      })
      const payload = await res.json().catch(() => ({} as any))

      if (!res.ok) {
        if (
          res.status === 400 &&
          payload?.code === 'incomplete' &&
          Array.isArray(payload?.missing)
        ) {
          showFieldError(
            'Profil incomplet, vérifiez les champs surlignés ci-dessous.',
            payload.missing,
          )
        } else {
          setErrorMsg(payload?.error || 'Erreur lors de la sauvegarde, réessayez.')
        }
        setSaving(false)
        return
      }

      router.push('/dashboard/freelance')
    } catch (err) {
      console.error('[profil valider] patch error', err)
      setErrorMsg('Erreur lors de la sauvegarde, réessayez.')
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

  const removeBtnStyle: React.CSSProperties = {
    background: '#fef2f2',
    color: '#dc2626',
    border: '1.5px solid #fecaca',
    borderRadius: 10,
    padding: '10px 12px',
    fontSize: 14,
    cursor: 'pointer',
    height: 42,
    flexShrink: 0,
    fontFamily: fontJakarta,
  }

  const addBtnStyle: React.CSSProperties = {
    background: 'transparent',
    color: domain.primaryColor,
    border: `1.5px dashed ${domain.primaryColor}66`,
    borderRadius: 10,
    padding: '10px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 4,
    fontFamily: fontJakarta,
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

  const renderExperienceCard = (
    exp: ExperienceItem,
    idx: number,
    type: ExperienceType,
  ) => {
    const isCareer = type === 'career'
    return (
      <div
        key={`${type}-${idx}`}
        style={{
          background: '#fff',
          border: `1.5px solid ${
            isMissing('experiences') && idx === 0 ? '#dc2626' : '#e2e8f0'
          }`,
          borderRadius: 12,
          padding: 16,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            marginBottom: 12,
          }}
        >
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{isCareer ? 'Poste' : 'Rôle'}</label>
            <input
              type="text"
              value={exp.role}
              onChange={e => updateExperience(idx, { role: e.target.value })}
              placeholder={
                isCareer
                  ? 'Lead Supply Chain D365 SCM'
                  : 'Solution Architect'
              }
              style={inputStyle()}
            />
          </div>
          <div style={{ marginTop: 22 }}>
            <button
              type="button"
              onClick={() => removeExperience(idx)}
              aria-label={
                isCareer ? 'Retirer cet emploi' : 'Retirer cette mission'
              }
              style={removeBtnStyle}
            >
              ×
            </button>
          </div>
        </div>

        {isCareer ? (
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Employeur</label>
            <input
              type="text"
              value={exp.employer}
              onChange={e => updateExperience(idx, { employer: e.target.value })}
              placeholder="Prodware, SilverProd..."
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
              <label style={labelStyle}>Client</label>
              <input
                type="text"
                value={exp.client_name}
                onChange={e =>
                  updateExperience(idx, { client_name: e.target.value })
                }
                placeholder="Confidentiel"
                style={inputStyle()}
              />
            </div>
            <div>
              <label style={labelStyle}>Secteur</label>
              <input
                type="text"
                value={exp.sector}
                onChange={e => updateExperience(idx, { sector: e.target.value })}
                placeholder="Agri-food, Automotive..."
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
            <label style={labelStyle}>Date de début</label>
            <input
              type="date"
              value={exp.start_date}
              onChange={e => updateExperience(idx, { start_date: e.target.value })}
              style={inputStyle()}
            />
          </div>
          <div>
            <label style={labelStyle}>Date de fin</label>
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
          {isCareer ? 'Poste actuel' : 'Mission en cours'}
        </label>

        <div>
          <label style={labelStyle}>Description</label>
          <textarea
            rows={isCareer ? 4 : 6}
            value={exp.description}
            onChange={e => updateExperience(idx, { description: e.target.value })}
            placeholder={
              isCareer
                ? "Vue d'ensemble du poste, responsabilités, contexte..."
                : 'Périmètre, tâches, livrables, technologies, contexte du projet...'
            }
            style={{
              ...inputStyle(),
              resize: 'vertical',
              minHeight: isCareer ? 96 : 140,
            }}
          />
        </div>
      </div>
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
            En attente de vérification
          </span>
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
            Chargement de votre profil...
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
              ← Retour
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
                  {Array.isArray(missingFields) && missingFields.length > 0 ? (
                    <>
                      Pour publier votre profil, complétez {missingFields.length} champ
                      {missingFields.length > 1 ? 's' : ''} surligné
                      {missingFields.length > 1 ? 's' : ''} ci-dessous :{' '}
                      {missingFields
                        .filter((f): f is FieldKey => f in FIELD_LABELS)
                        .map(f => FIELD_LABELS[f])
                        .join(', ')}
                      .
                    </>
                  ) : (
                    errorMsg
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null)
                    setMissingFields(null)
                  }}
                  aria-label="Fermer"
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

            {parsingFailed && !errorMsg && (
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
                ⚠️ Le parsing IA a échoué, complétez votre profil manuellement.
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
              Validez votre profil
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
              Vérifiez les informations extraites de votre document. Vous pouvez tout corriger
              avant de publier.
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
              💡 Notre IA a pré-rempli ces champs. Modifiez si nécessaire avant de publier.
            </div>

            {/* Section 1 — Identité pro */}
            <div style={sectionStyle}>
              <SectionHeader n="1" color={domain.primaryColor} title="Identité professionnelle" />

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Titre professionnel</label>
                <input
                  ref={fieldRefs.title}
                  className={focusClass('title')}
                  type="text"
                  maxLength={200}
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Ex: Consultant Dynamics 365 F&O Senior"
                  style={inputStyle('title')}
                />
                <FieldError field="title" />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Résumé</label>
                <textarea
                  ref={fieldRefs.summary}
                  className={focusClass('summary')}
                  rows={4}
                  maxLength={500}
                  value={summary}
                  onChange={e => setSummary(e.target.value)}
                  placeholder="10 ans d'expérience sur..."
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
                  {summary.trim().length}/500 · minimum 20 caractères pour publier
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
                  <label style={labelStyle}>Séniorité</label>
                  <select
                    value={seniority}
                    onChange={e => setSeniority(e.target.value as Seniority | '')}
                    style={inputStyle()}
                  >
                    <option value="">— Sélectionner —</option>
                    {(Object.keys(SENIORITY_LABELS) as Seniority[]).map(s => (
                      <option key={s} value={s}>
                        {SENIORITY_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Années d'expérience</label>
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
              <SectionHeader n="2" color={SECTION_COLORS.expertise} title="Expertise" />

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Branche principale</label>
                <select
                  ref={fieldRefs.branch_id}
                  className={focusClass('branch_id')}
                  value={branchId}
                  onChange={e => onBranchChange(e.target.value)}
                  style={inputStyle('branch_id')}
                >
                  <option value="">— Sélectionner une branche —</option>
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <FieldError field="branch_id" />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Spécialité</label>
                <select
                  ref={fieldRefs.speciality_id}
                  className={focusClass('speciality_id')}
                  value={specialityId}
                  onChange={e => setSpecialityId(e.target.value)}
                  disabled={!branchId}
                  style={{ ...inputStyle('speciality_id'), opacity: branchId ? 1 : 0.55 }}
                >
                  <option value="">— Sélectionner une spécialité —</option>
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
                  Compétences{' '}
                  <span style={{ color: '#94a3b8', fontWeight: 400 }}>
                    · {skills.length} {skills.length < 3 ? '(min. 3 pour publier)' : ''}
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
                    placeholder="Ex: Azure, Power BI, D365..."
                    style={{ ...inputStyle('skills'), flex: 1 }}
                  />
                  <button type="button" onClick={addSkill} style={primaryAddBtnStyle}>
                    Ajouter
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {skills.map(s => (
                    <span key={s} style={tagStyle}>
                      {s}
                      <button
                        type="button"
                        onClick={() => removeSkill(s)}
                        aria-label={`Retirer ${s}`}
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
                title="Certifications"
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
                  Aucune certification pour l'instant.
                </div>
              )}

              {certifications.map((c, i) => (
                <div
                  key={i}
                  className="profil-row"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1.3fr 0.7fr auto',
                    gap: 10,
                    alignItems: 'flex-end',
                    marginBottom: 10,
                  }}
                >
                  <div>
                    <label style={labelStyle}>Nom</label>
                    <input
                      type="text"
                      value={c.name}
                      onChange={e => updateCert(i, { name: e.target.value })}
                      placeholder="PL-300, MB-700..."
                      style={inputStyle()}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Émetteur</label>
                    <input
                      type="text"
                      value={c.issuer ?? ''}
                      onChange={e => updateCert(i, { issuer: e.target.value || null })}
                      placeholder="Microsoft"
                      style={inputStyle()}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Année</label>
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
                  <button
                    type="button"
                    onClick={() => removeCert(i)}
                    aria-label="Supprimer"
                    style={removeBtnStyle}
                  >
                    ×
                  </button>
                </div>
              ))}

              <button type="button" onClick={addCert} style={addBtnStyle}>
                + Ajouter une certification
              </button>
            </div>

            {/* Section 4 — Disponibilité */}
            <div style={sectionStyle}>
              <SectionHeader
                n="4"
                color={SECTION_COLORS.disponibilite}
                title="Disponibilité"
              />

              <div
                ref={fieldRefs.work_modes}
                className={focusClass('work_modes')}
                style={{ marginBottom: 14 }}
              >
                <label style={labelStyle}>
                  Modes de travail{' '}
                  <span style={{ color: '#94a3b8', fontWeight: 400 }}>
                    · plusieurs possibles
                  </span>
                </label>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {(Object.keys(WORK_MODE_LABELS) as WorkMode[]).map(m => {
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
                <label style={labelStyle}>Localisation</label>
                <input
                  type="text"
                  maxLength={100}
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  placeholder="Paris, Lyon, Remote..."
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
                  <label style={labelStyle}>TJM min (€ / jour)</label>
                  <input
                    type="number"
                    min={0}
                    value={tjmMin}
                    onChange={e => setTjmMin(e.target.value)}
                    style={inputStyle()}
                  />
                </div>
                <div>
                  <label style={labelStyle}>TJM max (€ / jour)</label>
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
                <label style={labelStyle}>Date de disponibilité</label>
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
                <label style={labelStyle}>
                  Langues{' '}
                  <span style={{ color: '#94a3b8', fontWeight: 400 }}>
                    · {languagesStructured.filter(l => l.language.trim()).length}
                    {languagesStructured.filter(l => l.language.trim()).length < 1
                      ? ' (min. 1 pour publier)'
                      : ''}
                  </span>
                </label>

                {languagesStructured.length === 0 && (
                  <div
                    style={{
                      fontSize: 13,
                      color: '#94a3b8',
                      padding: '4px 0 10px',
                      fontFamily: fontJakarta,
                    }}
                  >
                    Aucune langue renseignée.
                  </div>
                )}

                {languagesStructured.map((l, i) => (
                  <div
                    key={i}
                    className="profil-row"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '2fr 1.5fr auto auto',
                      gap: 10,
                      alignItems: 'center',
                      marginBottom: 8,
                    }}
                  >
                    <input
                      type="text"
                      value={l.language}
                      onChange={e => updateLanguage(i, { language: e.target.value })}
                      placeholder="Français, Anglais..."
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
                      Principale
                    </label>
                    <button
                      type="button"
                      onClick={() => removeLanguage(i)}
                      aria-label="Supprimer la langue"
                      style={removeBtnStyle}
                    >
                      ×
                    </button>
                  </div>
                ))}

                <button type="button" onClick={addLanguage} style={addBtnStyle}>
                  + Ajouter une langue
                </button>
                <FieldError field="languages_structured" />
              </div>
            </div>

            {/* Section 5 — Liens */}
            <div style={sectionStyle}>
              <SectionHeader n="5" color={SECTION_COLORS.liens} title="Liens" />
              <label style={labelStyle}>URL LinkedIn</label>
              <input
                type="url"
                maxLength={500}
                value={linkedinUrl}
                onChange={e => setLinkedinUrl(e.target.value)}
                placeholder="https://linkedin.com/in/..."
                style={inputStyle()}
              />
            </div>

            {/* Section 6 — Coordonnées */}
            <div style={sectionStyle}>
              <SectionHeader
                n="6"
                color={SECTION_COLORS.coordonnees}
                title="Coordonnées"
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
                  <label style={labelStyle}>Téléphone</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="+33 6 12 34 56 78"
                    style={inputStyle()}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Année de naissance</label>
                  <input
                    type="number"
                    min={1900}
                    max={new Date().getFullYear()}
                    value={birthYear}
                    onChange={e => setBirthYear(e.target.value)}
                    placeholder="1990"
                    style={inputStyle()}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Adresse</label>
                <input
                  type="text"
                  value={addressLine}
                  onChange={e => setAddressLine(e.target.value)}
                  placeholder="12 rue de la Paix"
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
                  <label style={labelStyle}>Code postal</label>
                  <input
                    type="text"
                    value={postalCode}
                    onChange={e => setPostalCode(e.target.value)}
                    placeholder="75001"
                    style={inputStyle()}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Ville</label>
                  <input
                    type="text"
                    value={city}
                    onChange={e => setCity(e.target.value)}
                    placeholder="Paris"
                    style={inputStyle()}
                  />
                </div>
              </div>

              <div>
                <label style={labelStyle}>{tProfile('country_label')}</label>
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
                title="Parcours professionnel"
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
                  Aucun employeur renseigné.
                </div>
              )}
              {careerEntries.map(entry =>
                renderExperienceCard(entry, entry._idx, 'career'),
              )}
              <button
                type="button"
                onClick={() => addExperience('career')}
                style={addBtnStyle}
              >
                + Ajouter un employeur
              </button>
            </div>

            {/* Section 8 — Missions / Projets */}
            <div style={sectionStyle}>
              <SectionHeader
                n="8"
                color={SECTION_COLORS.missions}
                title="Missions / Projets"
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
                  Aucune mission renseignée.
                </div>
              )}
              {projectEntries.map(entry =>
                renderExperienceCard(entry, entry._idx, 'project'),
              )}
              <button
                type="button"
                onClick={() => addExperience('project')}
                style={addBtnStyle}
              >
                + Ajouter une mission
              </button>
            </div>

            {/* Section 9 — Formations */}
            <div style={sectionStyle}>
              <SectionHeader n="9" color={SECTION_COLORS.formation} title="Formation" />

              {educations.length === 0 && (
                <div
                  style={{
                    fontSize: 13,
                    color: '#94a3b8',
                    padding: '4px 0 14px',
                    fontFamily: fontJakarta,
                  }}
                >
                  Aucune formation renseignée.
                </div>
              )}

              {educations.map((edu, i) => (
                <div
                  key={i}
                  style={{
                    background: '#fff',
                    border: '1.5px solid #e2e8f0',
                    borderRadius: 12,
                    padding: 16,
                    marginBottom: 12,
                  }}
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
                      <label style={labelStyle}>École</label>
                      <input
                        type="text"
                        value={edu.school}
                        onChange={e => updateEducation(i, { school: e.target.value })}
                        placeholder="Université Paris-Dauphine"
                        style={inputStyle()}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Diplôme</label>
                      <input
                        type="text"
                        value={edu.degree}
                        onChange={e => updateEducation(i, { degree: e.target.value })}
                        placeholder="Master, BAC+5, MBA..."
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
                      <label style={labelStyle}>Domaine / Spécialisation</label>
                      <input
                        type="text"
                        value={edu.field}
                        onChange={e => updateEducation(i, { field: e.target.value })}
                        placeholder="Finance, Informatique..."
                        style={inputStyle()}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Lieu</label>
                      <input
                        type="text"
                        value={edu.location}
                        onChange={e => updateEducation(i, { location: e.target.value })}
                        placeholder="Paris, Lyon..."
                        style={inputStyle()}
                      />
                    </div>
                  </div>

                  <div
                    className="profil-row"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr auto',
                      gap: 12,
                      alignItems: 'flex-end',
                    }}
                  >
                    <div>
                      <label style={labelStyle}>Année début</label>
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
                      <label style={labelStyle}>Année fin</label>
                      <input
                        type="number"
                        min={1900}
                        max={new Date().getFullYear() + 10}
                        value={edu.end_year}
                        onChange={e => updateEducation(i, { end_year: e.target.value })}
                        style={inputStyle()}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeEducation(i)}
                      aria-label="Retirer cette formation"
                      style={removeBtnStyle}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}

              <button type="button" onClick={addEducation} style={addBtnStyle}>
                + Ajouter une formation
              </button>
            </div>

            {/* Actions */}
            <div
              className="profil-actions"
              style={{
                display: 'flex',
                gap: 12,
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: 16,
                padding: '16px 20px',
              }}
            >
              <button
                type="button"
                onClick={() => save(false)}
                disabled={saving}
                style={{
                  flex: 1,
                  background: '#fff',
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
                Enregistrer comme brouillon
              </button>
              <button
                type="button"
                onClick={() => save(true)}
                disabled={saving}
                style={{
                  flex: 1,
                  background: domain.primaryColor,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 12,
                  padding: 13,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.6 : 1,
                  fontFamily: fontJakarta,
                }}
              >
                {saving ? 'Envoi...' : 'Publier mon profil →'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
