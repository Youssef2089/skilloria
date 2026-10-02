'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Plus_Jakarta_Sans } from 'next/font/google'
import { supabase } from '@/lib/supabase'
import { useSecureFetch } from '@/lib/secure-fetch'
import { sessionDuCompteAffiche } from '@/lib/identite/compte-affiche'
import { messageRefusProfil } from '@/lib/profil/refus-profil'
// Les bornes de la BASE, posées sur les champs (m6) — un miroir contrôlé par diag-parcours-expert.
import { LONGUEURS_SAISIE, ANNEE_NAISSANCE_MIN, anneeNaissanceMax, ANNEE_FORMATION_MIN, anneeDebutFormationMax, anneeFinFormationMax } from '@/lib/profil/bornes-saisie'
import EcartsAnalyse from '@/components/profile/EcartsAnalyse'
import CountrySelect from '@/components/CountrySelect'
import CompactListItem from '@/components/CompactListItem'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
})

const fontJakarta = 'var(--font-jakarta), system-ui, sans-serif'
const fontInter = 'Inter, system-ui, sans-serif'

// Les valeurs des critères communs viennent de lib/criteres/communs.ts — la liste de l'annonce et de la base (§D.39).
type Seniority = Seniorite
type WorkMode = ModeTravail
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
  /** Un CODE de la liste fermée (`fr`, `en`) — ou une saisie HÉRITÉE en texte libre, à choisir. */
  language: string
  /** Vide tant que l'expert n'a pas choisi : aucun niveau d'office (recette du 01/10/2026, point 3). */
  level: CefrLevel | ''
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

import MultiSelectChips from '@/components/ui/MultiSelectChips'
import { ChoixModesTravail, ChoixTempsTravail } from '@/components/criteres/ChoixCriteres'
import { SENIORITES, TEMPS_TRAVAIL, valeursConnues, type ModeTravail, type Seniorite, type TempsTravail } from '@/lib/criteres/communs'
import { optionsSpecialites } from '@/lib/criteres/specialites'
import WorkZoneSelector from '@/components/ui/WorkZoneSelector'
import type { WorkZone } from '@/lib/work-zones'
import {
  listeLue,
  lignesOuVide,
  LISTES_DE_PROFIL,
  type ListeDeProfil,
} from '@/lib/lecture/liste'
import {
  missingForVisibility,
  RESUME_MAX,
  RESUME_MIN,
} from '@/lib/profile-visibility'
import SectionHeader from '@/components/dashboard/SectionHeader'
import { SPECIALITY_OTHER } from '@/lib/taxonomie/specialite-autre'
import { languesAEnvoyer, listeDesLangues, nomDeLangue, type LangueProposee } from '@/lib/profil/langues'
import { ChoixLangue, ChoixNiveauLangue } from '@/components/profile/ChoixLangue'


const FIELD_ORDER = [
  'title',
  'summary',
  'skills',
  'branch_id',
  'speciality_ids',
  'seniorities',
  'work_zone_ids',
  'availability',
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
  return { _uid: uid(), language: '', level: '', is_primary: false }
}

function emptyCertification(): Certification {
  return { _uid: uid(), name: '', issuer: null, year: null }
}



export default function ValiderProfilPage() {
  const router = useRouter()
  const secureFetch = useSecureFetch()
  const tProfile = useTranslations('profile_validation')
  const tLangues = useTranslations('langues')
  const tRefus = useTranslations('profil_refus')
  const tWorkZones = useTranslations('work_zones')
  const tCrit = useTranslations('criteres')
  const locale = useLocale()

  const SENIORITY_LABELS: Record<Seniority, string> = {
    junior: tProfile('sections.identity.seniority_options.junior'),
    confirmed: tProfile('sections.identity.seniority_options.confirmed'),
    senior: tProfile('sections.identity.seniority_options.senior'),
    expert: tProfile('sections.identity.seniority_options.expert'),
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
    // Les bornes viennent du prédicat : un libellé qui les écrit en dur
    // finit par annoncer « 20 caractères » alors que le serveur en exige 200.
    summary: tProfile('field_labels_short.summary', { min: RESUME_MIN, max: RESUME_MAX }),
    skills: tProfile('field_labels_short.skills'),
    branch_id: tProfile('field_labels_short.branch_id'),
    speciality_ids: tProfile('field_labels_short.speciality_ids'),
    seniorities: tProfile('field_labels_short.seniorities'),
    work_zone_ids: tProfile('field_labels_short.work_zone_ids'),
    availability: tProfile('field_labels_short.availability'),
    work_modes: tProfile('field_labels_short.work_modes'),
    experiences: tProfile('field_labels_short.experiences'),
    languages_structured: tProfile('field_labels_short.languages_structured'),
  }
  const FIELD_INLINE_ERRORS: Record<FieldKey, string> = {
    title: tProfile('field_errors.title'),
    summary: tProfile('field_errors.summary', { min: RESUME_MIN, max: RESUME_MAX }),
    skills: tProfile('field_errors.skills'),
    branch_id: tProfile('field_errors.branch_id'),
    speciality_ids: tProfile('field_errors.speciality_ids'),
    seniorities: tProfile('field_errors.seniorities'),
    work_zone_ids: tProfile('field_errors.work_zone_ids'),
    availability: tProfile('field_errors.availability'),
    work_modes: tProfile('field_errors.work_modes'),
    experiences: tProfile('field_errors.experiences'),
    languages_structured: tProfile('field_errors.languages_structured'),
  }

  // Ce que la BANNIÈRE peut nommer. Ce n'est pas FIELD_LABELS : `cv_ready`
  // n'est pas un champ de ce formulaire — il n'a ni ref ni surlignage — mais il
  // PEUT manquer, et il manquait au décompte sans jamais apparaître dans la
  // liste. La bannière annonçait alors « 3 champs » et n'en nommait que deux :
  // le compte disait une chose, la liste une autre, et l'expert n'avait aucun
  // moyen de savoir lequel des deux avait raison.
  const MISSING_LABELS: Record<string, string> = {
    ...FIELD_LABELS,
    cv_ready: tProfile('field_labels_short.cv_ready'),
  }

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [missingFields, setMissingFields] = useState<string[] | null>(null)
  const [parsingFailed, setParsingFailed] = useState(false)
  // Le profil est-il EN LIGNE ? « Enregistrer comme brouillon » le retire de la vitrine, et l'écran le DIT avant.
  const [etaitVisible, setEtaitVisible] = useState(false)
  // Le référentiel (branches, spécialités, zones) n'a pas pu être lu : on n'envoie PAS des listes vides à sa place.
  const [taxonomieIndisponible, setTaxonomieIndisponible] = useState(false)
  const [profileId, setProfileId] = useState<string | null>(null)
  // Lot CV obligatoire : "CV prêt" = parsé (done) ET consentement IA donné.
  const [cvParsingStatus, setCvParsingStatus] = useState<string | null>(null)
  const [aiConsentAt, setAiConsentAt] = useState<string | null>(null)
  // Lot reset CV : annuler/retélécharger (remise à zéro complète serveur).
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)


  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [specialities, setSpecialities] = useState<Speciality[]>([])

  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  // SÉNIORITÉS multiples : un expert peut accepter « confirmé » ET « senior ».
  const [seniorities, setSeniorities] = useState<Seniority[]>([])
  const [yearsExperience, setYearsExperience] = useState('')
  const [branchId, setBranchId] = useState('')
  const [specialityIds, setSpecialityIds] = useState<string[]>([])
  // ZONES DE TRAVAIL — où l'expert ACCEPTE de travailler, jamais où il habite.
  const [workZones, setWorkZones] = useState<WorkZone[]>([])
  const [workZoneIds, setWorkZoneIds] = useState<string[]>([])
  // D6 : option « Autre » → speciality_id vide + précision libre.
  const [specialityOther, setSpecialityOther] = useState('')
  const [skills, setSkills] = useState<string[]>([])
  const [skillDraft, setSkillDraft] = useState('')
  const [certifications, setCertifications] = useState<Certification[]>([])
  const [workModes, setWorkModes] = useState<WorkMode[]>([])
  // TEMPS PLEIN OU TEMPS PARTIEL (§D.39) — un champ à part, le vocabulaire de l'annonce ; ne filtre pas la mise en relation.
  const [tempsTravail, setTempsTravail] = useState<TempsTravail[]>([])
  const [location, setLocation] = useState('')
  const [tjmMin, setTjmMin] = useState('')
  const [tjmMax, setTjmMax] = useState('')
  const [availabilityDate, setAvailabilityDate] = useState('')
  // DISPONIBILITÉ — lue, jamais saisie dans cet écran : elle est pilotée par la
  // bascule « Ne pas déranger » (lib/availability-actions.ts). La contrainte de
  // base l'exige pourtant pour rendre un profil visible.
  //
  // On ne peut pas bloquer sur un champ que le formulaire ne propose pas : ce
  // serait une impasse. PUBLIER SIGNIFIE ÊTRE DISPONIBLE — c'est le sens même
  // du geste — donc une disponibilité absente est renseignée à 'available' au
  // moment de publier. Un 'do_not_disturb' déjà posé, lui, n'est jamais écrasé.
  const [availabilityStatus, setAvailabilityStatus] = useState<string | null>(null)
  const [linkedinUrl, setLinkedinUrl] = useState('')

  const [languagesStructured, setLanguagesStructured] = useState<LanguageItem[]>([])
  // La liste FERMÉE des langues, servie par /api/taxonomy (table `langues`), nommée dans la langue de l'écran.
  const [langues, setLangues] = useState<LangueProposee[]>([])

  const [phone, setPhone] = useState('')
  const [birthYear, setBirthYear] = useState('')
  const [addressLine, setAddressLine] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [city, setCity] = useState('')
  // ── AUCUN PAYS PRÉSÉLECTIONNÉ ─────────────────────────────────────────────
  //  Ce champ valait « FR » à l'ouverture, et la lecture du profil retombait
  //  sur « FR » quand la colonne était vide. Un expert marocain qui ne
  //  touchait pas au champ ENREGISTRAIT « France » sans l'avoir jamais choisi
  //  — le formulaire décidait à sa place, puis présentait sa décision comme
  //  une saisie. Le sélecteur affiche désormais son invite tant que rien n'est
  //  choisi : le vide se voit, le faux ne se voit pas.
  const [country, setCountry] = useState('')

  // LES LISTES QU'ON A RÉELLEMENT LUES. Tant qu'une liste n'est pas ici, on ne
  // l'envoie PAS : un formulaire vide par panne de lecture ne doit jamais
  // pouvoir se transformer en effacement (cf. lib/lecture/liste.ts).
  // Vide au départ, et c'est le bon défaut : avant le chargement, on n'a rien lu.
  const [listesLues, setListesLues] = useState<ListeDeProfil[]>([])

  const [experiences, setExperiences] = useState<ExperienceItem[]>([])
  const [educations, setEducations] = useState<EducationItem[]>([])

  const fieldRefs = {
    title: useRef<HTMLInputElement>(null),
    summary: useRef<HTMLTextAreaElement>(null),
    skills: useRef<HTMLDivElement>(null),
    branch_id: useRef<HTMLSelectElement>(null),
    speciality_ids: useRef<HTMLDivElement>(null),
    seniorities: useRef<HTMLDivElement>(null),
    work_zone_ids: useRef<HTMLDivElement>(null),
    availability: useRef<HTMLDivElement>(null),
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
          color: 'var(--sk-red)',
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
      // L'IDENTITÉ PAR LE COMPTE AFFICHÉ (§E.87) : avec deux comptes dans le navigateur, cette page
      // montrait le profil de l'autre (audit du 30/09/2026).
      const session = await sessionDuCompteAffiche()
      if (session === 'ejecte') return
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
          'id, title, summary, seniorities, years_experience, skills, certifications, branch_id, speciality_ids, speciality_other, work_zone_ids, languages, location, work_modes, temps_travail, tjm_min, tjm_max, availability_date, linkedin_url, cv_parsing_status, ai_consent_at, visible, phone, address_line, postal_code, city, country, birth_year, photo_url, years_total_experience, availability_status',
        )
        .eq('user_id', session.user.id)
        .single()

      // UNE PANNE DE LECTURE N'EST PAS UNE ABSENCE (§E.42) : elle renvoyait vers le dépôt du CV, comme si
      // l'expert n'avait rien déposé. On le DIT, et on ne touche à rien.
      if (profErr) {
        if (!cancelled) {
          setErrorMsg(tProfile('errors.profile_load_failed'))
          setLoading(false)
        }
        return
      }
      if (!profile) {
        router.push('/dashboard/freelance/profil')
        return
      }
      if (cancelled) return
      setProfileId(profile.id as string)
      setEtaitVisible(profile.visible === true)

      setParsingFailed(profile.cv_parsing_status === 'failed')
      setCvParsingStatus((profile as { cv_parsing_status?: string | null }).cv_parsing_status ?? null)
      setAiConsentAt((profile as { ai_consent_at?: string | null }).ai_consent_at ?? null)
      setTitle(profile.title ?? '')
      setSummary(profile.summary ?? '')
      setSeniorities(Array.isArray(profile.seniorities) ? (profile.seniorities as Seniority[]) : [])
      setWorkZoneIds(Array.isArray(profile.work_zone_ids) ? (profile.work_zone_ids as string[]) : [])
      setYearsExperience(
        profile.years_experience != null ? String(profile.years_experience) : '',
      )
      setBranchId(profile.branch_id ?? '')
      // D6 : si pas de speciality_id mais une précision libre, on repositionne
      // la sélection sur « Autre » et on réhydrate le champ texte.
      if (Array.isArray(profile.speciality_ids) && profile.speciality_ids.length > 0) {
        setSpecialityIds(profile.speciality_ids as string[])
        setSpecialityOther('')
      } else if (profile.speciality_other) {
        setSpecialityIds([SPECIALITY_OTHER])
        setSpecialityOther(profile.speciality_other)
      } else {
        setSpecialityIds([])
        setSpecialityOther('')
      }
      setSkills(Array.isArray(profile.skills) ? (profile.skills as string[]) : [])
      setCertifications(
        Array.isArray(profile.certifications)
          ? (profile.certifications as Certification[]).map(ensureUid)
          : [],
      )
      setWorkModes(
        Array.isArray(profile.work_modes) ? (profile.work_modes as WorkMode[]) : [],
      )
      setTempsTravail(valeursConnues(TEMPS_TRAVAIL, profile.temps_travail))
      setLocation(profile.location ?? '')
      setTjmMin(profile.tjm_min != null ? String(profile.tjm_min) : '')
      setTjmMax(profile.tjm_max != null ? String(profile.tjm_max) : '')
      setAvailabilityDate(profile.availability_date ?? '')
      setAvailabilityStatus((profile.availability_status as string | null) ?? null)
      setLinkedinUrl(profile.linkedin_url ?? '')

      setPhone(profile.phone ?? '')
      setBirthYear(profile.birth_year != null ? String(profile.birth_year) : '')
      setAddressLine(profile.address_line ?? '')
      setPostalCode(profile.postal_code ?? '')
      setCity(profile.city ?? '')
      setCountry(profile.country ?? '')

      const taxonomyPromise = fetch(
        `/api/taxonomy?locale=${encodeURIComponent(locale)}&domain_id=${encodeURIComponent(domainId)}&avec=langues`,
        { cache: 'no-store' },
      )
        // ⚠️ LE RÉFÉRENTIEL ILLISIBLE N'EST PAS UN RÉFÉRENTIEL VIDE (audit du 30/09/2026, M11). Retombé sur
        //    des listes vides, il faisait envoyer `branch_slug: null`, `speciality_slugs: []` et
        //    `work_zone_codes: []` — et la route les ÉCRIVAIT : branche, spécialités et zones effacées.
        .then(r => (r.ok ? r.json() : { branches: [], specialities: [], work_zones: [], __illisible: true }))
        .catch(() => ({ branches: [], specialities: [], work_zones: [], __illisible: true }))

      // ⚠️ LES TROIS RÉSULTATS SONT LIÉS ENTIERS, PAS DÉSTRUCTURÉS EN `data`.
      //    `const [{ data: exps }] = …` jetait l'`error` à l'écriture même de
      //    la ligne : il n'y avait plus rien à oublier de lire ensuite. Une
      //    panne rendait `exps` nul, `(exps ?? [])` en faisait une liste vide,
      //    le formulaire s'affichait sans aucune expérience — et l'enregistrer
      //    envoyait `experiences: []`, que la route applique par un `delete`.
      //    Voir `lib/lecture/liste.ts` : la panne ne mentait plus, elle
      //    DEVENAIT la vérité.
      const [taxonomy, expsRes, edusRes, langsRes] =
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

      // Trois états nommés, et le compilateur exige qu'on réponde aux deux
      // branches : `lignes` n'existe QUE dans `'disponible'`.
      const expsLu = listeLue(expsRes)
      const edusLu = listeLue(edusRes)
      const langsLu = listeLue(langsRes)
      // CE QU'ON A RÉELLEMENT LU — c'est cette liste qui autorisera plus tard
      // un remplacement par le vide, côté serveur comme ici.
      const lues: ListeDeProfil[] = []
      if (expsLu.etat === 'disponible') lues.push('experiences')
      if (edusLu.etat === 'disponible') lues.push('educations')
      if (langsLu.etat === 'disponible') lues.push('languages_structured')
      setListesLues(lues)
      if (lues.length < LISTES_DE_PROFIL.length) {
        console.error('[profil valider] lecture de liste en panne', {
          manquantes: LISTES_DE_PROFIL.filter(c => !lues.includes(c)),
        })
      }

      setTaxonomieIndisponible((taxonomy as { __illisible?: boolean }).__illisible === true)
      setBranches((brs ?? []) as Branch[])
      setSpecialities((sps ?? []) as Speciality[])
      setWorkZones((taxonomy.work_zones ?? []) as WorkZone[])
      setLangues(listeDesLangues(((taxonomy as { langues?: string[] }).langues ?? []), locale))

      const raw: Array<ExperienceItem & { _so: number }> = lignesOuVide(expsLu).map(
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
        lignesOuVide(edusLu).map((e: any) => ({
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
        lignesOuVide(langsLu).map((l: any) => ({
          _uid: uid(),
          // Une ligne héritée a été RATTACHÉE en base par la reprise (`rattacher_langues_heritees`, une seule
          // liste — point 20) ; ce qu'elle n'a pas reconnu arrive tel quel, et l'écran demande de le choisir.
          language: l.language ?? '',
          level: (l.level ?? '') as CefrLevel | '',
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
    // « Autre » n'est rattachée à aucune branche : on la conserve au changement.
    // Les autres ne survivent que si elles appartiennent à la nouvelle branche —
    // on ne vide plus TOUTE la sélection, ce qui obligeait à tout ressaisir pour
    // une seule spécialité devenue hors branche.
    setSpecialityIds(prev =>
      prev.filter(sid => sid === SPECIALITY_OTHER || specialitiesById.get(sid)?.branch_id === id),
    )
  }

  const onSpecialitiesChange = (next: string[]) => {
    setSpecialityIds(next)
    if (!next.includes(SPECIALITY_OTHER)) setSpecialityOther('')
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

  // Lot reset CV : appelle la route serveur de remise à zéro complète puis
  // redirige vers l'upload pour déposer un nouveau CV.
  const handleResetCv = async () => {
    if (resetting) return
    setResetting(true)
    setErrorMsg(null)
    try {
      const res = await secureFetch('/api/profile/cv/reset', { method: 'POST' })
      if (!res.ok) {
        // Message LOCALISÉ (4 langues) — on n'affiche jamais l'erreur serveur
        // brute (anglais générique « Update failed »). L'utilisateur comprend
        // qu'il s'agit de l'effacement du CV et qu'il peut réessayer.
        const corps = (await res.json().catch(() => ({}))) as { code?: string }
        setErrorMsg(
          corps.code === 'profil_verification_indisponible'
            ? tProfile('errors.verification_indisponible')
            : tProfile('errors.reset_failed'),
        )
        setResetting(false)
        return
      }
      router.push('/dashboard/freelance/profil')
    } catch {
      setErrorMsg(tProfile('errors.reset_failed'))
      setResetting(false)
    }
  }

  const validateForPublish = (): string[] => {
    // SOURCE UNIQUE : exactement le prédicat que /api/profile applique pour
    // refuser. Il vivait ici en copie, et une copie dérive — un écran finit par
    // annoncer « complet » sur un profil que le serveur rejette, sans que
    // personne puisse dire lequel a raison. L'API reste la barrière (règle 20) ;
    // cet appel ne fait que prévenir plus tôt, avec la MÊME liste.
    const missing: string[] = missingForVisibility(
      {
        title,
        summary,
        skills,
        branch_id: branchId || null,
        // « Autre » n'est pas un identifiant : c'est sa PRÉCISION qui tient le critère (B4).
        speciality_ids: specialityIds.filter(id => id !== SPECIALITY_OTHER),
        speciality_other: specialityIds.includes(SPECIALITY_OTHER) ? specialityOther : null,
        seniorities,
        work_zone_ids: workZoneIds,
        // LA DISPONIBILITÉ EST DEMANDÉE, jamais supposée (audit du 30/09/2026, B1) : l'écran la
        // disait « available » par défaut, ne l'envoyait jamais, et la route refusait la publication
        // sur un champ que personne n'avait montré.
        availability_status: availabilityStatus,
        cdi_status: null,
        experiences_count: experiences.filter(e => e.role.trim()).length,
        languages_count: languagesStructured.filter(l => l.language.trim()).length,
        cv_parsing_status: cvParsingStatus,
        ai_consent_at: aiConsentAt,
      },
      'expert_freelance',
    )
    // Deux règles PROPRES au formulaire freelance, absentes du prédicat partagé
    // parce qu'elles ne conditionnent pas la visibilité en base :
    if (workModes.length === 0) missing.push('work_modes')
    // D6 : « Autre » coché sans précision libre = spécialité incomplète.
    if (specialityIds.includes(SPECIALITY_OTHER) && !specialityOther.trim()) {
      if (!missing.includes('speciality_ids')) missing.push('speciality_ids')
    }
    return missing
  }

  const save = async (visible: boolean) => {
    if (!accessToken || saving) return
    setErrorMsg(null)
    setSuccessMsg(null)
    setMissingFields(null)
    if (taxonomieIndisponible) {
      // Sans référentiel, l'écran ne sait ni lire ni écrire la branche, les spécialités, les zones.
      setErrorMsg(tProfile('errors.taxonomy_unavailable'))
      return
    }

    if (visible) {
      const missing = validateForPublish()
      if (missing.length) {
        showFieldError(missing)
        return
      }
    }

    // LES LANGUES : une langue hors de la liste fermée ou un niveau non choisi ne partent pas en
    // silence — l'écran dit laquelle (recette du 01/10/2026, point 3).
    const languesVerdict = languesAEnvoyer(languagesStructured, new Set(langues.map(x => x.code)))
    if (!languesVerdict.ok) {
      setErrorMsg(tLangues(languesVerdict.raison, { rang: languesVerdict.rang }))
      showFieldError(['languages_structured'])
      return
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

    const cleanedLanguages = languesVerdict.lignes

    const body: Record<string, unknown> = {
      title: title.trim() || null,
      summary: summary.trim() || null,
      seniorities,
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
      // Le serveur résout les slugs et REFUSE un slug inconnu : le client
      // n'envoie jamais d'identifiant de taxonomie.
      speciality_slugs: specialityIds
        .filter(id => id !== SPECIALITY_OTHER)
        .map(id => specialitiesById.get(id)?.slug)
        .filter((sl): sl is string => !!sl),
      // D6 : précision libre transmise quand « Autre », sinon effacée.
      speciality_other: specialityIds.includes(SPECIALITY_OTHER)
        ? specialityOther.trim()
        : null,
      // Zones transmises en CODES stables, jamais en uuid.
      work_zone_codes: workZoneIds
        .map(id => workZones.find(z => z.id === id)?.code)
        .filter((c): c is string => !!c),
      // La liste plate des langues suit la liste STRUCTURÉE : pas lue, pas envoyée (sinon `[]` l'effacerait).
      ...(listesLues.includes('languages_structured') ? { languages: cleanedLanguages.map(l => l.language) } : {}),
      location: location.trim() || null,
      work_modes: workModes,
      temps_travail: tempsTravail,
      tjm_min: tjmMin.trim() === '' ? null : Number(tjmMin),
      tjm_max: tjmMax.trim() === '' ? null : Number(tjmMax),
      availability_date: availabilityDate || null,
      // B1 : la disponibilité, telle que l'expert l'a DONNÉE (null tant qu'il n'a pas répondu).
      availability_status: availabilityStatus,
      linkedin_url: linkedinUrl.trim() || null,
      phone: phone.trim() || null,
      address_line: addressLine.trim() || null,
      postal_code: postalCode.trim() || null,
      city: city.trim() || null,
      country: country || null,
      birth_year: birthYear.trim() === '' ? null : Number(birthYear),
      // ── UNE LISTE NON LUE NE S'ENVOIE PAS ────────────────────────────────
      //  `'experiences' in body` est ce qui DÉCLENCHE le remplacement côté
      //  route. Omettre la clé est donc la seule façon de ne rien toucher —
      //  envoyer `[]` serait un effacement, pas une abstention.
      ...(listesLues.includes('experiences') ? { experiences: cleanedExperiences } : {}),
      ...(listesLues.includes('educations') ? { educations: cleanedEducations } : {}),
      ...(listesLues.includes('languages_structured')
        ? { languages_structured: cleanedLanguages }
        : {}),
      //  Et on DÉCLARE ce qu'on a lu : la route s'en sert pour refuser un
      //  remplacement par le vide qu'aucune lecture n'appuie (§E.22 ②).
      listes_lues: listesLues,
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

      // PUBLIER RAMÈNE AU TABLEAU DE BORD (recette du 01/10/2026, point 7) — y compris quand
      // la publication est ÉCRITE et que seule la ligne du grand livre a été refusée
      // (`journal_error`, lib/profil/refus-profil.ts) : le profil est publié, l'expert n'a plus
      // rien à faire ici. La notification « l'IA vérifie » est déjà posée par la route.
      if (visible && !res.ok && payload?.code === 'journal_error') {
        router.push('/dashboard/freelance')
        return
      }

      if (!res.ok) {
        if (
          res.status === 400 &&
          payload?.code === 'incomplete' &&
          Array.isArray(payload?.missing)
        ) {
          showFieldError(payload.missing)
        } else if (res.status === 400 && payload?.code === 'cv_not_ready') {
          setErrorMsg(tProfile('errors.cv_not_ready'))
        } else if (
          // LA BARRIÈRE SERVEUR A MORDU. Elle ne devrait jamais mordre depuis
          // cet écran — il n'envoie plus une liste qu'il n'a pas lue — mais un
          // refus muet serait pire que le défaut : on dit ce qui s'est passé,
          // et on dit que RIEN n'a été perdu.
          payload?.code === 'effacement_non_declare' ||
          payload?.code === 'effacement_verification_indisponible'
        ) {
          setErrorMsg(tProfile('errors.erase_not_declared'))
        } else if (
          // Une LECTURE qui n’a pas abouti, pas un refus de la saisie. Le
          // message le dit, et il dit que rien n’a été modifié.
          payload?.code === 'referentiel_indisponible' ||
          payload?.code === 'completude_indisponible' ||
          payload?.code === 'profil_verification_indisponible'
        ) {
          setErrorMsg(tProfile('errors.verification_indisponible'))
        } else {
          // CHAQUE AUTRE CODE A SON MESSAGE (lib/profil/refus-profil.ts) — un `journal_error` après une
          // publication RÉUSSIE ne se dit plus « erreur lors de la sauvegarde ».
          setErrorMsg(messageRefusProfil(payload, res.status, (cle, v) => tRefus(cle as 'inattendu', v)))
        }
        return
      }

      if (visible) {
        // La vérification est un TRAVAIL (§D.30) : le tableau de bord dit « en cours » tant que c'est vrai.
        router.push('/dashboard/freelance')
        return
      }

      setSuccessMsg(tProfile('success.draft_saved'))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      console.error('[profil valider] patch error', err)
      setErrorMsg(tProfile('errors.save_failed'))
    } finally {
      // Un seul point de relâchement (motif de /connexion) ; la garde
      // `saving` en tête couvre la navigation de succès encore en vol.
      setSaving(false)
    }
  }

  const isMissing = (field: string) =>
    Array.isArray(missingFields) && missingFields.includes(field)

  const inputStyle = (field?: string): React.CSSProperties => ({
    width: '100%',
    padding: '10px 14px',
    border: `1.5px solid ${field && isMissing(field) ? 'var(--sk-red)' : 'var(--sk-border)'}`,
    borderRadius: 10,
    fontSize: 14,
    color: 'var(--sk-text)',
    outline: 'none',
    background: 'var(--sk-surface)',
    fontFamily: 'inherit',
  })

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--sk-muted)',
    marginBottom: 6,
    fontFamily: fontJakarta,
  }

  const sectionStyle: React.CSSProperties = {
    background: 'var(--sk-surface)',
    border: '1px solid var(--sk-border)',
    borderRadius: 16,
    padding: 24,
    marginBottom: 20,
    breakInside: 'avoid',
  }

  const primaryAddBtnStyle: React.CSSProperties = {
    background: 'var(--sk-accent)',
    color: 'var(--sk-sur-accent)',
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
    background: `color-mix(in srgb, var(--sk-accent) 8%, transparent)`,
    color: 'var(--sk-accent)',
    border: `1px solid color-mix(in srgb, var(--sk-accent) 20%, transparent)`,
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
    background: `color-mix(in srgb, var(--sk-accent) 8%, transparent)`,
    color: 'var(--sk-accent)',
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
          color: 'var(--sk-accent)',
          border: `1px solid color-mix(in srgb, var(--sk-accent) 20%, transparent)`,
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
                    maxLength={LONGUEURS_SAISIE.role}
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
                    maxLength={LONGUEURS_SAISIE.employer}
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
                    maxLength={LONGUEURS_SAISIE.client_name}
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
                    maxLength={LONGUEURS_SAISIE.sector}
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
            color: 'var(--sk-muted)',
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
            style={{ accentColor: 'var(--sk-accent)' }}
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
      style={{ minHeight: '100%', background: 'var(--sk-surface-2)', fontFamily: fontInter }}
    >
      <style>{`
        @keyframes sk-spin { to { transform: rotate(360deg); } }
        @keyframes sk-focus-ring {
          0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--sk-red) 0%, transparent); }
          50% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--sk-red) 25%, transparent); }
        }
        .sk-focus-highlight { animation: sk-focus-ring 0.7s ease-out 2; border-radius: 10px; }
        @keyframes sk-fade-in {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .compact-extra { animation: sk-fade-in 200ms ease-out both; }
        .show-more-btn:hover { transform: translateY(-1px); background: color-mix(in srgb, var(--sk-accent) 6%, transparent); }
        @media (max-width: 767px) {
          .profil-main { padding: 18px !important; }
          .profil-title { font-size: 26px !important; }
          .profil-row { grid-template-columns: 1fr !important; }
          .profil-sections { column-count: 1 !important; }
          .profil-actions {
            position: sticky; bottom: 0; z-index: 20;
            margin-left: -18px; margin-right: -18px;
            border-radius: 0; border-top: 1px solid var(--sk-border);
            padding: 14px 18px;
            flex-direction: column-reverse;
          }
        }
      `}</style>

      {/* Main — l'en-tête interne (logo + nom de domaine + LanguageSwitcher +
          badge de statut) a été retiré : le DashboardShell fournit déjà le logo
          (sidebar) et le LanguageSwitcher (topbar). Le statut de vérification
          reste sur le tableau de bord (dérivé, non dupliqué ici). */}
      <div className="profil-main" style={{ width: '100%', padding: 24 }}>
        {loading ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 80,
              color: 'var(--sk-muted)',
              fontSize: 14,
              fontFamily: fontJakarta,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                border: `3px solid color-mix(in srgb, var(--sk-accent) 13%, transparent)`,
                borderTopColor: 'var(--sk-accent)',
                marginBottom: 16,
                animation: 'sk-spin 0.9s linear infinite',
              }}
            />
            {tProfile('loading')}
          </div>
        ) : (
          <>
            {/* Bouton Retour local retiré : le GlobalBackButton du shell est
                l'unique bouton Retour (règle projet). */}
            {/* ── UNE SECTION QU'ON N'A PAS SU LIRE LE DIT, ET DONNE UNE SORTIE ──
                §E.19 : un écran qui affirme plus que ce qu'il sait enferme
                quelqu'un dans une attente. Ici l'affirmation muette était la
                pire possible — un formulaire VIDE, qui se lit « vous n'avez
                rien saisi ». On nomme les sections manquantes, on dit qu'elles
                ne seront pas touchées, et on donne l'action. */}
            {listesLues.length < LISTES_DE_PROFIL.length && (
              <div
                role="status"
                aria-live="polite"
                style={{
                  background: 'var(--sk-amber-soft)',
                  border: '1px solid var(--sk-amber-soft)',
                  borderRadius: 12,
                  padding: '12px 16px',
                  marginBottom: 20,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: 'var(--sk-amber)', fontSize: 14, marginBottom: 4 }}>
                    {tProfile('errors.list_read_failed_title')}
                  </div>
                  <div style={{ color: 'var(--sk-amber)', fontSize: 13, lineHeight: 1.5 }}>
                    {tProfile('errors.list_read_failed_body', {
                      sections: LISTES_DE_PROFIL.filter(c => !listesLues.includes(c))
                        .map(c => tProfile(`sections.${c}`))
                        .join(', '),
                    })}
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
                  {tProfile('errors.list_read_failed_retry')}
                </button>
              </div>
            )}
            {errorMsg && (
              <div
                role="alert"
                aria-live="assertive"
                style={{
                  position: 'sticky',
                  top: 16,
                  zIndex: 50,
                  background: 'var(--sk-red-soft)',
                  border: '1px solid var(--sk-red-soft)',
                  borderRadius: 12,
                  padding: '12px 16px',
                  marginBottom: 20,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  boxShadow: '0 6px 24px color-mix(in srgb, var(--sk-red) 8%, transparent)',
                }}
              >
                <div
                  style={{
                    color: 'var(--sk-red)',
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
                          .map(f => MISSING_LABELS[f])
                          .filter(Boolean)
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
                    color: 'var(--sk-red)',
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
                  background: 'var(--sk-success-soft)',
                  border: '1px solid var(--sk-success-soft)',
                  borderRadius: 12,
                  padding: '12px 16px',
                  marginBottom: 20,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  boxShadow: '0 6px 24px color-mix(in srgb, var(--sk-success) 10%, transparent)',
                }}
              >
                <div
                  style={{
                    color: 'var(--sk-success)',
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
                    background: 'var(--sk-success)',
                    color: 'var(--sk-sur-accent)',
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
                    color: 'var(--sk-success)',
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

            <EcartsAnalyse profileId={profileId} />

            {parsingFailed && !errorMsg && !successMsg && (
              <div
                style={{
                  background: 'var(--sk-amber-soft)',
                  border: '1px solid var(--sk-amber-soft)',
                  borderRadius: 12,
                  padding: '12px 16px',
                  marginBottom: 20,
                  fontSize: 13,
                  color: 'var(--sk-amber)',
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
                color: 'var(--sk-text)',
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
                color: 'var(--sk-muted)',
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
                background: `color-mix(in srgb, var(--sk-accent) 6%, transparent)`,
                border: `1px solid color-mix(in srgb, var(--sk-accent) 20%, transparent)`,
                borderRadius: 12,
                padding: '12px 16px',
                marginBottom: 24,
                fontSize: 13,
                color: 'var(--sk-accent)',
                fontWeight: 500,
                fontFamily: fontJakarta,
              }}
            >
              {tProfile('ai_banner')}
            </div>

            {/* Sections en grille 2 colonnes (pleine largeur, aligné à gauche) */}
            <div className="profil-sections" style={{ columnCount: 2, columnGap: 24 }}>
            {/* Section 1 — Identité pro */}
            <div style={sectionStyle}>
              <SectionHeader n="1" title={tProfile('sections.identity.title')} />

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>{tProfile('sections.identity.title_label')}</label>
                <input
                    maxLength={LONGUEURS_SAISIE.title}
                  ref={fieldRefs.title}
                  className={focusClass('title')}
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder={tProfile('sections.identity.title_placeholder')}
                  style={inputStyle('title')}
                />
                <FieldError field="title" />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>{tProfile('sections.identity.summary_label')}</label>
                <p
                  style={{
                    fontSize: 12,
                    color: 'var(--sk-muted)',
                    margin: '0 0 8px',
                    fontFamily: fontJakarta,
                    lineHeight: 1.5,
                  }}
                >
                  {tProfile('sections.summary_matching.summary_matching_help', {
                    min: RESUME_MIN,
                    max: RESUME_MAX,
                  })}
                </p>
                <textarea
                  ref={fieldRefs.summary}
                  className={focusClass('summary')}
                  rows={5}
                  maxLength={RESUME_MAX}
                  value={summary}
                  onChange={e => setSummary(e.target.value)}
                  placeholder={tProfile('sections.identity.summary_placeholder')}
                  style={{ ...inputStyle('summary'), resize: 'vertical', minHeight: 120 }}
                />
                <div
                  style={{
                    fontSize: 11,
                    // Rouge tant que le texte est hors des bornes : le compteur
                    // dit alors quelque chose, au lieu d'afficher un chiffre
                    // neutre pendant que le bouton refuse de publier.
                    color:
                      summary.trim().length > 0 &&
                      (summary.trim().length < RESUME_MIN || summary.trim().length > RESUME_MAX)
                        ? 'var(--sk-red)'
                        : 'var(--sk-muted)',
                    marginTop: 4,
                    fontFamily: fontJakarta,
                  }}
                >
                  {tProfile('sections.summary_matching.summary_counter', {
                    count: summary.trim().length,
                    max: RESUME_MAX,
                  })}
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
                <div ref={fieldRefs.seniorities} className={focusClass('seniorities')}>
                  <label style={labelStyle}>
                    {tProfile('field_labels_short.seniorities')}
                  </label>
                  <MultiSelectChips
                    ariaLabel={tProfile('field_labels_short.seniorities')}
                    options={SENIORITES.map(v => ({ value: v, label: SENIORITY_LABELS[v] }))}
                    selected={seniorities}
                    onChange={next => setSeniorities(next as Seniority[])}
                    invalid={isMissing('seniorities')}
                  />
                  <FieldError field="seniorities" />
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
              <SectionHeader n="2" title={tProfile('sections.expertise.title')} />

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
                <div ref={fieldRefs.speciality_ids} className={focusClass('speciality_ids')}>
                  <MultiSelectChips
                    ariaLabel={tProfile('field_labels_short.speciality_ids')}
                    // LES SPÉCIALITÉS DE LA BRANCHE, plus « Autre (préciser) » — la liste de l'annonce (§D.39).
                    options={optionsSpecialites(specialities, branchId, tProfile('sections.expertise.speciality_other_option'))}
                    selected={specialityIds}
                    onChange={onSpecialitiesChange}
                    invalid={isMissing('speciality_ids')}
                    emptyLabel={tProfile('sections.expertise.speciality_placeholder')}
                  />
                </div>
                <FieldError field="speciality_ids" />

                {specialityIds.includes(SPECIALITY_OTHER) && (
                  <div style={{ marginTop: 10 }}>
                    <label style={labelStyle}>
                      {tProfile('sections.expertise.speciality_other_label')}
                    </label>
                    <input
                      type="text"
                      value={specialityOther}
                      onChange={e => setSpecialityOther(e.target.value)}
                      maxLength={100}
                      placeholder={tProfile('sections.expertise.speciality_other_placeholder')}
                      style={inputStyle('speciality_ids')}
                    />
                  </div>
                )}
              </div>

              {/* ── ZONES DE TRAVAIL ────────────────────────────────────────
                  Placées ici, avec branche et spécialités, parce que c'est un
                  critère de mise en relation comme elles — et non dans le bloc
                  « disponibilité », où l'ancien champ « Localisation » laissait
                  croire qu'on décrivait un domicile. */}
              <div
                ref={fieldRefs.work_zone_ids}
                className={focusClass('work_zone_ids')}
                style={{ marginBottom: 14 }}
              >
                <label style={labelStyle}>
                  {tWorkZones('label')}{' '}
                  <span style={{ color: 'var(--sk-muted)', fontWeight: 400 }}>· {tWorkZones('hint')}</span>
                </label>
                <WorkZoneSelector
                  zones={workZones}
                  selected={workZoneIds}
                  onChange={setWorkZoneIds}
                  invalid={isMissing('work_zone_ids')}
                />
                <FieldError field="work_zone_ids" />
              </div>

              <div
                ref={fieldRefs.skills}
                className={focusClass('skills')}
                style={{ padding: 2 }}
              >
                <label style={labelStyle}>
                  {tProfile('sections.expertise.skills_label')}{' '}
                  <span style={{ color: 'var(--sk-muted)', fontWeight: 400 }}>
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
                          color: 'var(--sk-accent)',
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
                    color: 'var(--sk-muted)',
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
                  accentColor={'var(--sk-accent)'}
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
               
                title={tProfile('sections.availability.title')}
              />

              {/* LA DISPONIBILITÉ — un CV dit ce qu'on a fait, jamais ce qu'on accepte : on la DEMANDE,
                  sans valeur cochée d'avance (audit du 30/09/2026, B1). Le prédicat de visibilité l'exige. */}
              <div
                ref={fieldRefs.availability}
                className={focusClass('availability')}
                role="radiogroup"
                aria-label={tProfile('sections.availability.status_label')}
                style={{ marginBottom: 18 }}
              >
                <label style={labelStyle}>{tProfile('sections.availability.status_label')}</label>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {(['available', 'do_not_disturb'] as const).map(v => {
                    const active = availabilityStatus === v
                    return (
                      <label
                        key={v}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '10px 14px',
                          border: `1.5px solid ${
                            active ? 'var(--sk-accent)' : isMissing('availability') ? 'var(--sk-red)' : 'var(--sk-border)'
                          }`,
                          borderRadius: 10,
                          background: active ? `color-mix(in srgb, var(--sk-accent) 6%, transparent)` : 'var(--sk-surface)',
                          cursor: 'pointer',
                          fontSize: 13,
                          fontWeight: 600,
                          color: active ? 'var(--sk-accent)' : 'var(--sk-muted)',
                          fontFamily: fontJakarta,
                        }}
                      >
                        <input
                          type="radio"
                          name="availability_status"
                          checked={active}
                          onChange={() => setAvailabilityStatus(v)}
                          style={{ accentColor: 'var(--sk-accent)' }}
                        />
                        {tProfile(`sections.availability.status_options.${v}`)}
                      </label>
                    )
                  })}
                </div>
                <div style={{ fontSize: 12, color: 'var(--sk-muted)', marginTop: 6, fontFamily: fontJakarta }}>
                  {tProfile('sections.availability.status_hint')}
                </div>
                <FieldError field="availability" />
              </div>

              <div
                ref={fieldRefs.work_modes}
                className={focusClass('work_modes')}
                style={{ marginBottom: 14 }}
              >
                <label style={labelStyle}>
                  {tProfile('sections.availability.work_modes_label')}{' '}
                  <span style={{ color: 'var(--sk-muted)', fontWeight: 400 }}>
                    · {tProfile('sections.availability.work_modes_hint')}
                  </span>
                </label>
                {/* LES MODES DE TRAVAIL — le composant et les valeurs de l'annonce (§D.39). */}
                <ChoixModesTravail valeur={workModes} onChange={setWorkModes} invalide={isMissing('work_modes')} />
                <FieldError field="work_modes" />
              </div>

              {/* TEMPS PLEIN OU TEMPS PARTIEL — un champ à part, les valeurs de l'annonce (§D.39). Facultatif ; ne filtre pas. */}
              <div style={{ marginBottom: 14 }}>
                <label id="sk-profil-temps" style={labelStyle}>
                  {tCrit('champs.temps_travail')}{' '}
                  <span style={{ color: 'var(--sk-muted)', fontWeight: 400 }}>· {tCrit('aides.temps_travail_profil')}</span>
                </label>
                <ChoixTempsTravail idGroupe="sk-profil-temps" valeur={tempsTravail} onChange={setTempsTravail} />
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
                    <span style={{ color: 'var(--sk-muted)', fontWeight: 400 }}>
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
                      color: 'var(--sk-muted)',
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
                        {/* Le NOM dans la langue de l'écran ; une ligne neuve le dit, sans montrer d'exemple comme une langue. */}
                        {l.language ? nomDeLangue(l.language, locale) : tLangues('nouvelle')}
                        {l.is_primary && (
                          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--sk-accent)', fontWeight: 700 }}>★</span>
                        )}
                      </>
                    }
                    subtitle={l.level ? CEFR_LABELS[l.level] : tLangues('niveau_a_choisir')}
                    isExpanded={expandedIds.has(l._uid!)}
                    onToggleExpand={() => toggleExpand(l._uid!)}
                    confirmingDelete={confirmingDeleteId === l._uid}
                    onRequestDelete={() => requestDelete(l._uid!)}
                    onConfirmDelete={confirmDeleteAndRun(l._uid!, () => removeLanguage(i))}
                    onCancelDelete={cancelDelete}
                    accentColor={'var(--sk-accent)'}
                  >
                    <div
                      className="profil-row"
                      style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr auto', gap: 10, alignItems: 'center' }}
                    >
                      <ChoixLangue
                        valeur={l.language}
                        langues={langues}
                        dejaChoisies={new Set(languagesStructured.filter((_, j) => j !== i).map(x => x.language))}
                        onChange={code => updateLanguage(i, { language: code })}
                        style={inputStyle('languages_structured')}
                      />
                      <ChoixNiveauLangue
                        valeur={l.level}
                        libelles={CEFR_LABELS}
                        onChange={niveau => updateLanguage(i, { level: niveau as CefrLevel })}
                        style={inputStyle()}
                      />
                      <label
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          color: l.is_primary ? 'var(--sk-accent)' : 'var(--sk-muted)',
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
                          style={{ accentColor: 'var(--sk-accent)' }}
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
              <SectionHeader n="5" title={tProfile('sections.links.title')} />
              <label style={labelStyle}>{tProfile('sections.links.linkedin_label')}</label>
              <input
                    maxLength={LONGUEURS_SAISIE.linkedin_url}
                type="url"
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
                    maxLength={LONGUEURS_SAISIE.phone}
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
                    min={ANNEE_NAISSANCE_MIN}
                    max={anneeNaissanceMax()}
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
                    maxLength={LONGUEURS_SAISIE.address_line}
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
                    maxLength={LONGUEURS_SAISIE.postal_code}
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
                    maxLength={LONGUEURS_SAISIE.city}
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
                  primaryColor={'var(--sk-accent)'}
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
                    color: 'var(--sk-muted)',
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
                    accentColor={'var(--sk-accent)'}
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
                    color: 'var(--sk-muted)',
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
                    accentColor={'var(--sk-accent)'}
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
                    color: 'var(--sk-muted)',
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
                  accentColor={'var(--sk-accent)'}
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
                    maxLength={LONGUEURS_SAISIE.school}
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
                    maxLength={LONGUEURS_SAISIE.degree}
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
                    maxLength={LONGUEURS_SAISIE.field}
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
                    maxLength={LONGUEURS_SAISIE.education_location}
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
                        min={ANNEE_FORMATION_MIN}
                        max={anneeDebutFormationMax()}
                        value={edu.start_year}
                        onChange={e => updateEducation(i, { start_year: e.target.value })}
                        style={inputStyle()}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>{tProfile('sections.education.end_year_label')}</label>
                      <input
                        type="number"
                        min={ANNEE_FORMATION_MIN}
                        max={anneeFinFormationMax()}
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
            </div>{/* fin .profil-sections */}

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
                  {etaitVisible && (
                    <div role="note" style={{ fontSize: 12, color: 'var(--sk-muted)', lineHeight: 1.5, fontFamily: fontJakarta }}>
                      {tProfile('actions.draft_unpublishes')}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 12 }}>
                    <button
                      type="button"
                      onClick={() => save(false)}
                      disabled={saving}
                      style={{
                        flex: 1,
                        background: 'var(--sk-surface)',
                        color: 'var(--sk-accent)',
                        border: `1.5px solid var(--sk-accent)`,
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
                        background: canPublish ? 'var(--sk-accent)' : 'var(--sk-surface-2)',
                        color: canPublish ? 'var(--sk-sur-accent)' : 'var(--sk-muted)',
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
                  {/* Lot reset CV : annuler/retélécharger (action destructive). */}
                  <div style={{ borderTop: '1px solid var(--sk-border)', marginTop: 4, paddingTop: 12 }}>
                    {!showResetConfirm ? (
                      <button
                        type="button"
                        onClick={() => setShowResetConfirm(true)}
                        disabled={saving || resetting}
                        style={{
                          width: '100%',
                          background: 'transparent',
                          color: 'var(--sk-muted)',
                          border: 'none',
                          padding: '4px 0',
                          fontSize: 13,
                          fontWeight: 600,
                          textDecoration: 'underline',
                          cursor: (saving || resetting) ? 'not-allowed' : 'pointer',
                          fontFamily: fontJakarta,
                        }}
                      >
                        {tProfile('actions.reset_cv')}
                      </button>
                    ) : (
                      <div
                        role="alertdialog"
                        style={{
                          background: 'var(--sk-surface-2)',
                          border: '1px solid var(--sk-border)',
                          borderRadius: 12,
                          padding: '12px 14px',
                        }}
                      >
                        <div style={{ fontSize: 13, color: 'var(--sk-text)', lineHeight: 1.5, marginBottom: 10 }}>
                          {tProfile('actions.reset_cv_confirm')}
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                          <button
                            type="button"
                            onClick={() => setShowResetConfirm(false)}
                            disabled={resetting}
                            style={{
                              flex: 1,
                              background: 'var(--sk-surface)',
                              color: 'var(--sk-text)',
                              border: '1px solid var(--sk-border)',
                              borderRadius: 10,
                              padding: 11,
                              fontSize: 13,
                              fontWeight: 600,
                              cursor: resetting ? 'not-allowed' : 'pointer',
                              fontFamily: fontJakarta,
                            }}
                          >
                            {tProfile('actions.reset_cv_cancel')}
                          </button>
                          <button
                            type="button"
                            onClick={handleResetCv}
                            disabled={resetting}
                            style={{
                              flex: 1,
                              background: 'var(--sk-red)',
                              color: 'var(--sk-sur-accent)',
                              border: 'none',
                              borderRadius: 10,
                              padding: 11,
                              fontSize: 13,
                              fontWeight: 700,
                              cursor: resetting ? 'not-allowed' : 'pointer',
                              opacity: resetting ? 0.6 : 1,
                              fontFamily: fontJakarta,
                            }}
                          >
                            {resetting ? tProfile('actions.reset_cv_loading') : tProfile('actions.reset_cv_confirm_btn')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })()}
          </>
        )}
      </div>
    </div>
  )
}
