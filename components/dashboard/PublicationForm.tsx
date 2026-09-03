'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch } from '@/lib/secure-fetch'
import {
  SENIORITY_CODES,
  WORK_MODE_CODES,
  type PublicationDraft,
  type SeniorityCode,
  type WorkModeCode,
} from '@/types/publication'
import type { AnnonceType } from '@/types/annonce'
import { PUBLICATION_TTL_DAYS } from '@/lib/publications/expiry'
import MultiSelectChips from '@/components/ui/MultiSelectChips'
import WorkZoneSelector from '@/components/ui/WorkZoneSelector'
import type { WorkZone } from '@/lib/work-zones'
import { missingForPublish } from '@/lib/publications/publishable'

/**
 * Formulaire de création + édition d'une publication.
 *
 * Mode 'create' :
 *   - State vide ; SAVE → POST /api/publications → récupère l'id → reste sur
 *     /annonces/nouvelle avec un toast "brouillon enregistré" + bouton Publier
 *     activé. Optionnellement on peut migrer l'URL vers /annonces/[id]/modifier
 *     pour que F5 charge l'état (non implémenté V1 — l'utilisateur revient
 *     toujours via la liste).
 *   - PUBLISH → SAVE puis POST /api/publications/[id]/publish.
 *
 * Mode 'edit' :
 *   - Pré-rempli depuis prop `initial`.
 *   - SAVE → PATCH. PUBLISH → PATCH puis POST publish (id déjà connu).
 *
 * Sécurité :
 *   - Le client n'envoie JAMAIS `status` dans son body POST/PATCH.
 *   - La publication passe TOUJOURS par /publish (gate non contournable).
 *   - Si publish échoue après save : brouillon préservé, erreur affichée,
 *     l'utilisateur peut réessayer sans perdre sa saisie.
 */

// ── Types props + state ──────────────────────────────────────────────────────

type Props =
  | { mode: 'create' }
  | { mode: 'edit'; initial: PublicationDraft }

type FormState = {
  type: AnnonceType
  title: string
  description: string
  branch_id: string
  // D6 : « Autre » → SPECIALITY_OTHER (sentinel) parmi les spécialités choisies.
  speciality_ids: string[]
  speciality_other: string
  skills_required: string[]
  skillInput: string
  // Séniorités et spécialités : un ensemble VIDE veut dire « aucune contrainte
  // sur cet axe », jamais « ne correspond à personne ». Une annonce
  // incomplètement remplie doit chercher LARGE.
  seniorities: SeniorityCode[]
  work_mode: WorkModeCode | ''
  // Zones de travail : elles, sont exigées pour publier — sans zone, l'annonce
  // ne recouperait aucun expert.
  work_zone_ids: string[]
  location_note: string
  duration: string
  start_date: string
  budget_min: string
  budget_max: string
  confidential: boolean
}

type Branch = { id: string; slug: string; name: string }
type Speciality = { id: string; slug: string; branch_id: string; name: string }

// D6 : sentinel « Autre » (spécialité hors référentiel).
const SPECIALITY_OTHER = '__other__'

type TaxonomyResponse = {
  locale: string
  branches: Branch[]
  specialities: Speciality[]
  work_zones: WorkZone[]
}

type PublishOutcome =
  | { kind: 'published'; score: number }
  | { kind: 'pending_review'; score: number }

// ── Helpers ──────────────────────────────────────────────────────────────────

function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s)
  return Number.isFinite(d.getTime())
}

function parseBudget(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function initialFromDraft(d: PublicationDraft): FormState {
  return {
    type: d.type,
    title: d.title,
    description: d.description,
    branch_id: d.branch_id ?? '',
    // D6 : aucune spécialité du référentiel mais une précision libre → « Autre ».
    speciality_ids:
      (d.speciality_ids ?? []).length > 0
        ? d.speciality_ids
        : d.speciality_other
          ? [SPECIALITY_OTHER]
          : [],
    speciality_other: d.speciality_other ?? '',
    skills_required: d.skills_required ?? [],
    skillInput: '',
    seniorities: (d.seniorities ?? []).filter(
      (x): x is SeniorityCode => (SENIORITY_CODES as readonly string[]).includes(x),
    ),
    work_mode: (WORK_MODE_CODES as readonly string[]).includes(d.work_mode ?? '')
      ? ((d.work_mode as WorkModeCode) ?? '')
      : '',
    work_zone_ids: d.work_zone_ids ?? [],
    location_note: d.location_note ?? '',
    duration: d.duration ?? '',
    start_date: d.start_date ?? '',
    budget_min: d.budget_min != null ? String(d.budget_min) : '',
    budget_max: d.budget_max != null ? String(d.budget_max) : '',
    confidential: d.confidential ?? false,
  }
}

const EMPTY_STATE: FormState = {
  type: 'mission',
  title: '',
  description: '',
  branch_id: '',
  speciality_ids: [],
  speciality_other: '',
  skills_required: [],
  skillInput: '',
  seniorities: [],
  work_mode: '',
  work_zone_ids: [],
  location_note: '',
  duration: '',
  start_date: '',
  budget_min: '',
  budget_max: '',
  confidential: false,
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PublicationForm(props: Props) {
  const t = useTranslations('publications')
  const tStatus = useTranslations('publications.status')
  const locale = useLocale()
  const router = useRouter()
  const domain = useDomain()
  const secureFetch = useSecureFetch()

  const isEdit = props.mode === 'edit'
  const initialState = isEdit ? initialFromDraft(props.initial) : EMPTY_STATE
  const initialStatus = isEdit ? props.initial.status : 'draft'

  const [form, setForm] = useState<FormState>(initialState)
  const [pubId, setPubId] = useState<string | null>(isEdit ? props.initial.id : null)
  const [status, setStatus] = useState(initialStatus)

  const [taxonomy, setTaxonomy] = useState<TaxonomyResponse | null>(null)
  const workZones = taxonomy?.work_zones ?? []
  const [taxonomyError, setTaxonomyError] = useState(false)

  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [outcome, setOutcome] = useState<PublishOutcome | null>(null)

  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({})

  // ── Charger taxonomie ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    if (!domain.id || domain.id === 'default') {
      setTaxonomyError(true)
      return
    }
    const load = async () => {
      try {
        const res = await fetch(
          `/api/taxonomy?locale=${encodeURIComponent(locale)}&domain_id=${encodeURIComponent(domain.id)}`,
          { cache: 'no-store' },
        )
        if (!res.ok) throw new Error(`taxonomy ${res.status}`)
        const data = (await res.json()) as TaxonomyResponse
        if (cancelled) return
        setTaxonomy(data)
      } catch (err) {
        if (cancelled) return
        console.error('[PublicationForm] taxonomy load failed', err)
        setTaxonomyError(true)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [domain.id, locale])

  // Spécialités filtrées par branche choisie
  const filteredSpecialities = useMemo(() => {
    if (!taxonomy || !form.branch_id) return []
    return taxonomy.specialities.filter((s) => s.branch_id === form.branch_id)
  }, [taxonomy, form.branch_id])

  // Au changement de branche, seules les spécialités devenues hors branche
  // partent — on ne vide pas TOUTE la sélection, ce qui obligerait à tout
  // ressaisir pour une seule. « Autre » n'est rattachée à aucune branche : elle
  // survit toujours.
  useEffect(() => {
    if (!taxonomy) return
    setForm((p) => {
      if (p.speciality_ids.length === 0) return p
      const gardees = p.speciality_ids.filter(
        (id) =>
          id === SPECIALITY_OTHER ||
          (!!p.branch_id && filteredSpecialities.some((s) => s.id === id)),
      )
      if (gardees.length === p.speciality_ids.length) return p
      return { ...p, speciality_ids: gardees }
    })
  }, [form.branch_id, taxonomy, filteredSpecialities])

  const setField = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((p) => ({ ...p, [k]: v }))
    setFieldErrors((e) => ({ ...e, [k]: undefined }))
  }, [])

  // ── Validation client (mimétique du serveur, UX uniquement) ────────────
  const validate = (state: FormState): { ok: true } | { ok: false; errors: Partial<Record<keyof FormState, string>> } => {
    const errs: Partial<Record<keyof FormState, string>> = {}
    if (state.title.trim().length < 5 || state.title.trim().length > 200) {
      errs.title = t('errors.invalid_title')
    }
    if (state.description.trim().length < 20 || state.description.trim().length > 10_000) {
      errs.description = t('errors.invalid_description')
    }
    if (!state.branch_id) {
      errs.branch_id = t('form.required_marker')
    }
    // SOURCE UNIQUE : exactement le prédicat que /publish applique pour
    // refuser. Les contrôles ci-dessus sont plus fins (bornes de longueur) et
    // gardent la main quand ils ont déjà parlé ; celui-ci garantit qu'aucun
    // champ exigé par le serveur ne manque à l'appel du formulaire.
    //
    // Les ZONES en font partie : sans zone, l'annonce ne recouperait AUCUN
    // expert et serait publiée silencieusement invisible. Cet appel prévient
    // plus tôt, il ne remplace pas la barrière (règle 20).
    for (const champ of missingForPublish({
      title: state.title,
      description: state.description,
      branch_id: state.branch_id || null,
      work_zone_ids: state.work_zone_ids,
    })) {
      if (!errs[champ]) errs[champ] = t(`form.field_errors.${champ}`)
    }
    // SPÉCIALITÉS et SÉNIORITÉS ne sont PAS exigées : un ensemble vide y dit
    // « aucune contrainte sur cet axe ». Seule « Autre » impose sa précision
    // libre, sans quoi elle ne désignerait rien (D6).
    if (state.speciality_ids.includes(SPECIALITY_OTHER) && !state.speciality_other.trim()) {
      errs.speciality_other = t('form.required_marker')
    }
    const bmin = parseBudget(state.budget_min)
    const bmax = parseBudget(state.budget_max)
    if (state.budget_min !== '' && bmin === null) errs.budget_min = t('errors.invalid_budget')
    if (state.budget_max !== '' && bmax === null) errs.budget_max = t('errors.invalid_budget')
    if (bmin !== null && bmax !== null && bmin > bmax) {
      errs.budget_max = t('errors.budget_inverted')
    }
    if (state.start_date !== '' && !isValidIsoDate(state.start_date)) {
      errs.start_date = t('errors.invalid_json')
    }
    if (Object.keys(errs).length > 0) return { ok: false, errors: errs }
    return { ok: true }
  }

  // ── Construction du body POST/PATCH ────────────────────────────────────
  const buildBody = (state: FormState, forCreate: boolean): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      title: state.title.trim(),
      description: state.description.trim(),
      branch_id: state.branch_id || null,
      speciality_ids: state.speciality_ids.filter((id) => id !== SPECIALITY_OTHER),
      // D6 : précision libre transmise quand « Autre », sinon effacée.
      speciality_other: state.speciality_ids.includes(SPECIALITY_OTHER)
        ? state.speciality_other.trim()
        : null,
      skills_required: state.skills_required,
      seniorities: state.seniorities,
      work_mode: state.work_mode || null,
      // Zones transmises en CODES stables, jamais en uuid : le serveur résout,
      // et REFUSE un code inconnu plutôt que de tronquer en silence.
      work_zone_codes: state.work_zone_ids
        .map((id) => workZones.find((z) => z.id === id)?.code)
        .filter((c): c is string => !!c),
      location_note: state.location_note.trim() || null,
      duration: state.duration.trim() || null,
      start_date: state.start_date || null,
      budget_min: parseBudget(state.budget_min),
      budget_max: parseBudget(state.budget_max),
      confidential: state.confidential,
    }
    if (forCreate) {
      body.type = state.type
    }
    // Jamais de `status` envoyé.
    return body
  }

  // ── Codes d'erreur API → libellé ───────────────────────────────────────
  const apiErrorMessage = (code: string | undefined): string => {
    const known: Record<string, string> = {
      invalid_json: t('errors.invalid_json'),
      org_required: t('errors.org_required'),
      not_found: t('errors.not_found'),
      forbidden: t('errors.forbidden'),
      wrong_status: t('errors.wrong_status'),
      bad_work_zone: t('form.field_errors.work_zone_ids'),
      invalid_type: t('errors.invalid_type'),
      invalid_title: t('errors.invalid_title'),
      invalid_description: t('errors.invalid_description'),
      invalid_budget: t('errors.invalid_budget'),
      budget_inverted: t('errors.budget_inverted'),
      verification_failed: t('errors.verification_failed'),
      db_error: t('errors.db_error'),
    }
    return (code && known[code]) ?? t('errors.generic')
  }

  /**
   * Refus NOMMÉ de /publish. Le serveur rend la LISTE des champs qui bloquent ;
   * on la rend lisible plutôt que d'afficher « une erreur est survenue ».
   *
   * Sans cela, l'organisation lisait `db_error` — la contrainte de base violée —
   * pour une annonce à laquelle il manquait simplement une zone.
   */
  const LIBELLE_CHAMP: Record<string, string> = {
    title: t('form.field_title'),
    description: t('form.field_description'),
    branch_id: t('form.field_branch'),
    work_zone_ids: t('form.field_work_zones'),
  }
  const messageChampsManquants = (missing: unknown): string | null => {
    if (!Array.isArray(missing) || missing.length === 0) return null
    const noms = missing.map((m) => LIBELLE_CHAMP[String(m)]).filter(Boolean)
    if (noms.length === 0) return null
    return t('errors.missing_fields', { fields: noms.join(', ') })
  }

  // ── Save (POST si create / PATCH si edit) ──────────────────────────────
  const saveDraft = async (state: FormState): Promise<{ ok: true; id: string } | { ok: false }> => {
    const isCreating = pubId == null
    const url = isCreating ? '/api/publications' : `/api/publications/${pubId}`
    const method = isCreating ? 'POST' : 'PATCH'
    const body = buildBody(state, isCreating)
    const res = await secureFetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = (await res.json().catch(() => ({} as { code?: string; id?: string; status?: string })))
    if (!res.ok) {
      setErrorMsg(apiErrorMessage(payload.code))
      return { ok: false }
    }
    const newId = (payload.id as string | undefined) ?? pubId
    if (!newId) {
      setErrorMsg(t('errors.generic'))
      return { ok: false }
    }
    if (isCreating) setPubId(newId)
    if (payload.status) setStatus(payload.status as typeof status)
    return { ok: true, id: newId }
  }

  // ── Handler boutons ────────────────────────────────────────────────────
  const handleSaveDraft = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setSuccessMsg(null)
    const v = validate(form)
    if (!v.ok) {
      setFieldErrors(v.errors)
      setErrorMsg(t('errors.generic'))
      return
    }
    setSaving(true)
    const res = await saveDraft(form)
    setSaving(false)
    if (res.ok) {
      setSuccessMsg(isEdit ? t('form.success_draft_updated') : t('form.success_draft_created'))
    }
  }

  const openConfirmPublish = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setSuccessMsg(null)
    const v = validate(form)
    if (!v.ok) {
      setFieldErrors(v.errors)
      setErrorMsg(t('errors.generic'))
      return
    }
    setConfirmOpen(true)
  }

  const handlePublish = async () => {
    setConfirmOpen(false)
    setErrorMsg(null)
    setSuccessMsg(null)
    setPublishing(true)
    // 1. Save first
    const saveRes = await saveDraft(form)
    if (!saveRes.ok) {
      setPublishing(false)
      return
    }
    // 2. Then publish
    try {
      const res = await secureFetch(`/api/publications/${saveRes.id}/publish`, {
        method: 'POST',
        headers: { 'x-locale': locale },
      })
      const payload = (await res.json().catch(() => ({} as { code?: string; status?: string; score?: number; missing?: unknown })))
      if (!res.ok) {
        // Un refus de publiabilité NOMME ses champs ; les autres codes gardent
        // leur message. Dire « une erreur est survenue » pour une zone
        // manquante laisse l'organisation sans rien à corriger.
        setErrorMsg(messageChampsManquants(payload.missing) ?? apiErrorMessage(payload.code))
        setPublishing(false)
        return
      }
      const finalStatus = payload.status === 'published' ? 'published' : 'pending_review'
      const score = typeof payload.score === 'number' ? payload.score : 0
      setStatus(finalStatus)
      setOutcome({ kind: finalStatus, score })
    } catch (err) {
      console.error('[PublicationForm] publish threw', err)
      setErrorMsg(t('errors.verification_failed'))
    } finally {
      setPublishing(false)
    }
  }

  // ── Skill chips ─────────────────────────────────────────────────────────
  const addSkill = () => {
    const v = form.skillInput.trim()
    if (!v) return
    if (form.skills_required.includes(v)) {
      setForm((p) => ({ ...p, skillInput: '' }))
      return
    }
    if (form.skills_required.length >= 50) return
    setForm((p) => ({ ...p, skills_required: [...p.skills_required, v], skillInput: '' }))
  }
  const removeSkill = (skill: string) => {
    setForm((p) => ({ ...p, skills_required: p.skills_required.filter((s) => s !== skill) }))
  }

  // ── Styles ──────────────────────────────────────────────────────────────
  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#334155',
    marginBottom: 6,
  }
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '11px 14px',
    fontSize: 14,
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    outline: 'none',
    fontFamily: 'inherit',
    background: '#fff',
    color: '#0f172a',
    boxSizing: 'border-box',
  }
  const errorInputBorder = '1px solid #dc2626'
  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '.08em',
    color: '#64748b',
    marginBottom: 14,
  }
  const sectionStyle: React.CSSProperties = {
    background: '#fff',
    border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
    borderRadius: 14,
    padding: '22px 24px',
    marginBottom: 18,
  }
  const fieldErrorStyle: React.CSSProperties = {
    fontSize: 12,
    color: '#dc2626',
    marginTop: 4,
  }
  const helpStyle: React.CSSProperties = {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4,
  }
  function radioPill(active: boolean): React.CSSProperties {
    return {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '10px 16px',
      border: `1.5px solid ${active ? domain.primaryColor : '#cbd5e1'}`,
      borderRadius: 10,
      background: active ? `${domain.primaryColor}10` : '#fff',
      cursor: 'pointer',
      fontSize: 13,
      fontWeight: 600,
      color: active ? domain.primaryColor : '#475569',
      userSelect: 'none',
    }
  }

  const formId = 'sk-publication-form'
  const canPublish = status === 'draft' && !publishing
  const headerTitle = isEdit ? t('form.title_edit') : t('form.title_create')

  // ── Outcome (écran résultat post-publish) ──────────────────────────────
  if (outcome) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px', textAlign: 'center' }}>
        <div
          style={{
            background: outcome.kind === 'published' ? '#DCFCE7' : '#FEF9C3',
            border: `1px solid ${outcome.kind === 'published' ? '#86EFAC' : '#FDE047'}`,
            borderRadius: 16,
            padding: '36px 28px',
            marginBottom: 24,
          }}
        >
          <div
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: outcome.kind === 'published' ? '#166534' : '#854D0E',
              marginBottom: 8,
            }}
          >
            {outcome.kind === 'published' ? t('gate.published_title') : t('gate.pending_title')}
          </div>
          <div style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, marginBottom: 16 }}>
            {outcome.kind === 'published' ? t('gate.published_body') : t('gate.pending_body')}
          </div>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            {t('gate.score_label', { score: Math.round(outcome.score) })}
          </div>
        </div>
        <button
          type="button"
          onClick={() => router.push('/dashboard/entreprise')}
          style={{
            padding: '12px 22px',
            background: domain.primaryColor,
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {t('form.button_back_to_list')}
        </button>
      </div>
    )
  }

  // ── Form principal ─────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 880, padding: '24px 26px 40px', fontFamily: 'inherit' }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: '#0f172a', marginBottom: 6, letterSpacing: '-0.3px' }}>
        {headerTitle}
      </h1>
      <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24, lineHeight: 1.55 }}>
        {t('form.subtitle')}
      </p>

      {taxonomyError && (
        <div role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 18 }}>
          {t('errors.generic')}
        </div>
      )}

      {errorMsg && (
        <div role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 18 }}>
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div role="status" style={{ background: '#DCFCE7', border: '1px solid #86EFAC', color: '#166534', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 18 }}>
          {successMsg}
        </div>
      )}

      <form id={formId} onSubmit={handleSaveDraft}>
        {/* Section essentiels */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>{t('form.section_essentials')}</div>

          {/* Type — radio pills, immuable en édition */}
          <label style={labelStyle}>{t('form.field_type')} *</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
            {(['mission', 'offre'] as const).map((tp) => {
              const active = form.type === tp
              const disabled = isEdit  // le type est immuable côté API
              return (
                <label
                  key={tp}
                  style={{
                    ...radioPill(active),
                    opacity: disabled ? 0.5 : 1,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="type"
                    value={tp}
                    checked={active}
                    onChange={() => !disabled && setField('type', tp)}
                    disabled={disabled}
                    style={{ display: 'none' }}
                  />
                  {t(`type.${tp}`)}
                </label>
              )
            })}
          </div>

          {/* Titre */}
          <label htmlFor="sk-title" style={labelStyle}>{t('form.field_title')} *</label>
          <input
            id="sk-title"
            type="text"
            value={form.title}
            onChange={(e) => setField('title', e.target.value)}
            placeholder={t('form.field_title_placeholder')}
            maxLength={200}
            style={{ ...inputStyle, ...(fieldErrors.title ? { border: errorInputBorder } : null), marginBottom: fieldErrors.title ? 4 : 18 }}
          />
          {fieldErrors.title && <div style={{ ...fieldErrorStyle, marginBottom: 14 }}>{fieldErrors.title}</div>}

          {/* Description */}
          <label htmlFor="sk-desc" style={labelStyle}>{t('form.field_description')} *</label>
          <textarea
            id="sk-desc"
            value={form.description}
            onChange={(e) => setField('description', e.target.value)}
            placeholder={t('form.field_description_placeholder')}
            maxLength={10_000}
            rows={8}
            style={{
              ...inputStyle,
              ...(fieldErrors.description ? { border: errorInputBorder } : null),
              resize: 'vertical',
              lineHeight: 1.55,
              marginBottom: fieldErrors.description ? 4 : 4,
            }}
          />
          {fieldErrors.description ? (
            <div style={{ ...fieldErrorStyle, marginBottom: 4 }}>{fieldErrors.description}</div>
          ) : null}
          <div style={helpStyle}>{t('form.field_description_help')}</div>
        </div>

        {/* Section contexte (branche, spec, séniorité) */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>{t('form.section_context')}</div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 18 }}>
            <div>
              <label htmlFor="sk-branch" style={labelStyle}>{t('form.field_branch')} *</label>
              <select
                id="sk-branch"
                value={form.branch_id}
                onChange={(e) => setField('branch_id', e.target.value)}
                style={{ ...inputStyle, ...(fieldErrors.branch_id ? { border: errorInputBorder } : null) }}
                disabled={!taxonomy}
              >
                <option value="">{t('form.field_branch_placeholder')}</option>
                {taxonomy?.branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              {fieldErrors.branch_id && <div style={fieldErrorStyle}>{fieldErrors.branch_id}</div>}
            </div>
            <div>
              {/* Plus d'astérisque : une annonce sans spécialité cherche LARGE,
                  elle ne cherche pas « rien ». */}
              <label style={labelStyle}>{t('form.field_speciality')}</label>
              <MultiSelectChips
                ariaLabel={t('form.field_speciality')}
                options={[
                  ...filteredSpecialities.map((sp) => ({ value: sp.id, label: sp.name })),
                  // D6 : spécialité hors référentiel, seulement quand une
                  // branche est choisie.
                  ...(form.branch_id
                    ? [{ value: SPECIALITY_OTHER, label: t('form.field_speciality_other_option') }]
                    : []),
                ]}
                selected={form.speciality_ids}
                onChange={(next) => {
                  setField('speciality_ids', next)
                  if (!next.includes(SPECIALITY_OTHER)) setField('speciality_other', '')
                }}
                emptyLabel={
                  !form.branch_id
                    ? t('form.field_speciality_select_branch_first')
                    : filteredSpecialities.length === 0
                      ? t('form.field_speciality_none_in_branch')
                      : t('form.field_speciality_placeholder')
                }
              />

              {form.speciality_ids.includes(SPECIALITY_OTHER) && (
                <div style={{ marginTop: 10 }}>
                  <label htmlFor="sk-spec-other" style={labelStyle}>{t('form.field_speciality_other_label')} *</label>
                  <input
                    id="sk-spec-other"
                    type="text"
                    value={form.speciality_other}
                    onChange={(e) => setField('speciality_other', e.target.value)}
                    maxLength={100}
                    placeholder={t('form.field_speciality_other_placeholder')}
                    style={{ ...inputStyle, ...(fieldErrors.speciality_other ? { border: errorInputBorder } : null) }}
                  />
                  {fieldErrors.speciality_other && <div style={fieldErrorStyle}>{fieldErrors.speciality_other}</div>}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 18 }}>
            <div>
              <label style={labelStyle}>{t('form.field_seniority')}</label>
              <MultiSelectChips
                ariaLabel={t('form.field_seniority')}
                options={SENIORITY_CODES.map((v) => ({
                  value: v,
                  label: t(`form.seniority_options.${v}`),
                }))}
                selected={form.seniorities}
                onChange={(next) => setField('seniorities', next as SeniorityCode[])}
                emptyLabel={t('form.option_not_specified')}
              />
            </div>
            <div>
              <label htmlFor="sk-workmode" style={labelStyle}>{t('form.field_work_mode')}</label>
              <select
                id="sk-workmode"
                value={form.work_mode}
                onChange={(e) => setField('work_mode', e.target.value as WorkModeCode | '')}
                style={inputStyle}
              >
                <option value="">{t('form.option_not_specified')}</option>
                {WORK_MODE_CODES.map((m) => (
                  <option key={m} value={m}>{t(`form.work_mode_options.${m}`)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* ZONES DE TRAVAIL — placées avec branche et spécialités, parce que
              c'est un critère de recherche comme elles, et non dans la section
              logistique où « Localisation » les ferait passer pour une adresse. */}
          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle}>{t('form.field_work_zones')} *</label>
            <div style={helpStyle}>{t('form.field_work_zones_help')}</div>
            <WorkZoneSelector
              zones={workZones}
              selected={form.work_zone_ids}
              onChange={(next) => setField('work_zone_ids', next)}
              invalid={!!fieldErrors.work_zone_ids}
            />
            {fieldErrors.work_zone_ids && <div style={fieldErrorStyle}>{fieldErrors.work_zone_ids}</div>}
          </div>

          {/* Skills */}
          <label style={labelStyle}>{t('form.field_skills')}</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              type="text"
              value={form.skillInput}
              onChange={(e) => setField('skillInput', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addSkill() }
              }}
              placeholder={t('form.field_skills_placeholder')}
              maxLength={100}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              type="button"
              onClick={addSkill}
              style={{
                padding: '0 18px',
                background: domain.primaryColor,
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {t('form.field_skills_add')}
            </button>
          </div>
          {form.skills_required.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
              {form.skills_required.map((skill) => (
                <span
                  key={skill}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    background: '#f1f5f9',
                    color: '#334155',
                    padding: '4px 10px',
                    borderRadius: 12,
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                >
                  {skill}
                  <button
                    type="button"
                    onClick={() => removeSkill(skill)}
                    aria-label={t('form.field_skills_remove_aria', { skill })}
                    style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}
                  >×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Section logistique */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>{t('form.section_logistics')}</div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 18 }}>
            <div>
              {/* Le champ libre reste, mais il DIT désormais qu'il ne sert pas à
                  la mise en relation. Sans cela, une organisation croyait
                  filtrer avec un champ décoratif. */}
              <label htmlFor="sk-loc" style={labelStyle}>{t('form.field_location_note')}</label>
              <input
                id="sk-loc"
                type="text"
                value={form.location_note}
                onChange={(e) => setField('location_note', e.target.value)}
                placeholder={t('form.field_location_note_placeholder')}
                style={inputStyle}
              />
              <div style={helpStyle}>{t('form.field_location_note_help')}</div>
            </div>
            <div>
              <label htmlFor="sk-dur" style={labelStyle}>{t('form.field_duration')}</label>
              <input id="sk-dur" type="text" value={form.duration} onChange={(e) => setField('duration', e.target.value)} placeholder={t('form.field_duration_placeholder')} style={inputStyle} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 0 }}>
            <div>
              <label htmlFor="sk-start" style={labelStyle}>{t('form.field_start_date')}</label>
              <input
                id="sk-start"
                type="date"
                value={form.start_date}
                onChange={(e) => setField('start_date', e.target.value)}
                style={{ ...inputStyle, ...(fieldErrors.start_date ? { border: errorInputBorder } : null) }}
              />
              {fieldErrors.start_date && <div style={fieldErrorStyle}>{fieldErrors.start_date}</div>}
            </div>
            <div>
              <label htmlFor="sk-bmin" style={labelStyle}>{t('form.field_budget_min')}</label>
              <input
                id="sk-bmin"
                type="number"
                inputMode="numeric"
                min={0}
                value={form.budget_min}
                onChange={(e) => setField('budget_min', e.target.value)}
                style={{ ...inputStyle, ...(fieldErrors.budget_min ? { border: errorInputBorder } : null) }}
              />
              {fieldErrors.budget_min && <div style={fieldErrorStyle}>{fieldErrors.budget_min}</div>}
            </div>
            <div>
              <label htmlFor="sk-bmax" style={labelStyle}>{t('form.field_budget_max')}</label>
              <input
                id="sk-bmax"
                type="number"
                inputMode="numeric"
                min={0}
                value={form.budget_max}
                onChange={(e) => setField('budget_max', e.target.value)}
                style={{ ...inputStyle, ...(fieldErrors.budget_max ? { border: errorInputBorder } : null) }}
              />
              {fieldErrors.budget_max && <div style={fieldErrorStyle}>{fieldErrors.budget_max}</div>}
            </div>
          </div>
          <div style={{ ...helpStyle, marginTop: 6 }}>
            {t(`form.field_budget_help_${form.type}`)}
          </div>
        </div>

        {/* Section avancé */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>{t('form.section_advanced')}</div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer', marginBottom: 14 }}>
            <input
              type="checkbox"
              checked={form.confidential}
              onChange={(e) => setField('confidential', e.target.checked)}
              style={{ marginTop: 3, accentColor: domain.primaryColor }}
            />
            <span style={{ fontSize: 13, color: '#334155', lineHeight: 1.55 }}>
              <strong>{t('form.field_confidential')}</strong>
              <span style={{ display: 'block', color: '#64748b', marginTop: 4 }}>
                {t('form.field_confidential_help')}
              </span>
            </span>
          </label>
          <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
            {t('form.completion_hint')}
          </div>
        </div>

        {/* Boutons */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 28 }}>
          <button
            type="submit"
            disabled={saving || publishing}
            style={{
              padding: '12px 22px',
              background: '#fff',
              color: domain.primaryColor,
              border: `1.5px solid ${domain.primaryColor}`,
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: saving || publishing ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              opacity: saving || publishing ? 0.5 : 1,
            }}
          >
            {saving ? t('form.button_save_draft_loading') : t('form.button_save_draft')}
          </button>
          <button
            type="button"
            onClick={openConfirmPublish}
            disabled={!canPublish || saving}
            title={!canPublish ? t('form.publish_disabled_reason', { status: tStatus(status) }) : ''}
            style={{
              padding: '12px 22px',
              background: !canPublish || saving ? '#94a3b8' : domain.primaryColor,
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: !canPublish || saving ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {publishing ? t('form.button_publish_loading') : t('form.button_publish')}
          </button>
        </div>
      </form>

      {/* Modale de confirmation publish */}
      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sk-confirm-title"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15,23,42,.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px 16px', zIndex: 9999,
          }}
        >
          <div style={{ background: '#fff', borderRadius: 16, padding: '28px 26px', width: '100%', maxWidth: 520 }}>
            <h2 id="sk-confirm-title" style={{ fontSize: 19, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
              {t('form.confirm_publish_title')}
            </h2>
            <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, marginBottom: 14 }}>
              {t('form.confirm_publish_body_p1')}
            </p>
            <ul style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, paddingLeft: 18, marginBottom: 14 }}>
              <li>{t('form.confirm_publish_rule_clear')}</li>
              <li>{t('form.confirm_publish_rule_no_contact')}</li>
              <li>{t('form.confirm_publish_rule_no_discrimination')}</li>
              <li>{t('form.confirm_publish_rule_legal')}</li>
            </ul>
            <p style={{ fontSize: 13, color: '#854D0E', background: '#FEF9C3', border: '1px solid #FDE047', borderRadius: 8, padding: '10px 12px', lineHeight: 1.55, marginBottom: 12 }}>
              {t('form.confirm_publish_warning')}
            </p>
            {/* Lot A — avertissement d'expiration : date calculée (now + 30j) +
                mention explicite de la republication. */}
            <p style={{ fontSize: 13, color: '#334155', lineHeight: 1.55, marginBottom: 18 }}>
              {t('form.confirm_publish_expiry', {
                date: new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(
                  new Date(Date.now() + PUBLICATION_TTL_DAYS * 24 * 60 * 60 * 1000),
                ),
              })}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                style={{
                  padding: '10px 18px',
                  background: 'transparent',
                  color: '#64748b',
                  border: '1px solid #cbd5e1',
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {t('form.confirm_publish_no')}
              </button>
              <button
                type="button"
                onClick={handlePublish}
                style={{
                  padding: '10px 18px',
                  background: domain.primaryColor,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {t('form.confirm_publish_yes')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
