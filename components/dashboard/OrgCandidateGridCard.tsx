'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { Link } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch } from '@/lib/secure-fetch'
import { useMarkCandidatureViewed } from '@/lib/candidature-view-client'
import type { CandidatureData } from '@/components/dashboard/CandidatureCard'

/**
 * OrgCandidateGridCard — carte photo-forward style Malt (Lot grille).
 *
 * Source de vérité unique pour les 2 surfaces org candidatures :
 *   - /dashboard/entreprise/candidatures            (vue globale)
 *   - /dashboard/entreprise/annonces/[id]/candidatures (per-publication)
 *
 * États visuels :
 *   - VERROUILLÉE (status pré-unlock) : photo masquée (cadenas placeholder),
 *     teaser score / titre / TJM-salaire / lieu / chips compétences. Bouton
 *     "Débloquer le profil" qui POST /api/candidatures/[id]/unlock.
 *   - DÉBLOUÉE (status='unlocked'|'selected') : photo expert + nom complet
 *     (révélés serveur via DisclosurePolicy). Actions Message / Retenir /
 *     Refuser selon état. Pill "Nouveau" si !viewed_by_me + bouton
 *     "Marquer comme vue".
 *   - FERMÉE (rejected/withdrawn/archived) : carte fanée, pas d'actions.
 *
 * Surimpression photo (en haut) :
 *   - pastille DISPONIBILITÉ (haut-gauche) : pré ou post-unlock, lisible
 *     via preview.availability_status (freelance) ou preview.cdi_status (CDI).
 *   - badge SCORE (haut-droite) color-codé : vert ≥8, ambre 5-7, gris <5,
 *     masqué si null (pas de score IA disponible).
 *
 * useDomain → accent multi-tenant. Mobile-first via grid responsive
 * géré par le parent (cf. /dashboard/entreprise/candidatures/page.tsx).
 *
 * Sécurité : la révélation photo+nom est gérée CÔTÉ SERVEUR par
 * lib/expert-disclosure.ts. Aucun contournement client possible.
 */

type Props = {
  candidature: CandidatureData
  publicationType: 'mission' | 'offre' | string
  /** Compétences requises par la publication (pour surligner les matchées). */
  pubSkillsRequired: string[]
  /** Re-fetch parent après mutation (unlock/reject/select/view). */
  onMutated: () => void
}

function scoreColor(score: number | null): { bg: string; fg: string; label: 'high' | 'mid' | 'low' } | null {
  if (score == null || Number.isNaN(score)) return null
  if (score >= 8) return { bg: '#DCFCE7', fg: '#166534', label: 'high' }
  if (score >= 5) return { bg: '#FEF3C7', fg: '#92400E', label: 'mid' }
  return { bg: '#F1F5F9', fg: '#475569', label: 'low' }
}

function rateText(min: number | null, max: number | null, unit: string): string {
  if (min == null && max == null) return ''
  if (min != null && max != null) return `${Math.round(min)}-${Math.round(max)}€${unit}`
  if (min != null) return `${Math.round(min)}€${unit}`
  return `${Math.round(max!)}€${unit}`
}

export default function OrgCandidateGridCard({
  candidature,
  publicationType,
  pubSkillsRequired,
  onMutated,
}: Props) {
  const t = useTranslations('candidatures.card')
  const tAvail = useTranslations('cdi_profile_view.availability_status')
  const tCdi = useTranslations('cdi_profile_view.status_badges')
  const locale = useLocale()
  const domain = useDomain()
  const secureFetch = useSecureFetch()
  const markViewed = useMarkCandidatureViewed()

  const [busy, setBusy] = useState<'unlock' | 'reject' | 'select' | 'view' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmReject, setConfirmReject] = useState(false)
  const [confirmSelect, setConfirmSelect] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [viewedOptimistic, setViewedOptimistic] = useState(false)

  const { status, preview, unlocked_profile, ai_match_score, viewed_by_me } = candidature
  const isUnlocked = status === 'unlocked' || status === 'selected'
  const isSelected = status === 'selected'
  const isRejected = status === 'rejected'
  const isClosed = isRejected || status === 'withdrawn' || status === 'archived'
  const canAct = status === 'received' || status === 'in_review' || status === 'shortlisted'
  const canSelect = status === 'unlocked' && !isClosed

  const isViewed = viewedOptimistic || viewed_by_me === true
  const isUnviewed = !isViewed && viewed_by_me === false
  const optimisticView = () => setViewedOptimistic(true)

  // ─── Score badge (en surimpression photo) ───
  const score = scoreColor(ai_match_score)

  // ─── Disponibilité (en surimpression photo) ───
  // Source preview.availability_status (freelance) OU preview.cdi_status (CDI).
  // Pastille verte si "disponible / à l'écoute", rouge si DND, sinon rien.
  const availability: { label: string; color: string } | null = (() => {
    if (publicationType === 'offre') {
      const cs = (preview.cdi_status ?? null) as string | null
      if (cs === 'open_to_work' || cs == null) {
        return { label: tCdi('open_to_work'), color: '#16A34A' }
      }
      if (cs === 'employed') return { label: tCdi('employed'), color: '#DC2626' }
      return null
    }
    const av = preview.availability_status as string | null
    if (av === 'available' || av == null) return { label: tAvail('available'), color: '#16A34A' }
    if (av === 'do_not_disturb') return { label: tAvail('do_not_disturb'), color: '#DC2626' }
    return null
  })()

  // ─── Texte tarif (TJM mission / salaire CDI) ───
  const unit = publicationType === 'mission'
    ? (locale === 'fr' ? '/jour' : locale === 'es' ? '/día' : locale === 'de' ? '/Tag' : '/day')
    : (locale === 'fr' ? '/an' : locale === 'es' ? '/año' : locale === 'de' ? '/Jahr' : '/year')
  const rate = publicationType === 'mission'
    ? rateText(
        (preview.tjm_min as number | null) ?? null,
        (preview.tjm_max as number | null) ?? null,
        unit,
      )
    : rateText(
        (preview.salary_min as number | null) ?? null,
        (preview.salary_max as number | null) ?? null,
        unit,
      )

  // ─── Compétences : intersection avec pubSkillsRequired ───
  const expertSkills = (preview.skills as string[]) ?? []
  const requiredSet = new Set(pubSkillsRequired.map((s) => s.toLowerCase()))
  const skillsToShow = expertSkills.slice(0, 6)
  const isSkillMatched = (s: string) => requiredSet.has(s.toLowerCase())

  // ─── Display name : selon état + reveal serveur ───
  const displayName: string = (() => {
    if (isUnlocked && unlocked_profile) {
      return unlocked_profile.display_name || t('candidate_label')
    }
    return t('anonymous_candidate')
  })()

  // ─── Photo url (révélée serveur si reveal_photo: true) ───
  const photoUrl: string | null = (() => {
    if (isUnlocked && unlocked_profile?.photo_url) return unlocked_profile.photo_url
    return null
  })()

  // ─── Handlers ───
  const handleMarkViewed = async () => {
    if (busy) return
    setBusy('view')
    setError(null)
    try {
      await markViewed(candidature.id)
      optimisticView()
    } finally {
      setBusy(null)
    }
  }

  const handleUnlock = async () => {
    setBusy('unlock')
    setError(null)
    try {
      const res = await secureFetch(`/api/candidatures/${candidature.id}/unlock`, { method: 'POST' })
      const payload = (await res.json().catch(() => ({} as { code?: string }))) as { code?: string }
      if (!res.ok) {
        if (payload.code === 'invalid_transition') setError(t('error_invalid_transition'))
        else if (payload.code === 'not_found') setError(t('error_not_found'))
        else setError(t('error_generic'))
        return
      }
      optimisticView()
      onMutated()
    } catch {
      setError(t('error_generic'))
    } finally {
      setBusy(null)
    }
  }

  const handleSelect = async () => {
    setBusy('select')
    setError(null)
    try {
      const res = await secureFetch(`/api/candidatures/${candidature.id}/select`, { method: 'POST' })
      const payload = (await res.json().catch(() => ({} as { code?: string }))) as { code?: string }
      if (!res.ok) {
        if (payload.code === 'invalid_transition') setError(t('error_invalid_transition'))
        else if (payload.code === 'not_found') setError(t('error_not_found'))
        else setError(t('error_generic'))
        return
      }
      optimisticView()
      onMutated()
    } catch {
      setError(t('error_generic'))
    } finally {
      setBusy(null)
      setConfirmSelect(false)
    }
  }

  const handleReject = async () => {
    if (rejectReason.length > 2000) {
      setError(t('error_reason_too_long'))
      return
    }
    setBusy('reject')
    setError(null)
    try {
      const res = await secureFetch(`/api/candidatures/${candidature.id}/reject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason.trim() || null }),
      })
      const payload = (await res.json().catch(() => ({} as { code?: string }))) as { code?: string }
      if (!res.ok) {
        if (payload.code === 'invalid_transition') setError(t('error_invalid_transition'))
        else if (payload.code === 'not_found') setError(t('error_not_found'))
        else setError(t('error_generic'))
        return
      }
      optimisticView()
      onMutated()
    } catch {
      setError(t('error_generic'))
    } finally {
      setBusy(null)
      setConfirmReject(false)
    }
  }

  // ─── Card border accent si non consultée (pill "Nouveau") ───
  const borderColor = isClosed
    ? '#e2e8f0'
    : isUnviewed
      ? domain.primaryColor
      : isUnlocked
        ? domain.primaryColor
        : '#e5e7eb'
  const borderWidth = isUnviewed || isUnlocked ? 1.5 : 1

  return (
    <article
      style={{
        background: '#fff',
        border: `${borderWidth}px solid ${borderColor}`,
        borderRadius: 16,
        overflow: 'hidden',
        opacity: isClosed ? 0.65 : 1,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
        transition: 'box-shadow .15s, transform .12s',
      }}
    >
      {/* ── Photo + surimpression score/dispo ─────────────────────────── */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '1 / 1',
          background: photoUrl ? '#0f172a' : `linear-gradient(135deg, ${domain.primaryColor}22, ${domain.primaryColor}44)`,
          overflow: 'hidden',
        }}
      >
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt={displayName}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              gap: 8,
              color: '#fff',
            }}
            aria-hidden
          >
            <div style={{ fontSize: 42, opacity: 0.85 }}>🔒</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, opacity: 0.9, letterSpacing: '.04em', textTransform: 'uppercase' }}>
              {t('locked_profile_label')}
            </div>
          </div>
        )}

        {/* pastille Disponibilité (haut-gauche) */}
        {availability && (
          <span
            style={{
              position: 'absolute',
              top: 10,
              left: 10,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 10px',
              borderRadius: 999,
              background: 'rgba(255, 255, 255, 0.96)',
              color: '#0f172a',
              fontSize: 11.5,
              fontWeight: 600,
              boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
              backdropFilter: 'blur(4px)',
            }}
          >
            <span
              aria-hidden
              style={{ width: 7, height: 7, borderRadius: '50%', background: availability.color }}
            />
            {availability.label}
          </span>
        )}

        {/* badge Score (haut-droite) */}
        {score && ai_match_score != null && (
          <span
            title={t('ai_score_tooltip')}
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              padding: '5px 10px',
              borderRadius: 999,
              background: score.bg,
              color: score.fg,
              fontSize: 11.5,
              fontWeight: 700,
              boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
            }}
          >
            {Math.round(ai_match_score)}/10
          </span>
        )}

        {/* pill Nouveau (bas-droite) */}
        {isUnviewed && !isClosed && (
          <span
            style={{
              position: 'absolute',
              bottom: 10,
              right: 10,
              padding: '4px 9px',
              borderRadius: 999,
              background: domain.primaryColor,
              color: '#fff',
              fontSize: 10.5,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '.05em',
              boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
            }}
          >
            {t('new_label')}
          </span>
        )}
      </div>

      {/* ── Corps : nom / titre / méta / chips ───────────────────────── */}
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', margin: 0, lineHeight: 1.3, letterSpacing: '-0.2px' }}>
            {displayName}
          </h3>
          {(preview.title as string | null) && (
            <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {preview.title as string}
            </div>
          )}
        </div>

        {/* TJM/salaire + lieu */}
        {(rate || preview.city || preview.country) && (
          <div style={{ fontSize: 12, color: '#475569', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {rate && <span style={{ fontWeight: 600, color: '#0f172a' }}>{rate}</span>}
            {(preview.city || preview.country) && (
              <span>📍 {[preview.city, preview.country].filter(Boolean).join(', ')}</span>
            )}
          </div>
        )}

        {/* Chips compétences (matchées en accent) */}
        {skillsToShow.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {skillsToShow.map((s) => {
              const matched = isSkillMatched(s)
              return (
                <span
                  key={s}
                  title={matched ? t('skill_matched_tooltip') : undefined}
                  style={{
                    padding: '3px 8px',
                    background: matched ? `${domain.primaryColor}1A` : '#f1f5f9',
                    color: matched ? domain.primaryColor : '#475569',
                    fontSize: 11,
                    fontWeight: matched ? 600 : 500,
                    borderRadius: 6,
                    border: matched ? `1px solid ${domain.primaryColor}55` : '1px solid transparent',
                  }}
                >
                  {s}
                </span>
              )
            })}
            {expertSkills.length > skillsToShow.length && (
              <span style={{ fontSize: 11, color: '#94a3b8', alignSelf: 'center' }}>
                +{expertSkills.length - skillsToShow.length}
              </span>
            )}
          </div>
        )}

        {/* Status badge (selected → "Mission attribuée" / "Poste attribué") */}
        {isSelected && (
          <div style={{ display: 'inline-flex' }}>
            <span
              style={{
                padding: '4px 10px',
                background: '#FEF3C7',
                color: '#92400E',
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 999,
              }}
            >
              🏆 {t(publicationType === 'mission' ? 'selected_section_label_mission' : 'selected_section_label_offre')}
            </span>
          </div>
        )}
        {isRejected && (
          <div style={{ display: 'inline-flex' }}>
            <span
              style={{
                padding: '4px 10px',
                background: '#FEE2E2',
                color: '#991B1B',
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 999,
              }}
            >
              {t('status.rejected')}
            </span>
          </div>
        )}

        {/* Erreur inline */}
        {error && (
          <div role="alert" style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', padding: '8px 10px', borderRadius: 8, fontSize: 11.5 }}>
            {error}
          </div>
        )}
      </div>

      {/* ── Footer actions ───────────────────────────────────────────── */}
      <div style={{ padding: '10px 14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Carte VERROUILLÉE : "Débloquer le profil" */}
        {canAct && !confirmReject && (
          <>
            <button
              type="button"
              onClick={handleUnlock}
              disabled={busy !== null}
              style={{
                width: '100%',
                padding: '10px 14px',
                background: domain.primaryColor,
                color: '#fff',
                border: 'none',
                borderRadius: 9,
                fontSize: 12.5,
                fontWeight: 700,
                cursor: busy ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                opacity: busy === 'unlock' ? 0.6 : 1,
              }}
            >
              {busy === 'unlock' ? t('button_unlocking') : `🔓 ${t('button_unlock')}`}
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setConfirmReject(true)}
                disabled={busy !== null}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  background: '#fff',
                  color: '#64748b',
                  border: '1px solid #cbd5e1',
                  borderRadius: 9,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {t('button_reject')}
              </button>
              {isUnviewed && (
                <button
                  type="button"
                  onClick={() => void handleMarkViewed()}
                  disabled={busy !== null}
                  style={{
                    padding: '8px 12px',
                    background: 'transparent',
                    color: '#64748b',
                    border: '1px solid #e2e8f0',
                    borderRadius: 9,
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: busy ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {busy === 'view' ? t('mark_viewed_busy') : `✓ ${t('mark_viewed_cta')}`}
                </button>
              )}
            </div>
          </>
        )}

        {/* Confirm reject inline */}
        {canAct && confirmReject && (
          <div style={{ background: '#FEF2F2', border: '1.5px solid #FECACA', borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#991B1B', marginBottom: 6 }}>{t('reject_confirm_title')}</div>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t('reject_reason_placeholder')}
              maxLength={2000}
              rows={2}
              style={{
                width: '100%',
                padding: '6px 8px',
                fontSize: 11.5,
                border: '1px solid #FECACA',
                borderRadius: 6,
                outline: 'none',
                fontFamily: 'inherit',
                resize: 'vertical',
                boxSizing: 'border-box',
                lineHeight: 1.5,
                marginBottom: 8,
              }}
            />
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => { setConfirmReject(false); setRejectReason(''); setError(null) }}
                disabled={busy !== null}
                style={{ padding: '6px 12px', background: 'transparent', color: '#64748b', border: '1px solid #cbd5e1', borderRadius: 7, fontSize: 11.5, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
              >
                {t('reject_cancel')}
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={busy !== null}
                style={{ padding: '6px 12px', background: '#DC2626', color: '#fff', border: 'none', borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: busy === 'reject' ? 0.6 : 1 }}
              >
                {busy === 'reject' ? t('button_rejecting') : t('reject_confirm')}
              </button>
            </div>
          </div>
        )}

        {/* Carte DÉBLOQUÉE : Message + Retenir + (Marquer vue) */}
        {isUnlocked && !isClosed && (
          <>
            {candidature.conversation_id && (
              <Link
                href={`/dashboard/entreprise/messages/${candidature.conversation_id}`}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  background: domain.primaryColor,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 9,
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textDecoration: 'none',
                  textAlign: 'center',
                  display: 'block',
                }}
              >
                💬 {t('conversation_button')}
              </Link>
            )}
            {canSelect && !confirmSelect && (
              <button
                type="button"
                onClick={() => setConfirmSelect(true)}
                disabled={busy !== null}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: '#fff',
                  color: '#92400E',
                  border: '1.5px solid #F59E0B',
                  borderRadius: 9,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                🏆 {t('button_select')}
              </button>
            )}
            {canSelect && confirmSelect && (
              <div style={{ background: '#FEF3C7', border: '1.5px solid #F59E0B', borderRadius: 9, padding: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#92400E', marginBottom: 4 }}>
                  {t('select_confirm_title')}
                </div>
                <div style={{ fontSize: 11.5, color: '#92400E', lineHeight: 1.5, marginBottom: 8 }}>
                  {t(publicationType === 'mission' ? 'select_confirm_body_mission' : 'select_confirm_body_offre')}
                </div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => { setConfirmSelect(false); setError(null) }}
                    disabled={busy !== null}
                    style={{ padding: '6px 10px', background: 'transparent', color: '#92400E', border: '1px solid #FCD34D', borderRadius: 7, fontSize: 11.5, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                  >
                    {t('select_cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={handleSelect}
                    disabled={busy !== null}
                    style={{ padding: '6px 10px', background: '#D97706', color: '#fff', border: 'none', borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: busy === 'select' ? 0.6 : 1 }}
                  >
                    {busy === 'select' ? t('button_selecting') : t('select_confirm')}
                  </button>
                </div>
              </div>
            )}
            {isUnviewed && (
              <button
                type="button"
                onClick={() => void handleMarkViewed()}
                disabled={busy !== null}
                style={{
                  padding: '6px 10px',
                  background: 'transparent',
                  color: '#64748b',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                  alignSelf: 'flex-end',
                }}
              >
                {busy === 'view' ? t('mark_viewed_busy') : `✓ ${t('mark_viewed_cta')}`}
              </button>
            )}
          </>
        )}
      </div>
    </article>
  )
}
