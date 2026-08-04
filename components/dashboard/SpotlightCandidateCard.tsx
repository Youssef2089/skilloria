'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { Link } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch } from '@/lib/secure-fetch'
import { useMarkCandidatureViewed } from '@/lib/candidature-view-client'
import { useOrgRole } from '@/lib/use-org-role'
import type { CandidatureData } from '@/components/dashboard/CandidatureCard'

/**
 * SpotlightCandidateCard — carte candidat "sous projecteur" du carrousel
 * casting (Lot vue casting).
 *
 * Pleine et nette quand elle est centrée ; rendue estompée (opacité + scale
 * réduits) par le parent <CastingCarousel> quand elle occupe un slot voisin.
 *
 * États :
 *   - VERROUILLÉE (status pré-unlock) : cadenas + teaser + bouton "Débloquer".
 *   - DÉBLOQUÉE  (status unlocked|selected) : photo + nom complet + actions
 *     Message / Accepter / Refuser.
 *   - FERMÉE (rejected/withdrawn/archived) : carte fanée, pas d'actions.
 *
 * Surimpression photo : pastille disponibilité (haut-gauche, namespace
 * `profile_view.availability_status` pour freelance — namespace correct,
 * cf. bugfix de l'ancien OrgCandidateGridCard) + badge score (haut-droite,
 * color-codé : ≥8 vert, 5-7 ambre, <5 gris).
 *
 * Sécurité : la révélation photo+nom est CÔTÉ SERVEUR (lib/expert-disclosure.ts).
 * Aucun contournement client possible — la prop `candidature` reflète
 * exactement ce que le DTO autorise.
 *
 * `interactive` (default true) : si false, les boutons sont désactivés
 * (utilisé par le carrousel pour les cartes voisines estompées).
 *
 * `messagesBasePath` (default '/dashboard/entreprise') : base d'URL du lien
 * « Ouvrir la conversation ». Côté sous-traitance, l'expert publiant consomme
 * la MÊME carte mais ses messages vivent sous /dashboard/{role}/messages — le
 * lien entreprise y serait cassé (guard de routage). Un seul point paramétré.
 *
 * `conversionMode` (default 'unlock') : comportement sur un candidat MASQUÉ.
 *   - 'unlock' (org) : bouton « Débloquer » actif + « Refuser ».
 *   - 'wall'  (sous-traitance V0) : MUR DE CONVERSION visible mais INACTIF
 *     (« Bientôt disponible ») — pas de Stripe en V0, aucun parcours de
 *     paiement inventé. Le masquage reste porté SERVEUR par le DTO (aucune
 *     duplication de logique) ; seule l'action de dévoilement est neutralisée.
 */

type Props = {
  candidature: CandidatureData
  publicationType: 'mission' | 'offre' | string
  pubSkillsRequired: string[]
  onMutated: () => void
  /** false → boutons disabled (cas slots voisins du carrousel). */
  interactive?: boolean
  /** Base d'URL des liens messagerie (cf. en-tête). */
  messagesBasePath?: string
  /** Comportement sur candidat masqué : 'unlock' (org) | 'wall' (sous-traitance). */
  conversionMode?: 'unlock' | 'wall'
}

function scoreColor(score: number | null): { bg: string; fg: string } | null {
  if (score == null || Number.isNaN(score)) return null
  if (score >= 8) return { bg: '#DCFCE7', fg: '#166534' }
  if (score >= 5) return { bg: '#FEF3C7', fg: '#92400E' }
  return { bg: '#F1F5F9', fg: '#475569' }
}

function rateText(min: number | null, max: number | null, unit: string): string {
  if (min == null && max == null) return ''
  if (min != null && max != null) return `${Math.round(min)}-${Math.round(max)}€${unit}`
  if (min != null) return `${Math.round(min)}€${unit}`
  return `${Math.round(max!)}€${unit}`
}

export default function SpotlightCandidateCard({
  candidature,
  publicationType,
  pubSkillsRequired,
  onMutated,
  interactive = true,
  messagesBasePath = '/dashboard/entreprise',
  conversionMode = 'unlock',
}: Props) {
  const t = useTranslations('candidatures.card')
  const tPub = useTranslations('publications')
  // C7 : masquage préventif des actions pour un viewer (lecture seule). La
  // garde SERVEUR (requireOrgRole) reste la garantie ; ceci n'est qu'un confort.
  const { canManage, loading: roleLoading } = useOrgRole()
  // Bugfix : freelance availability namespace = `profile_view.availability_status`
  // (l'ancien OrgCandidateGridCard pointait à tort sur `cdi_profile_view.*` qui
  // n'existe pas → clés brutes affichées).
  const tAvail = useTranslations('profile_view.availability_status')
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

  const { status, preview, unlocked_profile, ai_match_score, ai_pitch, viewed_by_me } = candidature
  const isUnlocked = status === 'unlocked' || status === 'selected'
  const isSelected = status === 'selected'
  const isRejected = status === 'rejected'
  const isClosed = isRejected || status === 'withdrawn' || status === 'archived'
  const canAct = status === 'received' || status === 'in_review' || status === 'shortlisted'
  const canSelect = status === 'unlocked' && !isClosed
  const isViewed = viewedOptimistic || viewed_by_me === true
  const isUnviewed = !isViewed && viewed_by_me === false
  const optimisticView = () => setViewedOptimistic(true)

  const disabled = !interactive || busy !== null

  const score = scoreColor(ai_match_score)

  const availability: { label: string; color: string } | null = (() => {
    if (publicationType === 'offre') {
      const cs = (preview.cdi_status ?? null) as string | null
      if (cs === 'open_to_work' || cs == null) return { label: tCdi('open_to_work'), color: '#16A34A' }
      if (cs === 'employed') return { label: tCdi('employed'), color: '#DC2626' }
      return null
    }
    const av = preview.availability_status as string | null
    if (av === 'available' || av == null) return { label: tAvail('available'), color: '#16A34A' }
    if (av === 'do_not_disturb') return { label: tAvail('do_not_disturb'), color: '#DC2626' }
    return null
  })()

  const unit = publicationType === 'mission'
    ? tPub('budget_unit.day')
    : tPub('budget_unit.year')
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

  const expertSkills = (preview.skills as string[]) ?? []
  const requiredSet = new Set(pubSkillsRequired.map((s) => s.toLowerCase()))
  // Tri : matchées d'abord, dans la limite de 10 chips visibles.
  const sortedSkills = [...expertSkills].sort((a, b) => {
    const am = requiredSet.has(a.toLowerCase()) ? 0 : 1
    const bm = requiredSet.has(b.toLowerCase()) ? 0 : 1
    return am - bm
  })
  const skillsToShow = sortedSkills.slice(0, 10)
  const isSkillMatched = (s: string) => requiredSet.has(s.toLowerCase())

  const displayName: string = isUnlocked && unlocked_profile
    ? (unlocked_profile.display_name || t('candidate_label'))
    : t('anonymous_candidate')
  const photoUrl: string | null = isUnlocked && unlocked_profile?.photo_url
    ? unlocked_profile.photo_url
    : null

  const handleMarkViewed = async () => {
    if (disabled) return
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
    if (disabled) return
    setBusy('unlock')
    setError(null)
    try {
      const res = await secureFetch(`/api/candidatures/${candidature.id}/unlock`, { method: 'POST' })
      const payload = (await res.json().catch(() => ({} as { code?: string }))) as { code?: string }
      if (!res.ok) {
        if (payload.code === 'invalid_transition') setError(t('error_invalid_transition'))
        else if (payload.code === 'not_found') setError(t('error_not_found'))
        else if (payload.code === 'insufficient_role') setError(t('error_insufficient_role'))
        else setError(t('error_generic'))
        return
      }
      optimisticView()
      onMutated()
    } catch { setError(t('error_generic')) } finally { setBusy(null) }
  }
  const handleSelect = async () => {
    if (disabled) return
    setBusy('select')
    setError(null)
    try {
      const res = await secureFetch(`/api/candidatures/${candidature.id}/select`, { method: 'POST' })
      const payload = (await res.json().catch(() => ({} as { code?: string }))) as { code?: string }
      if (!res.ok) {
        if (payload.code === 'invalid_transition') setError(t('error_invalid_transition'))
        else if (payload.code === 'not_found') setError(t('error_not_found'))
        else if (payload.code === 'insufficient_role') setError(t('error_insufficient_role'))
        else setError(t('error_generic'))
        return
      }
      optimisticView()
      onMutated()
    } catch { setError(t('error_generic')) } finally { setBusy(null); setConfirmSelect(false) }
  }
  const handleReject = async () => {
    if (disabled) return
    if (rejectReason.length > 2000) { setError(t('error_reason_too_long')); return }
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
        else if (payload.code === 'insufficient_role') setError(t('error_insufficient_role'))
        else setError(t('error_generic'))
        return
      }
      optimisticView()
      onMutated()
    } catch { setError(t('error_generic')) } finally { setBusy(null); setConfirmReject(false) }
  }

  return (
    <article
      style={{
        background: '#fff',
        border: isUnviewed && !isClosed
          ? `2px solid ${domain.primaryColor}`
          : isUnlocked
            ? `1.5px solid ${domain.primaryColor}`
            : '1px solid #e5e7eb',
        borderRadius: 18,
        overflow: 'hidden',
        opacity: isClosed ? 0.65 : 1,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 10px 30px rgba(15, 23, 42, 0.10), 0 2px 6px rgba(15, 23, 42, 0.05)',
        width: '100%',
        maxWidth: 420,
      }}
    >
      {/* PHOTO + surimpressions */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '4 / 3',
          background: photoUrl ? '#0f172a' : `linear-gradient(135deg, ${domain.primaryColor}22, ${domain.primaryColor}44)`,
          overflow: 'hidden',
        }}
      >
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt={displayName} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, color: '#fff' }} aria-hidden>
            <div style={{ fontSize: 56, opacity: 0.85 }}>🔒</div>
            <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.9, letterSpacing: '.04em', textTransform: 'uppercase' }}>
              {t('locked_profile_label')}
            </div>
          </div>
        )}

        {availability && (
          <span style={{ position: 'absolute', top: 12, left: 12, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 999, background: 'rgba(255,255,255,0.96)', color: '#0f172a', fontSize: 12, fontWeight: 600, boxShadow: '0 1px 4px rgba(0,0,0,0.18)' }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: availability.color }} />
            {availability.label}
          </span>
        )}
        {score && ai_match_score != null && (
          <span title={t('ai_score_tooltip')} style={{ position: 'absolute', top: 12, right: 12, padding: '6px 12px', borderRadius: 999, background: score.bg, color: score.fg, fontSize: 12.5, fontWeight: 800, boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }}>
            {Math.round(ai_match_score)}/10
          </span>
        )}
        {isUnviewed && !isClosed && (
          <span style={{ position: 'absolute', bottom: 12, right: 12, padding: '5px 10px', borderRadius: 999, background: domain.primaryColor, color: '#fff', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', boxShadow: '0 1px 4px rgba(0,0,0,0.18)' }}>
            {t('new_label')}
          </span>
        )}
      </div>

      {/* CORPS */}
      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0, lineHeight: 1.3, letterSpacing: '-0.3px' }}>
            {displayName}
          </h3>
          {(preview.title as string | null) && (
            <div style={{ fontSize: 13.5, color: '#475569', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {preview.title as string}
            </div>
          )}
        </div>

        {(rate || preview.city || preview.country) && (
          <div style={{ fontSize: 13, color: '#475569', display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {rate && <span style={{ fontWeight: 700, color: '#0f172a' }}>{rate}</span>}
            {(preview.city || preview.country) && (
              <span>📍 {[preview.city, preview.country].filter(Boolean).join(', ')}</span>
            )}
          </div>
        )}

        {skillsToShow.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {skillsToShow.map((s) => {
              const matched = isSkillMatched(s)
              return (
                <span
                  key={s}
                  title={matched ? t('skill_matched_tooltip') : undefined}
                  style={{
                    padding: '4px 10px',
                    background: matched ? `${domain.primaryColor}1A` : '#f1f5f9',
                    color: matched ? domain.primaryColor : '#475569',
                    fontSize: 11.5,
                    fontWeight: matched ? 700 : 500,
                    borderRadius: 8,
                    border: matched ? `1px solid ${domain.primaryColor}55` : '1px solid transparent',
                  }}
                >
                  {s}
                </span>
              )
            })}
            {expertSkills.length > skillsToShow.length && (
              <span style={{ fontSize: 11.5, color: '#94a3b8', alignSelf: 'center' }}>
                +{expertSkills.length - skillsToShow.length}
              </span>
            )}
          </div>
        )}

        {ai_pitch && (
          <div style={{ background: `${domain.primaryColor}0F`, border: `1px solid ${domain.primaryColor}33`, borderRadius: 10, padding: '10px 12px', fontSize: 12.5, color: '#0f172a', lineHeight: 1.55 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: domain.primaryColor, marginBottom: 4 }}>
              ✨ {t('ai_pitch_label')}
            </div>
            {ai_pitch}
          </div>
        )}

        {isSelected && (
          <div style={{ display: 'inline-flex' }}>
            <span style={{ padding: '5px 11px', background: '#FEF3C7', color: '#92400E', fontSize: 11.5, fontWeight: 700, borderRadius: 999 }}>
              🏆 {t(publicationType === 'mission' ? 'selected_section_label_mission' : 'selected_section_label_offre')}
            </span>
          </div>
        )}
        {isRejected && (
          <div style={{ display: 'inline-flex' }}>
            <span style={{ padding: '5px 11px', background: '#FEE2E2', color: '#991B1B', fontSize: 11.5, fontWeight: 700, borderRadius: 999 }}>
              {t('status.rejected')}
            </span>
          </div>
        )}

        {error && (
          <div role="alert" style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', padding: '9px 11px', borderRadius: 9, fontSize: 12 }}>
            {error}
          </div>
        )}
      </div>

      {/* FOOTER actions */}
      <div style={{ padding: '12px 20px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* C7 : viewer = lecture seule. On masque toute action d'écriture et on
            affiche une note explicative. La garde serveur reste la garantie. */}
        {!roleLoading && !canManage && (canAct || (isUnlocked && !isClosed)) && (
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 9, padding: '9px 11px', fontSize: 12, color: '#64748b', textAlign: 'center' }}>
            {t('read_only_role')}
          </div>
        )}
        {/* MUR DE CONVERSION (sous-traitance V0) — visible mais INACTIF.
            Construit pour signaler la valeur du dévoilement, sans parcours de
            paiement (pas de Stripe en V0). Remplace le bloc unlock/refuser. */}
        {canAct && conversionMode === 'wall' && canManage && (
          <div style={{ background: '#FFFBEB', border: '1.5px solid #FDE68A', borderRadius: 12, padding: '14px 14px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span aria-hidden style={{ fontSize: 18 }}>🔒</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#92400E' }}>{t('wall_title')}</span>
            </div>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: '#92400E', lineHeight: 1.5 }}>{t('wall_body')}</p>
            <button
              type="button"
              disabled
              aria-disabled
              title={t('wall_cta_hint')}
              style={{ width: '100%', padding: '10px 14px', background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: 'not-allowed', fontFamily: 'inherit', opacity: 0.85 }}
            >
              {t('wall_cta')}
            </button>
          </div>
        )}

        {canAct && conversionMode === 'unlock' && canManage && !confirmReject && (
          <>
            <button type="button" onClick={handleUnlock} disabled={disabled} style={{ width: '100%', padding: '12px 16px', background: domain.primaryColor, color: '#fff', border: 'none', borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: busy === 'unlock' ? 0.6 : 1 }}>
              {busy === 'unlock' ? t('button_unlocking') : `🔓 ${t('button_unlock')}`}
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setConfirmReject(true)} disabled={disabled} style={{ flex: 1, padding: '9px 12px', background: '#fff', color: '#64748b', border: '1px solid #cbd5e1', borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                {t('button_reject')}
              </button>
              {isUnviewed && (
                <button type="button" onClick={() => void handleMarkViewed()} disabled={disabled} style={{ padding: '9px 12px', background: 'transparent', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                  {busy === 'view' ? t('mark_viewed_busy') : `✓ ${t('mark_viewed_cta')}`}
                </button>
              )}
            </div>
          </>
        )}

        {canAct && conversionMode === 'unlock' && canManage && confirmReject && (
          <div style={{ background: '#FEF2F2', border: '1.5px solid #FECACA', borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#991B1B', marginBottom: 8 }}>{t('reject_confirm_title')}</div>
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder={t('reject_reason_placeholder')} maxLength={2000} rows={3} style={{ width: '100%', padding: '8px 10px', fontSize: 12, border: '1px solid #FECACA', borderRadius: 8, outline: 'none', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5, marginBottom: 10 }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => { setConfirmReject(false); setRejectReason(''); setError(null) }} disabled={disabled} style={{ padding: '7px 14px', background: 'transparent', color: '#64748b', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                {t('reject_cancel')}
              </button>
              <button type="button" onClick={handleReject} disabled={disabled} style={{ padding: '7px 14px', background: '#DC2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: busy === 'reject' ? 0.6 : 1 }}>
                {busy === 'reject' ? t('button_rejecting') : t('reject_confirm')}
              </button>
            </div>
          </div>
        )}

        {isUnlocked && !isClosed && (
          <>
            {candidature.conversation_id && (
              <Link href={`${messagesBasePath}/messages/${candidature.conversation_id}`} style={{ width: '100%', padding: '12px 16px', background: domain.primaryColor, color: '#fff', border: 'none', borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', textDecoration: 'none', textAlign: 'center', display: 'block', pointerEvents: disabled ? 'none' : 'auto', opacity: disabled ? 0.6 : 1 }}>
                💬 {t('conversation_button')}
              </Link>
            )}
            {canSelect && canManage && !confirmSelect && (
              <button type="button" onClick={() => setConfirmSelect(true)} disabled={disabled} style={{ width: '100%', padding: '9px 14px', background: '#fff', color: '#92400E', border: '1.5px solid #F59E0B', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                🏆 {t('button_select')}
              </button>
            )}
            {canSelect && canManage && confirmSelect && (
              <div style={{ background: '#FEF3C7', border: '1.5px solid #F59E0B', borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#92400E', marginBottom: 5 }}>{t('select_confirm_title')}</div>
                <div style={{ fontSize: 12, color: '#92400E', lineHeight: 1.5, marginBottom: 10 }}>
                  {t(publicationType === 'mission' ? 'select_confirm_body_mission' : 'select_confirm_body_offre')}
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => { setConfirmSelect(false); setError(null) }} disabled={disabled} style={{ padding: '7px 11px', background: 'transparent', color: '#92400E', border: '1px solid #FCD34D', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                    {t('select_cancel')}
                  </button>
                  <button type="button" onClick={handleSelect} disabled={disabled} style={{ padding: '7px 11px', background: '#D97706', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: busy === 'select' ? 0.6 : 1 }}>
                    {busy === 'select' ? t('button_selecting') : t('select_confirm')}
                  </button>
                </div>
              </div>
            )}
            {isUnviewed && (
              <button type="button" onClick={() => void handleMarkViewed()} disabled={disabled} style={{ padding: '7px 11px', background: 'transparent', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 9, fontSize: 11.5, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', alignSelf: 'flex-end' }}>
                {busy === 'view' ? t('mark_viewed_busy') : `✓ ${t('mark_viewed_cta')}`}
              </button>
            )}
          </>
        )}
      </div>
    </article>
  )
}
