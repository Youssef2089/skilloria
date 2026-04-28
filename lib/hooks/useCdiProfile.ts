'use client'

import { useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import { supabase } from '@/lib/supabase'

export type CdiStatus = 'employed' | 'open_to_work' | 'actively_searching'
export type NoticePeriod = 'immediate' | '1_month' | '2_months' | '3_months' | 'negotiable'
export type GeoMobility = 'local' | 'regional' | 'national' | 'international'
export type ContractType = 'cdi' | 'cdd' | 'alternance'
export type WorkMode = 'remote' | 'onsite' | 'hybrid'
export type Seniority = 'junior' | 'confirmed' | 'senior' | 'expert'
export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'native'

export type Certification = {
  name: string
  issuer: string | null
  year: number | null
}

export type CdiUser = {
  id: string
  email: string | null
  is_verified: boolean
  user_type: string | null
  domain_id: string | null
  first_name?: string | null
  last_name?: string | null
}

export type CdiProfile = {
  id: string
  user_id: string
  title: string | null
  summary: string | null
  seniority: Seniority | null
  years_experience: number | null
  skills: string[] | null
  certifications: Certification[] | null
  branch_id: string | null
  speciality_id: string | null
  languages: string[] | null
  location: string | null
  work_modes: WorkMode[] | null
  linkedin_url: string | null
  visible: boolean | null
  phone: string | null
  city: string | null
  country: string | null
  birth_year: number | null
  photo_url: string | null
  cdi_status: CdiStatus | null
  cdi_notice_period: NoticePeriod | null
  cdi_availability_date: string | null
  cdi_confidential_mode: boolean | null
  cdi_salary_min: number | null
  cdi_salary_max: number | null
  cdi_variable_pct: number | null
  cdi_benefits: string[] | null
  cdi_company_size: string[] | null
  cdi_sectors: string[] | null
  cdi_geo_mobility: GeoMobility | null
  cdi_contract_types: ContractType[] | null
  cdi_motivations: string | null
  cdi_career_goals: string | null
}

export type ExperienceItem = {
  experience_type: 'career' | 'project'
  role: string
  employer: string
  client_name: string
  sector: string
  start_date: string
  end_date: string
  is_current: boolean
  description: string
  sort_order: number | null
}

export type EducationItem = {
  school: string
  degree: string
  field: string
  start_year: number | null
  end_year: number | null
  location: string
}

export type LanguageItem = {
  language: string
  level: CefrLevel
  is_primary: boolean
}

export type Branch = { id: string; name: string; slug: string }
export type Speciality = { id: string; name: string; slug: string; branch_id: string }

export type UseCdiProfileState = {
  loading: boolean
  authenticated: boolean
  forbidden: boolean
  error: string | null
  user: CdiUser | null
  profile: CdiProfile | null
  experiences: ExperienceItem[]
  educations: EducationItem[]
  languages: LanguageItem[]
  branches: Branch[]
  specialities: Speciality[]
}

const PROFILE_COLUMNS = [
  'id',
  'user_id',
  'title',
  'summary',
  'seniority',
  'years_experience',
  'skills',
  'certifications',
  'branch_id',
  'speciality_id',
  'languages',
  'location',
  'work_modes',
  'linkedin_url',
  'visible',
  'phone',
  'city',
  'country',
  'birth_year',
  'photo_url',
  'cdi_status',
  'cdi_notice_period',
  'cdi_availability_date',
  'cdi_confidential_mode',
  'cdi_salary_min',
  'cdi_salary_max',
  'cdi_variable_pct',
  'cdi_benefits',
  'cdi_company_size',
  'cdi_sectors',
  'cdi_geo_mobility',
  'cdi_contract_types',
  'cdi_motivations',
  'cdi_career_goals',
].join(', ')

const initialState: UseCdiProfileState = {
  loading: true,
  authenticated: false,
  forbidden: false,
  error: null,
  user: null,
  profile: null,
  experiences: [],
  educations: [],
  languages: [],
  branches: [],
  specialities: [],
}

export function useCdiProfile(): UseCdiProfileState {
  const locale = useLocale()
  const [state, setState] = useState<UseCdiProfileState>(initialState)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (cancelled) return
        if (!session) {
          setState({ ...initialState, loading: false, authenticated: false })
          return
        }

        // select('*') — `first_name`/`last_name` peuvent ne pas exister dans la table.
        // On déballe ensuite via cast sécurisé.
        const { data: userRow, error: userErr } = await supabase
          .from('users')
          .select('*')
          .eq('id', session.user.id)
          .single()

        if (cancelled) return
        if (userErr || !userRow) {
          setState({
            ...initialState,
            loading: false,
            authenticated: true,
            error: userErr?.message ?? 'user_not_found',
          })
          return
        }

        const userRaw = userRow as Record<string, any>
        const userTyped: CdiUser = {
          id: String(userRaw.id ?? ''),
          email: (userRaw.email ?? null) as string | null,
          is_verified: !!userRaw.is_verified,
          user_type: (userRaw.user_type ?? null) as string | null,
          domain_id: (userRaw.domain_id ?? null) as string | null,
          first_name: (userRaw.first_name ?? null) as string | null,
          last_name: (userRaw.last_name ?? null) as string | null,
        }
        if (userTyped.user_type !== 'expert_cdi') {
          setState({
            ...initialState,
            loading: false,
            authenticated: true,
            forbidden: true,
            user: userTyped,
          })
          return
        }

        const domainId = userTyped.domain_id

        const { data: profileRow, error: profErr } = await supabase
          .from('profiles')
          .select(PROFILE_COLUMNS)
          .eq('user_id', session.user.id)
          .maybeSingle()

        if (cancelled) return
        if (profErr) {
          setState({
            ...initialState,
            loading: false,
            authenticated: true,
            user: userTyped,
            error: profErr.message,
          })
          return
        }

        if (!profileRow) {
          setState({
            ...initialState,
            loading: false,
            authenticated: true,
            user: userTyped,
            profile: null,
          })
          return
        }

        const profile = profileRow as unknown as CdiProfile

        const taxonomyPromise = domainId
          ? fetch(
              `/api/taxonomy?locale=${encodeURIComponent(locale)}&domain_id=${encodeURIComponent(domainId)}`,
              { cache: 'no-store' },
            )
              .then(r => (r.ok ? r.json() : { branches: [], specialities: [] }))
              .catch(() => ({ branches: [], specialities: [] }))
          : Promise.resolve({ branches: [], specialities: [] })

        const [taxonomy, expsRes, edusRes, langsRes] = await Promise.all([
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

        if (cancelled) return

        const experiences: ExperienceItem[] = (expsRes.data ?? []).map((e: any) => ({
          experience_type: (e.experience_type ?? 'career') as 'career' | 'project',
          role: e.role ?? '',
          employer: e.employer ?? '',
          client_name: e.client_name ?? '',
          sector: e.sector ?? '',
          start_date: e.start_date ?? '',
          end_date: e.end_date ?? '',
          is_current: !!e.is_current,
          description: e.description ?? '',
          sort_order: typeof e.sort_order === 'number' ? e.sort_order : null,
        }))

        const educations: EducationItem[] = (edusRes.data ?? []).map((e: any) => ({
          school: e.school ?? '',
          degree: e.degree ?? '',
          field: e.field ?? '',
          start_year: e.start_year != null ? Number(e.start_year) : null,
          end_year: e.end_year != null ? Number(e.end_year) : null,
          location: e.location ?? '',
        }))

        const languages: LanguageItem[] = (langsRes.data ?? []).map((l: any) => ({
          language: l.language ?? '',
          level: (l.level ?? 'B2') as CefrLevel,
          is_primary: !!l.is_primary,
        }))

        setState({
          loading: false,
          authenticated: true,
          forbidden: false,
          error: null,
          user: userTyped,
          profile,
          experiences,
          educations,
          languages,
          branches: (taxonomy.branches ?? []) as Branch[],
          specialities: (taxonomy.specialities ?? []) as Speciality[],
        })
      } catch (err: any) {
        if (cancelled) return
        setState(prev => ({
          ...prev,
          loading: false,
          error: err?.message ?? 'unknown_error',
        }))
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [locale])

  return state
}
