'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'
import { useMarkCandidatureViewed } from '@/lib/candidature-view-client'
import { useOrgRole } from '@/lib/use-org-role'
import type { CandidatureData } from '@/components/dashboard/CandidatureCard'
import { useCandidatureLifecycleLabel } from '@/lib/candidatures/use-lifecycle-label'
import ImageOuRepli from '@/components/ui/ImageOuRepli'

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
  /**
   * LE VERROU D'ENCAISSEMENT, résolu au SERVEUR et transmis en prop.
   *
   * En prop plutôt qu'en lecture propre : le carrousel affiche plusieurs
   * cartes, et chacune interrogerait le serveur pour la même réponse. La
   * surface qui charge déjà les droits le lit une fois et le fait descendre.
   *
   * `undefined` = pas encore connu → traité comme FERMÉ. On n'ouvre jamais un
   * chemin de paiement par ignorance.
   */
  billingEnabled?: boolean
}

function scoreColor(score: number | null): { bg: string; fg: string } | null {
  if (score == null || Number.isNaN(score)) return null
  if (score >= 8) return { bg: 'var(--sk-success-soft)', fg: 'var(--sk-success)' }
  if (score >= 5) return { bg: 'var(--sk-amber-soft)', fg: 'var(--sk-amber)' }
  return { bg: 'var(--sk-surface-2)', fg: 'var(--sk-muted)' }
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
  billingEnabled,
}: Props) {
  const t = useTranslations('candidatures.card')
  const tPub = useTranslations('publications')
  const tCommerce = useTranslations('commerce')
  // C7 : masquage préventif des actions pour un viewer (lecture seule). La
  // garde SERVEUR (requireOrgRole) reste la garantie ; ceci n'est qu'un confort.
  const { canManage, loading: roleLoading } = useOrgRole()
  // Bugfix : freelance availability namespace = `profile_view.availability_status`
  // (l'ancien OrgCandidateGridCard pointait à tort sur `cdi_profile_view.*` qui
  // n'existe pas → clés brutes affichées).
  const tAvail = useTranslations('profile_view.availability_status')
  const tCdi = useTranslations('cdi_profile_view.status_badges')
  // SITE DE RENDU 5/5 — libellé d'état par la RAISON dérivée, point de vue org.
  const lifecycleLabel = useCandidatureLifecycleLabel('org')
  const locale = useLocale()
  const secureFetch = useSecureFetch()
  const markViewed = useMarkCandidatureViewed()

  const [busy, setBusy] = useState<'unlock' | 'reject' | 'select' | 'view' | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * Le refus vient-il d'une LIMITE D'OFFRE plutôt que d'une action impossible ?
   *
   * Une limite ne se corrige pas sur cette carte : elle appelle une issue, pas
   * une reprise. On la distingue donc du reste (ambre, pas rouge) et on lui
   * ajoute une ligne d'action — que « candidature introuvable » ne doit surtout
   * pas porter.
   */
  const [limiteAtteinte, setLimiteAtteinte] = useState(false)
  const [confirmReject, setConfirmReject] = useState(false)
  const [confirmSelect, setConfirmSelect] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [viewedOptimistic, setViewedOptimistic] = useState(false)

  const { status, preview, unlocked_profile, ai_match_score, ai_pitch, viewed_by_me, lifecycle } = candidature
  const isUnlocked = status === 'unlocked' || status === 'selected'
  const isSelected = status === 'selected'
  const isRejected = status === 'rejected'
  // « Close » = ARCHIVÉE au sens état de vie : refus, retrait, mais aussi
  // fenêtre d'échange écoulée et annonce expirée. C'est ce qui fane la carte
  // et retire les actions — on ne retient pas un candidat sur un échange mort.
  const isClosed = lifecycle
    ? lifecycle.bucket === 'archived'
    : isRejected || status === 'withdrawn' || status === 'archived'
  const canAct = !isClosed && (status === 'received' || status === 'in_review' || status === 'shortlisted')
  const canSelect = status === 'unlocked' && !isClosed
  /** Bandeau d'état affiché en bas de carte quand la candidature n'est plus
   *  « en cours » : sélection (positive) ou archivage (avec sa raison). */
  const showStateBanner = isSelected || isClosed
  const isViewed = viewedOptimistic || viewed_by_me === true
  const isUnviewed = !isViewed && viewed_by_me === false
  const optimisticView = () => setViewedOptimistic(true)

  const disabled = !interactive || busy !== null

  const score = scoreColor(ai_match_score)

  const availability: { label: string; color: string } | null = (() => {
    if (publicationType === 'offre') {
      const cs = (preview.cdi_status ?? null) as string | null
      if (cs === 'open_to_work' || cs == null) return { label: tCdi('open_to_work'), color: 'var(--sk-success)' }
      if (cs === 'employed') return { label: tCdi('employed'), color: 'var(--sk-red)' }
      return null
    }
    const av = preview.availability_status as string | null
    if (av === 'available' || av == null) return { label: tAvail('available'), color: 'var(--sk-success)' }
    if (av === 'do_not_disturb') return { label: tAvail('do_not_disturb'), color: 'var(--sk-red)' }
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
    setLimiteAtteinte(false)
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
    setLimiteAtteinte(false)
    try {
      // `candidature_archived` : l'annonce a atteint sa fin de vie pendant que
      // la page était ouverte. Le bouton avait disparu au prochain rendu, mais
      // le clic avait déjà été émis — on dit pourquoi plutôt qu'« erreur ».
      const res = await secureFetch(`/api/candidatures/${candidature.id}/unlock`, { method: 'POST' })
      const payload = (await res.json().catch(() => ({} as { code?: string }))) as { code?: string }
      if (!res.ok) {
        if (payload.code === 'candidature_archived') setError(t('error_candidature_archived'))
        else if (payload.code === 'invalid_transition') setError(t('error_invalid_transition'))
        else if (payload.code === 'not_found') setError(t('error_not_found'))
        else if (payload.code === 'insufficient_role') setError(t('error_insufficient_role'))
        // ── Refus COMMERCE (402) ──────────────────────────────────────────
        //  Il manquait, et le serveur le nomme pourtant : l'organisation qui
        //  épuisait ses dévoilements lisait « une erreur est survenue ». Le
        //  message dit maintenant la limite ATTEINTE et quand elle se relève.
        //  La ligne d'issue est portée à part (`limiteAtteinte`), pour ne pas
        //  coller un appel à l'action sur « candidature introuvable ».
        else if (payload.code === 'unlock_limit_reached') {
          setError(t('error_unlock_limit_reached'))
          setLimiteAtteinte(true)
        }
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
    setLimiteAtteinte(false)
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
    setLimiteAtteinte(false)
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
        background: 'var(--sk-surface)',
        border: isUnviewed && !isClosed
          ? `2px solid var(--sk-accent)`
          : isUnlocked
            ? `1.5px solid var(--sk-accent)`
            : '1px solid var(--sk-border)',
        borderRadius: 18,
        overflow: 'hidden',
        opacity: isClosed ? 0.65 : 1,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 10px 30px color-mix(in srgb, var(--sk-text) 10%, transparent), 0 2px 6px color-mix(in srgb, var(--sk-text) 5%, transparent)',
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
          background: photoUrl ? 'var(--sk-text)' : `linear-gradient(135deg, color-mix(in srgb, var(--sk-accent) 13%, transparent), color-mix(in srgb, var(--sk-accent) 27%, transparent))`,
          overflow: 'hidden',
        }}
      >
        {/* Repli sur ABSENCE *et* ÉCHEC : la photo d'expert est servie par URL
            signée (300 s). Expirée, elle doit redonner l'état verrouillé, pas
            l'icône d'image cassée. */}
        <ImageOuRepli
          src={photoUrl}
          alt={displayName}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          repli={(
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, color: 'var(--sk-sur-accent)' }} aria-hidden>
            <div style={{ fontSize: 56, opacity: 0.85 }}>🔒</div>
            <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.9, letterSpacing: '.04em', textTransform: 'uppercase' }}>
              {t('locked_profile_label')}
            </div>
          </div>
          )}
        />

        {availability && (
          <span style={{ position: 'absolute', top: 12, left: 12, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 999, background: 'color-mix(in srgb, var(--sk-surface) 96%, transparent)', color: 'var(--sk-text)', fontSize: 12, fontWeight: 600, boxShadow: '0 1px 4px color-mix(in srgb, var(--sk-text) 18%, transparent)' }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: availability.color }} />
            {availability.label}
          </span>
        )}
        {score && ai_match_score != null && (
          <span title={t('ai_score_tooltip')} style={{ position: 'absolute', top: 12, right: 12, padding: '6px 12px', borderRadius: 999, background: score.bg, color: score.fg, fontSize: 12.5, fontWeight: 800, boxShadow: '0 1px 4px color-mix(in srgb, var(--sk-text) 12%, transparent)' }}>
            {Math.round(ai_match_score)}/10
          </span>
        )}
        {isUnviewed && !isClosed && (
          <span style={{ position: 'absolute', bottom: 12, right: 12, padding: '5px 10px', borderRadius: 999, background: 'var(--sk-accent)', color: 'var(--sk-sur-accent)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', boxShadow: '0 1px 4px color-mix(in srgb, var(--sk-text) 18%, transparent)' }}>
            {t('new_label')}
          </span>
        )}
      </div>

      {/* CORPS */}
      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--sk-text)', margin: 0, lineHeight: 1.3, letterSpacing: '-0.3px' }}>
            {displayName}
          </h3>
          {(preview.title as string | null) && (
            <div style={{ fontSize: 13.5, color: 'var(--sk-muted)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {preview.title as string}
            </div>
          )}
        </div>

        {(rate || preview.city || preview.country) && (
          <div style={{ fontSize: 13, color: 'var(--sk-muted)', display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {rate && <span style={{ fontWeight: 700, color: 'var(--sk-text)' }}>{rate}</span>}
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
                    background: matched ? `color-mix(in srgb, var(--sk-accent) 10%, transparent)` : 'var(--sk-surface-2)',
                    color: matched ? 'var(--sk-accent)' : 'var(--sk-muted)',
                    fontSize: 11.5,
                    fontWeight: matched ? 700 : 500,
                    borderRadius: 8,
                    border: matched ? `1px solid color-mix(in srgb, var(--sk-accent) 33%, transparent)` : '1px solid transparent',
                  }}
                >
                  {s}
                </span>
              )
            })}
            {expertSkills.length > skillsToShow.length && (
              <span style={{ fontSize: 11.5, color: 'var(--sk-faint)', alignSelf: 'center' }}>
                +{expertSkills.length - skillsToShow.length}
              </span>
            )}
          </div>
        )}

        {ai_pitch && (
          <div style={{ background: `color-mix(in srgb, var(--sk-accent) 6%, transparent)`, border: `1px solid color-mix(in srgb, var(--sk-accent) 20%, transparent)`, borderRadius: 10, padding: '10px 12px', fontSize: 12.5, color: 'var(--sk-text)', lineHeight: 1.55 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--sk-accent)', marginBottom: 4 }}>
              ✨ {t('ai_pitch_label')}
            </div>
            {ai_pitch}
          </div>
        )}

        {/* Un SEUL bandeau, dont le texte EST la raison dérivée. Avant, seuls
            'selected' et 'rejected' parlaient : une candidature archivée par
            expiration ne disait rien, ou pire gardait « Échange ouvert » en
            haut de carte. On dit toujours POURQUOI, jamais un « Archivée » nu. */}
        {showStateBanner && (
          <div style={{ display: 'inline-flex' }}>
            <span
              style={{
                padding: '5px 11px',
                background: isSelected ? 'var(--sk-amber-soft)' : isRejected ? 'var(--sk-red-soft)' : 'var(--sk-surface-2)',
                color: isSelected ? 'var(--sk-amber)' : isRejected ? 'var(--sk-red)' : 'var(--sk-muted)',
                fontSize: 11.5,
                fontWeight: 700,
                borderRadius: 999,
              }}
            >
              {isSelected ? '🏆 ' : ''}
              {lifecycleLabel(lifecycle, publicationType)}
            </span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            style={{
              background: limiteAtteinte ? 'var(--sk-amber-soft)' : 'var(--sk-red-soft)',
              border: `1px solid ${limiteAtteinte ? 'var(--sk-amber-soft)' : 'var(--sk-red-soft)'}`,
              color: limiteAtteinte ? 'var(--sk-amber)' : 'var(--sk-red)',
              padding: '9px 11px',
              borderRadius: 9,
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            {error}
            {/* Une limite d'offre n'est pas une panne : ambre plutôt que rouge,
                et l'issue qui reste quand la carte ne peut rien corriger.
                AUCUN bouton de paiement — le verrou est fermé. */}
            {limiteAtteinte && (
              <p style={{ margin: '5px 0 0', fontSize: 11.5, color: 'var(--sk-amber)' }}>
                {tCommerce('need_more_contact')}
              </p>
            )}
          </div>
        )}
      </div>

      {/* FOOTER actions */}
      <div style={{ padding: '12px 20px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* C7 : viewer = lecture seule. On masque toute action d'écriture et on
            affiche une note explicative. La garde serveur reste la garantie. */}
        {!roleLoading && !canManage && (canAct || (isUnlocked && !isClosed)) && (
          <div style={{ background: 'var(--sk-surface-2)', border: '1px solid var(--sk-border)', borderRadius: 9, padding: '9px 11px', fontSize: 12, color: 'var(--sk-muted)', textAlign: 'center' }}>
            {t('read_only_role')}
          </div>
        )}
        {/* ── MUR DE DÉVOILEMENT ────────────────────────────────────────────
            L'offre n'inclut aucun dévoilement supplémentaire (limite lue au
            catalogue, jamais écrite ici). Le mur dit ce qui bloque, et propose
            l'issue qui existe RÉELLEMENT au moment où on le lit.

            ⚠️ IL PORTAIT UN BOUTON DÉSACTIVÉ « Bientôt disponible ». Un bouton
               qu'on ne peut pas cliquer promet une porte qui n'existe pas : on
               le remplace par une ligne d'issue. Le verrou, lui, est servi par
               le SERVEUR — jamais par une variable publique — et il est FERMÉ
               par défaut : un quota illisible ne doit pas ouvrir un chemin de
               paiement. */}
        {canAct && conversionMode === 'wall' && canManage && (
          <div style={{ background: 'var(--sk-amber-soft)', border: '1.5px solid var(--sk-amber-soft)', borderRadius: 12, padding: '14px 14px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span aria-hidden style={{ fontSize: 18 }}>🔒</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--sk-amber)' }}>{t('wall_title')}</span>
            </div>
            <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--sk-amber)', lineHeight: 1.5 }}>{t('wall_body')}</p>
            <p style={{ margin: 0, fontSize: 11.5, color: 'var(--sk-amber)', lineHeight: 1.5 }}>
              {billingEnabled === true
                ? tCommerce('need_more_upgrade')
                : tCommerce('need_more_contact')}
            </p>
          </div>
        )}

        {canAct && conversionMode === 'unlock' && canManage && !confirmReject && (
          <>
            <button type="button" onClick={handleUnlock} disabled={disabled} style={{ width: '100%', padding: '12px 16px', background: 'var(--sk-accent)', color: 'var(--sk-sur-accent)', border: 'none', borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: busy === 'unlock' ? 0.6 : 1 }}>
              {busy === 'unlock' ? t('button_unlocking') : `🔓 ${t('button_unlock')}`}
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setConfirmReject(true)} disabled={disabled} style={{ flex: 1, padding: '9px 12px', background: 'var(--sk-surface)', color: 'var(--sk-muted)', border: '1px solid var(--sk-border)', borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                {t('button_reject')}
              </button>
              {isUnviewed && (
                <button type="button" onClick={() => void handleMarkViewed()} disabled={disabled} style={{ padding: '9px 12px', background: 'transparent', color: 'var(--sk-muted)', border: '1px solid var(--sk-border)', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                  {busy === 'view' ? t('mark_viewed_busy') : `✓ ${t('mark_viewed_cta')}`}
                </button>
              )}
            </div>
          </>
        )}

        {canAct && conversionMode === 'unlock' && canManage && confirmReject && (
          <div style={{ background: 'var(--sk-red-soft)', border: '1.5px solid var(--sk-red-soft)', borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--sk-red)', marginBottom: 8 }}>{t('reject_confirm_title')}</div>
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder={t('reject_reason_placeholder')} maxLength={2000} rows={3} style={{ width: '100%', padding: '8px 10px', fontSize: 12, border: '1px solid var(--sk-red-soft)', borderRadius: 8, outline: 'none', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5, marginBottom: 10 }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => { setConfirmReject(false); setRejectReason(''); setError(null); setLimiteAtteinte(false) }} disabled={disabled} style={{ padding: '7px 14px', background: 'transparent', color: 'var(--sk-muted)', border: '1px solid var(--sk-border)', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                {t('reject_cancel')}
              </button>
              <button type="button" onClick={handleReject} disabled={disabled} style={{ padding: '7px 14px', background: 'var(--sk-red)', color: 'var(--sk-sur-accent)', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: busy === 'reject' ? 0.6 : 1 }}>
                {busy === 'reject' ? t('button_rejecting') : t('reject_confirm')}
              </button>
            </div>
          </div>
        )}

        {isUnlocked && !isClosed && (
          <>
            {candidature.conversation_id && (
              <Link href={`${messagesBasePath}/messages/${candidature.conversation_id}`} style={{ width: '100%', padding: '12px 16px', background: 'var(--sk-accent)', color: 'var(--sk-sur-accent)', border: 'none', borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', textDecoration: 'none', textAlign: 'center', display: 'block', pointerEvents: disabled ? 'none' : 'auto', opacity: disabled ? 0.6 : 1 }}>
                💬 {t('conversation_button')}
              </Link>
            )}
            {canSelect && canManage && !confirmSelect && (
              <button type="button" onClick={() => setConfirmSelect(true)} disabled={disabled} style={{ width: '100%', padding: '9px 14px', background: 'var(--sk-surface)', color: 'var(--sk-amber)', border: '1.5px solid var(--sk-amber)', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                🏆 {t('button_select')}
              </button>
            )}
            {canSelect && canManage && confirmSelect && (
              <div style={{ background: 'var(--sk-amber-soft)', border: '1.5px solid var(--sk-amber)', borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--sk-amber)', marginBottom: 5 }}>{t('select_confirm_title')}</div>
                <div style={{ fontSize: 12, color: 'var(--sk-amber)', lineHeight: 1.5, marginBottom: 10 }}>
                  {t(publicationType === 'mission' ? 'select_confirm_body_mission' : 'select_confirm_body_offre')}
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => { setConfirmSelect(false); setError(null); setLimiteAtteinte(false) }} disabled={disabled} style={{ padding: '7px 11px', background: 'transparent', color: 'var(--sk-amber)', border: '1px solid var(--sk-amber-soft)', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                    {t('select_cancel')}
                  </button>
                  <button type="button" onClick={handleSelect} disabled={disabled} style={{ padding: '7px 11px', background: 'var(--sk-amber)', color: 'var(--sk-sur-accent)', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: busy === 'select' ? 0.6 : 1 }}>
                    {busy === 'select' ? t('button_selecting') : t('select_confirm')}
                  </button>
                </div>
              </div>
            )}
            {isUnviewed && (
              <button type="button" onClick={() => void handleMarkViewed()} disabled={disabled} style={{ padding: '7px 11px', background: 'transparent', color: 'var(--sk-muted)', border: '1px solid var(--sk-border)', borderRadius: 9, fontSize: 11.5, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', alignSelf: 'flex-end' }}>
                {busy === 'view' ? t('mark_viewed_busy') : `✓ ${t('mark_viewed_cta')}`}
              </button>
            )}
          </>
        )}
      </div>
    </article>
  )
}
