'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useDomain } from '@/context/DomainContext'
import { supabase } from '@/lib/supabase'

type Seniority = 'junior' | 'confirmed' | 'senior' | 'expert'
type WorkMode = 'remote' | 'onsite' | 'hybrid'

type Certification = {
  name: string
  issuer: string | null
  year: number | null
}

type Branch = { id: string; name: string; slug: string }
type Speciality = { id: string; name: string; slug: string; branch_id: string }

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

export default function ValiderProfilPage() {
  const router = useRouter()
  const domain = useDomain()

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
  const [workMode, setWorkMode] = useState<WorkMode | ''>('')
  const [location, setLocation] = useState('')
  const [tjmMin, setTjmMin] = useState('')
  const [tjmMax, setTjmMax] = useState('')
  const [availabilityDate, setAvailabilityDate] = useState('')
  const [languages, setLanguages] = useState<string[]>([])
  const [langDraft, setLangDraft] = useState('')
  const [linkedinUrl, setLinkedinUrl] = useState('')

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
          'id, title, summary, seniority, years_experience, skills, certifications, branch_id, speciality_id, languages, location, work_mode, tjm_min, tjm_max, availability_date, linkedin_url, cv_parsing_status, visible',
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
      setWorkMode((profile.work_mode as WorkMode | null) ?? '')
      setLocation(profile.location ?? '')
      setTjmMin(profile.tjm_min != null ? String(profile.tjm_min) : '')
      setTjmMax(profile.tjm_max != null ? String(profile.tjm_max) : '')
      setAvailabilityDate(profile.availability_date ?? '')
      setLanguages(Array.isArray(profile.languages) ? (profile.languages as string[]) : [])
      setLinkedinUrl(profile.linkedin_url ?? '')

      const [{ data: brs }, { data: sps }] = await Promise.all([
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
      ])
      if (cancelled) return
      setBranches((brs ?? []) as Branch[])
      setSpecialities((sps ?? []) as Speciality[])

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

  const addLang = () => {
    const s = langDraft.trim()
    if (!s) return
    if (!languages.includes(s)) setLanguages([...languages, s])
    setLangDraft('')
  }
  const removeLang = (s: string) => setLanguages(languages.filter(x => x !== s))

  const addCert = () =>
    setCertifications([...certifications, { name: '', issuer: null, year: null }])
  const updateCert = (i: number, patch: Partial<Certification>) =>
    setCertifications(
      certifications.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    )
  const removeCert = (i: number) =>
    setCertifications(certifications.filter((_, idx) => idx !== i))

  const validateForPublish = (): string[] => {
    const missing: string[] = []
    if (!title.trim()) missing.push('title')
    if (!summary.trim() || summary.trim().length < 20) missing.push('summary')
    if (skills.length < 3) missing.push('skills')
    if (!branchId) missing.push('branch_id')
    if (!specialityId) missing.push('speciality_id')
    if (!workMode) missing.push('work_mode')
    return missing
  }

  const save = async (visible: boolean) => {
    if (!accessToken || saving) return
    setErrorMsg(null)
    setMissingFields(null)

    if (visible) {
      const missing = validateForPublish()
      if (missing.length) {
        setMissingFields(missing)
        setErrorMsg(
          'Pour publier votre profil, complétez : titre, résumé (20+ caractères), 3 compétences min, branche, spécialité, mode de travail.',
        )
        return
      }
    }

    setSaving(true)

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
      languages,
      location: location.trim() || null,
      work_mode: workMode || null,
      tjm_min: tjmMin.trim() === '' ? null : Number(tjmMin),
      tjm_max: tjmMax.trim() === '' ? null : Number(tjmMax),
      availability_date: availabilityDate || null,
      linkedin_url: linkedinUrl.trim() || null,
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
          setMissingFields(payload.missing)
          setErrorMsg('Profil incomplet, vérifiez les champs surlignés.')
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
  }

  const sectionStyle: React.CSSProperties = {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 16,
    padding: 24,
    marginBottom: 20,
  }

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 16,
    fontWeight: 700,
    color: '#0f172a',
    marginBottom: 16,
    letterSpacing: '-0.2px',
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'Inter, sans-serif' }}>
      <style>{`
        @keyframes sk-spin { to { transform: rotate(360deg); } }
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
          <span style={{ fontSize: 17, fontWeight: 700, color: '#111827' }}>{domain.name}</span>
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
          <span style={{ fontSize: 13, fontWeight: 500, color: '#92400e', whiteSpace: 'nowrap' }}>
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
              }}
            >
              ← Retour
            </button>

            {errorMsg && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 12,
                  padding: '12px 16px',
                  marginBottom: 20,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                }}
              >
                <div style={{ color: '#dc2626', fontSize: 13, flex: 1, lineHeight: 1.55 }}>
                  {errorMsg}
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
              }}
            >
              💡 Notre IA a pré-rempli ces champs. Modifiez si nécessaire avant de publier.
            </div>

            {/* Section 1 — Identité pro */}
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>1. Identité professionnelle</div>

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Titre professionnel</label>
                <input
                  type="text"
                  maxLength={200}
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Ex: Consultant Dynamics 365 F&O Senior"
                  style={inputStyle('title')}
                />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Résumé</label>
                <textarea
                  rows={4}
                  maxLength={500}
                  value={summary}
                  onChange={e => setSummary(e.target.value)}
                  placeholder="10 ans d'expérience sur..."
                  style={{ ...inputStyle('summary'), resize: 'vertical', minHeight: 100 }}
                />
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                  {summary.trim().length}/500 · minimum 20 caractères pour publier
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
              <div style={sectionTitleStyle}>2. Expertise</div>

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Branche principale</label>
                <select
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
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Spécialité</label>
                <select
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
              </div>

              <div>
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
                  <button
                    type="button"
                    onClick={addSkill}
                    style={{
                      background: domain.primaryColor,
                      color: '#fff',
                      border: 'none',
                      borderRadius: 10,
                      padding: '10px 18px',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    Ajouter
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {skills.map(s => (
                    <span
                      key={s}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        background: `${domain.primaryColor}15`,
                        color: domain.primaryColor,
                        padding: '4px 10px',
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
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
              </div>
            </div>

            {/* Section 3 — Certifications */}
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>3. Certifications</div>

              {certifications.length === 0 && (
                <div
                  style={{
                    fontSize: 13,
                    color: '#94a3b8',
                    padding: '10px 0 14px',
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
                    style={{
                      background: '#fef2f2',
                      color: '#dc2626',
                      border: '1.5px solid #fecaca',
                      borderRadius: 10,
                      padding: '10px 12px',
                      fontSize: 14,
                      cursor: 'pointer',
                      height: 42,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={addCert}
                style={{
                  background: 'transparent',
                  color: domain.primaryColor,
                  border: `1.5px dashed ${domain.primaryColor}66`,
                  borderRadius: 10,
                  padding: '10px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginTop: 4,
                }}
              >
                + Ajouter une certification
              </button>
            </div>

            {/* Section 4 — Disponibilité */}
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>4. Disponibilité</div>

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Mode de travail</label>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {(Object.keys(WORK_MODE_LABELS) as WorkMode[]).map(m => {
                    const active = workMode === m
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
                              : isMissing('work_mode')
                                ? '#dc2626'
                                : '#e2e8f0'
                          }`,
                          borderRadius: 10,
                          background: active ? `${domain.primaryColor}10` : '#fff',
                          cursor: 'pointer',
                          fontSize: 13,
                          fontWeight: 600,
                          color: active ? domain.primaryColor : '#374151',
                        }}
                      >
                        <input
                          type="radio"
                          name="work_mode"
                          checked={active}
                          onChange={() => setWorkMode(m)}
                          style={{ accentColor: domain.primaryColor }}
                        />
                        {WORK_MODE_LABELS[m]}
                      </label>
                    )
                  })}
                </div>
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

              <div>
                <label style={labelStyle}>Langues</label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <input
                    type="text"
                    value={langDraft}
                    onChange={e => setLangDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addLang()
                      }
                    }}
                    placeholder="Français, Anglais..."
                    style={{ ...inputStyle(), flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={addLang}
                    style={{
                      background: domain.primaryColor,
                      color: '#fff',
                      border: 'none',
                      borderRadius: 10,
                      padding: '10px 18px',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    Ajouter
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {languages.map(s => (
                    <span
                      key={s}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        background: `${domain.primaryColor}15`,
                        color: domain.primaryColor,
                        padding: '4px 10px',
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {s}
                      <button
                        type="button"
                        onClick={() => removeLang(s)}
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
              </div>
            </div>

            {/* Section 5 — Liens */}
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>5. Liens</div>
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
