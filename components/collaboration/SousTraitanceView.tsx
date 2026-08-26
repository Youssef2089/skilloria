'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * SousTraitanceView — FORMULAIRE de publication d'un BESOIN de sous-traitance
 * entre experts (page /dashboard/{role}/sous-traitance/nouveau).
 *
 * Rendu DANS la coquille dashboard (sidebar + header via le layout). Au montage :
 * ensure-org (création lazy transparente de l'organisation personnelle). Le
 * formulaire publie un besoin type='sous_traitance' via la MÊME chaîne que les
 * entreprises (POST /api/publications → POST /publish), donc les gates commerce
 * de l'offre de collaboration s'appliquent. Quota atteint → mur
 * « Bientôt disponible ».
 *
 * AUCUN CHIFFRE COMMERCIAL EN DUR : le récapitulatif de l'offre (« N
 * publications par mois, N profils dévoilés ») est COMPOSÉ à partir des limites
 * lues au catalogue via GET /api/me/collaboration/quota. Ces valeurs vivaient
 * auparavant en toutes lettres dans messages/{fr,en,es,de}.json — modifier
 * l'offre en back-office ne changeait pas la phrase. Quand les limites ne sont
 * pas lisibles, on n'affiche AUCUN nombre plutôt qu'un nombre faux.
 *
 * `basePath` = base du dashboard courant ('/dashboard/freelance' | '/dashboard/
 * cdi'), pour renvoyer vers la LISTE des besoins après publication.
 */

type Phase = 'loading' | 'ready' | 'org_error' | 'published' | 'wall' | 'locked'

/** Limites de l'offre effective (null = illimité). */
type QuotaLimits = {
  publicationsPerMonth: number | null
  revealedCandidatesPerPublication: number | null
}

export default function SousTraitanceView({ basePath }: { basePath: string }) {
  const t = useTranslations('collaboration')
  const domain = useDomain()
  const secureFetch = useSecureFetch()

  const [phase, setPhase] = useState<Phase>('loading')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [skills, setSkills] = useState('')
  const [budgetMin, setBudgetMin] = useState('')
  const [budgetMax, setBudgetMax] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [limits, setLimits] = useState<QuotaLimits | null>(null)

  // ── Création lazy de l'org personnelle au chargement ─────────────────────
  const ensureOrg = useCallback(async () => {
    setPhase('loading')
    setError(null)
    try {
      const res = await secureFetch('/api/me/collaboration/ensure-org', { method: 'POST' })
      if (!res.ok) {
        // C2 : profil non vérifié → état verrouillé explicite.
        const p = (await res.json().catch(() => ({}))) as { code?: string }
        setPhase(p.code === 'profile_not_verified' ? 'locked' : 'org_error')
        return
      }
      // Limites de l'offre — best-effort : leur absence ne bloque pas la
      // publication, elle retire seulement le récapitulatif chiffré.
      try {
        const qRes = await secureFetch('/api/me/collaboration/quota', { method: 'GET' })
        if (qRes.ok) {
          const q = (await qRes.json().catch(() => null)) as { limits?: QuotaLimits } | null
          setLimits(q?.limits ?? null)
        } else {
          setLimits(null)
        }
      } catch {
        setLimits(null)
      }
      setPhase('ready')
    } catch {
      setPhase('org_error')
    }
  }, [secureFetch])

  useEffect(() => {
    void ensureOrg()
  }, [ensureOrg])

  const titleOk = title.trim().length >= 5 && title.trim().length <= 200
  const descOk = description.trim().length >= 20 && description.trim().length <= 10_000
  const canSubmit = useMemo(
    () => !submitting && phase === 'ready' && titleOk && descOk,
    [submitting, phase, titleOk, descOk],
  )

  /**
   * Récapitulatif de l'offre, COMPOSÉ depuis le catalogue. `null` si les
   * limites n'ont pas pu être lues : on préfère ne rien annoncer plutôt
   * qu'annoncer un chiffre qui ne serait pas celui de l'offre.
   */
  const offerSummary = useMemo(() => {
    if (!limits) return null
    const publications =
      limits.publicationsPerMonth == null
        ? t('offer_publications_unlimited')
        : t('offer_publications', { count: limits.publicationsPerMonth })
    const revealed =
      limits.revealedCandidatesPerPublication == null
        ? t('offer_revealed_unlimited')
        : t('offer_revealed', { count: limits.revealedCandidatesPerPublication })
    return `${publications} ${revealed}`
  }, [limits, t])

  async function publish() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      // 1. Brouillon (type sous_traitance ; domaine implicite = celui de l'expert).
      const draftRes = await secureFetch('/api/publications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'sous_traitance',
          title: title.trim(),
          description: description.trim(),
          skills_required: skills
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          budget_min: budgetMin.trim() === '' ? null : Number(budgetMin.trim()),
          budget_max: budgetMax.trim() === '' ? null : Number(budgetMax.trim()),
        }),
      })
      const draft = (await draftRes.json().catch(() => ({}))) as { id?: string; code?: string }
      if (!draftRes.ok || !draft.id) {
        setError(t('errors.create_failed'))
        return
      }

      // 2. Publication (gates commerce du package collaboration appliqués ici).
      const pubRes = await secureFetch(`/api/publications/${draft.id}/publish`, { method: 'POST' })
      const pub = (await pubRes.json().catch(() => ({}))) as { code?: string }
      if (!pubRes.ok) {
        // Mur payant (quota 1/mois atteint) → « Bientôt disponible ».
        if (pub.code === 'quota_publications_reached' || pub.code === 'active_publications_limit_reached') {
          setPhase('wall')
          return
        }
        setError(t('errors.publish_failed'))
        return
      }
      setPhase('published')
    } catch {
      setError(t('errors.publish_failed'))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Styles (pattern dashboard, pleine largeur gauche) ────────────────────
  const card: React.CSSProperties = {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 16,
    padding: 24,
    maxWidth: 640,
  }
  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#334155',
    marginBottom: 6,
  }
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    fontSize: 14,
    border: '1px solid #cbd5e1',
    borderRadius: 10,
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    color: '#0f172a',
    background: '#fff',
  }

  const header = (
    <div style={{ marginBottom: 20 }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: '#0f172a', margin: '0 0 6px', letterSpacing: '-0.4px' }}>
        {t('page_title')}
      </h1>
      <p style={{ fontSize: 14, color: '#64748b', margin: 0, maxWidth: 640 }}>{t('page_subtitle')}</p>
    </div>
  )

  return (
    <div style={{ padding: '24px 24px 56px', width: '100%' }}>
      {header}

      {phase === 'loading' && (
        <div style={{ ...card, color: '#64748b', fontSize: 14 }}>{t('loading')}</div>
      )}

      {phase === 'org_error' && (
        <div style={{ ...card, borderColor: '#fecaca', background: '#fef2f2' }}>
          <p style={{ margin: '0 0 14px', fontSize: 14, color: '#991b1b' }}>{t('errors.org_unavailable')}</p>
          <button type="button" onClick={() => void ensureOrg()} style={btn(domain.primaryColor)}>
            {t('retry')}
          </button>
        </div>
      )}

      {phase === 'locked' && (
        <div style={{ ...card, borderColor: '#fde68a', background: '#fffbeb' }}>
          <div style={{ fontSize: 30, marginBottom: 8 }} aria-hidden>🔒</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#92400e' }}>{t('list.locked_title')}</h2>
          <p style={{ margin: 0, fontSize: 14, color: '#a16207', lineHeight: 1.6 }}>{t('list.locked_body')}</p>
        </div>
      )}

      {phase === 'published' && (
        <div style={{ ...card, borderColor: '#bbf7d0', background: '#f0fdf4' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }} aria-hidden>✅</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#166534' }}>{t('published_title')}</h2>
          <p style={{ margin: '0 0 16px', fontSize: 14, color: '#15803d', lineHeight: 1.55 }}>{t('published_body')}</p>
          <Link
            href={`${basePath}/sous-traitance`}
            style={{ display: 'inline-flex', padding: '10px 16px', background: domain.primaryColor, color: '#fff', borderRadius: 10, fontSize: 13.5, fontWeight: 700, textDecoration: 'none' }}
          >
            {t('published_cta')}
          </Link>
        </div>
      )}

      {phase === 'wall' && (
        <div style={{ ...card, borderColor: '#fde68a', background: '#fffbeb' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }} aria-hidden>🔒</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#92400e' }}>{t('wall_title')}</h2>
          <p style={{ margin: '0 0 6px', fontSize: 14, color: '#92400e', lineHeight: 1.55 }}>{t('wall_body')}</p>
          <p style={{ margin: 0, fontSize: 13, color: '#a16207' }}>{t('wall_contact')}</p>
        </div>
      )}

      {phase === 'ready' && (
        <div style={card}>
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="st_title" style={labelStyle}>{t('form.title_label')} *</label>
            <input id="st_title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={t('form.title_placeholder')} style={inputStyle} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="st_desc" style={labelStyle}>{t('form.description_label')} *</label>
            <textarea id="st_desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={10_000} rows={6} placeholder={t('form.description_placeholder')} style={{ ...inputStyle, resize: 'vertical' }} />
            <p style={{ fontSize: 12, color: '#94a3b8', margin: '6px 0 0' }}>{t('form.description_hint')}</p>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="st_skills" style={labelStyle}>{t('form.skills_label')}</label>
            <input id="st_skills" value={skills} onChange={(e) => setSkills(e.target.value)} placeholder={t('form.skills_placeholder')} style={inputStyle} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 20 }}>
            <div>
              <label htmlFor="st_bmin" style={labelStyle}>{t('form.budget_min_label')}</label>
              <input id="st_bmin" type="number" min={0} inputMode="numeric" value={budgetMin} onChange={(e) => setBudgetMin(e.target.value)} placeholder={t('form.budget_placeholder')} style={inputStyle} />
            </div>
            <div>
              <label htmlFor="st_bmax" style={labelStyle}>{t('form.budget_max_label')}</label>
              <input id="st_bmax" type="number" min={0} inputMode="numeric" value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} placeholder={t('form.budget_placeholder')} style={inputStyle} />
            </div>
          </div>

          {error && (
            <div role="alert" style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 13, borderRadius: 10, marginBottom: 14 }}>
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={() => void publish()}
            disabled={!canSubmit}
            style={{ ...btn(domain.primaryColor), opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
          >
            {submitting ? t('form.submitting') : t('form.submit')}
          </button>
          {/* Récapitulatif chiffré de l'offre, juste avant l'action. Alimenté
              par le catalogue — jamais écrit en dur dans les traductions. */}
          {offerSummary && (
            <p style={{ fontSize: 12, color: '#94a3b8', margin: '12px 0 0' }}>{offerSummary}</p>
          )}
        </div>
      )}
    </div>
  )
}

function btn(color: string): React.CSSProperties {
  return {
    padding: '11px 18px',
    background: color,
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 700,
    fontFamily: 'inherit',
    cursor: 'pointer',
  }
}
