'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useRelativeTime } from '@/lib/use-relative-time'
import { useState } from 'react'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'
import { useMarkCandidatureViewed } from '@/lib/candidature-view-client'
import type { CandidatureLifecycle } from '@/lib/candidatures/lifecycle'
import { useCandidatureLifecycleLabel } from '@/lib/candidatures/use-lifecycle-label'

/**
 * Carte de candidature côté ORG (Lot 2c).
 *
 * États visuels :
 *  - 'received' / 'in_review' / 'shortlisted' :
 *      preview masquée (anonymisée) + boutons Accepter l'échange / Refuser
 *  - 'unlocked' :
 *      profil COMPLET (identité, contact, détails) + badge « Échange ouvert »
 *      + lien désactivé « Conversation (Lot 3 — bientôt) »
 *  - 'rejected' :
 *      carte fanée + badge refus + status_reason si présent (jamais d'actions)
 *  - 'withdrawn' / 'archived' :
 *      carte fanée informative
 *
 * La carte ne fait pas elle-même le fetch initial — elle reçoit les données du
 * parent et déclenche les mutations via secureFetch. Le parent re-fetche après
 * mutation pour rafraîchir la liste.
 */

export type CandidatureUnlockedProfile = {
  /**
   * Nom à afficher côté ORG.
   *  - Pré-unlock (rappel : ce type n'est PAS utilisé pré-unlock — `unlocked_profile`
   *    est `null` à ce stade).
   *  - Post-unlock (status ∈ unlocked|selected) : nom COMPLET `{first_name} {last_name}`
   *    selon DisclosurePolicy.reveal_full_name (V1 = true en post-unlock).
   *
   * Le navigateur de l'org ne reçoit jamais email / phone / cv / linkedin
   * (`reveal_contact: false` en V1, jamais branché). Le canal de contact
   * reste la messagerie interne.
   */
  display_name: string
  /**
   * URL publique de la photo de profil expert (Lot grille photo-forward).
   * Servie UNIQUEMENT si DisclosurePolicy.reveal_photo === true côté serveur,
   * sinon `null`. La grille front affichera un placeholder cadenas si null.
   */
  photo_url: string | null
  title: string | null
  summary: string | null
  skills: string[]
  seniorities: string[]
  expert_type: string | null
  years_experience: number | null
  years_total_experience: number | null
  tjm_min: number | null
  tjm_max: number | null
  salary_min: number | null
  salary_max: number | null
  work_modes: string[]
  languages: string[]
  country: string | null
  city: string | null
  availability_status: string | null
  availability_date: string | null
  profile_score: number | null
}

export type CandidaturePreview = {
  title: string | null
  summary: string | null
  skills: string[]
  seniorities: string[]
  expert_type: string | null
  years_experience: number | null
  years_total_experience: number | null
  tjm_min: number | null
  tjm_max: number | null
  salary_min: number | null
  salary_max: number | null
  work_modes: string[]
  languages: string[]
  country: string | null
  city: string | null
  availability_status: string | null
  availability_date: string | null
  profile_score: number | null
  branch_label: string | null
  speciality_labels: string[]
  /** Lot synthèse candidat CDI — 6 signaux non-PII. Affichés uniquement
   *  quand publicationType === 'offre'. Null/[] pour les candidatures
   *  legacy (avant le lot — cf. backfill). */
  cdi_status: string | null
  cdi_notice_period: string | null
  cdi_geo_mobility: string | null
  cdi_contract_types: string[]
  cdi_company_size: string[]
  cdi_sectors: string[]
}

export type CandidatureData = {
  id: string
  profile_id: string
  status: string
  status_reason: string | null
  unlocked_at: string | null
  cover_message: string | null
  ai_match_score: number | null
  created_at: string
  conversation_id: string | null
  ai_pitch: string | null
  preview: CandidaturePreview
  unlocked_profile: CandidatureUnlockedProfile | null
  /**
   * Lot bascule badges par item : true si cet user org a déjà consulté la
   * candidature (candidature_views.viewed_at >= candidatures.updated_at).
   * Optionnel pour rétro-compat avec call-sites qui ne le passent pas encore.
   */
  viewed_by_me?: boolean
  /**
   * État de vie DÉRIVÉ SERVEUR (lib/candidatures/lifecycle.ts, servi par
   * lib/candidature-org-dto). MÊME fait que côté expert, point de vue org.
   * Source unique du libellé d'état et de la teinte de la pastille.
   */
  lifecycle?: CandidatureLifecycle | null
}

type Props = {
  candidature: CandidatureData
  publicationType: string                 // 'mission' | 'offre'
  onMutated: () => void                   // re-fetch parent
}

function formatRate(min: number | null, max: number | null, unit: string): string {
  if (min == null && max == null) return ''
  if (min != null && max != null) return `${Math.round(min)}-${Math.round(max)}€${unit}`
  if (min != null) return `${Math.round(min)}€${unit}`
  return `${Math.round(max!)}€${unit}`
}

function scoreColor(score: number, domainPrimary: string): string {
  if (score >= 9) return 'var(--sk-success)'
  if (score >= 7) return domainPrimary
  if (score >= 5) return 'var(--sk-amber)'
  return 'var(--sk-faint)'
}

export default function CandidatureCard({ candidature, publicationType, onMutated }: Props) {
  const t = useTranslations('candidatures.card')
  // Lot synthèse candidat CDI : on réutilise les libellés cdi_profile_view
  // (cdi_status_options, contract_types_options, notice_period_options,
  // geo_mobility_options) pour ne pas dupliquer les valeurs en i18n.
  const tCdi = useTranslations('cdi_profile_view')
  const tPub = useTranslations('publications')
  const tCommerce = useTranslations('commerce')
  // SITE DE RENDU 4/5 — libellé d'état par la RAISON dérivée, point de vue org.
  const lifecycleLabel = useCandidatureLifecycleLabel('org')
  const locale = useLocale()
  const relTime = useRelativeTime()
  const secureFetch = useSecureFetch()

  const [busy, setBusy] = useState<'unlock' | 'reject' | 'select' | 'view' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Une limite d’offre n’est pas une panne : la ligne d’issue est portée à part,
  // pour ne pas recopier l’appel à l’action dans chaque message (jumeau de
  // SpotlightCandidateCard — ce composant l’avait oublié, §E.34).
  const [limiteAtteinte, setLimiteAtteinte] = useState(false)
  const [confirmReject, setConfirmReject] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  // Lot état 'selected' : confirmation explicite avant l'action irréversible.
  const [confirmSelect, setConfirmSelect] = useState(false)
  // Lot bascule badges par item (micro-fix) : override OPTIMISTE de
  // `viewed_by_me`. Posé à true au succès de handleMarkViewed / unlock /
  // reject / select → la pill "Nouveau" + la bordure accent disparaissent
  // INSTANTANÉMENT sans attendre un re-fetch global. Quand le parent
  // reload finira par renvoyer viewed_by_me=true, le merge ci-dessous
  // converge (override OU prop). Pas de désync possible : on n'autorise
  // jamais le passage true → false côté optimiste.
  const [viewedOptimistic, setViewedOptimistic] = useState(false)

  const { status, preview, unlocked_profile, ai_match_score, cover_message, created_at, status_reason, ai_pitch, viewed_by_me, lifecycle } = candidature
  const isUnlocked = status === 'unlocked'
  const isSelected = status === 'selected'
  const isRejected = status === 'rejected'
  // « Close » = ARCHIVÉE au sens état de vie (refus, retrait, mais aussi
  // fenêtre d'échange écoulée ou annonce expirée) : c'est ce qui décide de
  // la carte fanée et de la disparition des actions. Repli sur les statuts
  // terminaux si le DTO ne porte pas encore de lifecycle.
  const isClosed = lifecycle
    ? lifecycle.bucket === 'archived'
    : isRejected || status === 'withdrawn' || status === 'archived'
  // Agir suppose une candidature encore vivante : on ne débloque pas une
  // candidature dont l'annonce a expiré.
  const canAct = !isClosed && (status === 'received' || status === 'in_review' || status === 'shortlisted')
  const statusTone = ((): { bg: string; fg: string } => {
    switch (lifecycle?.reason) {
      case 'selected':        return { bg: 'var(--sk-amber-soft)', fg: 'var(--sk-amber)' }
      case 'exchange_open':   return { bg: 'var(--sk-success-soft)', fg: 'var(--sk-success)' }
      case 'rejected':        return { bg: 'var(--sk-red-soft)', fg: 'var(--sk-red)' }
      default:                return { bg: 'var(--sk-surface-2)', fg: 'var(--sk-muted)' }
    }
  })()
  // Bouton "Accepter" : visible UNIQUEMENT en 'unlocked' (l'org a déjà
  // débloqué le profil et discuté). Côté serveur, la transition autorisée
  // est aussi restreinte à ['unlocked'] (cf. /api/candidatures/[id]/select).
  const canSelect = isUnlocked && !isClosed
  // Lot bascule badges par item : pill + bouton "Marquer comme vue" tant
  // que l'org n'a pas (a) consulté explicitement via le bouton, OU (b) agi
  // via unlock/reject/select (auto-mark serveur).
  // Merge override optimiste ↑ avec prop serveur — true gagne toujours.
  const isViewed = viewedOptimistic || viewed_by_me === true
  const isUnviewed = !isViewed && viewed_by_me === false
  const markCandidatureViewed = useMarkCandidatureViewed()

  const rateUnit = publicationType === 'mission'
    ? tPub('budget_unit.day')
    : tPub('budget_unit.year')
  const rateText = publicationType === 'mission'
    ? formatRate(preview.tjm_min, preview.tjm_max, rateUnit)
    : formatRate(preview.salary_min, preview.salary_max, rateUnit)

  const handleUnlock = async () => {
    setBusy('unlock')
    setError(null)
    setLimiteAtteinte(false)
    try {
      const res = await secureFetch(`/api/candidatures/${candidature.id}/unlock`, { method: 'POST' })
      const payload = (await res.json().catch(() => ({} as { code?: string }))) as { code?: string }
      if (!res.ok) {
        // `candidature_archived` : l'annonce a atteint sa fin de vie pendant
        // que la page était ouverte. Le bouton disparaît au prochain rendu ;
        // ce message explique le clic déjà émis, plutôt qu'« erreur ».
        if (payload.code === 'candidature_archived') setError(t('error_candidature_archived'))
        else if (payload.code === 'invalid_transition') setError(t('error_invalid_transition'))
        else if (payload.code === 'not_found') setError(t('error_not_found'))
        else if (payload.code === 'unlock_limit_reached') {
          // Le serveur NOMME la cause (402) : l’organisation a épuisé ses
          // dévoilements inclus. Elle lisait « une erreur est survenue ».
          setError(t('error_unlock_limit_reached'))
          setLimiteAtteinte(true)
        } else setError(t('error_generic'))
        return
      }
      // Auto-mark vu côté serveur (route unlock) + optimiste côté UI :
      // pill + bordure accent disparaissent instantanément.
      setViewedOptimistic(true)
      onMutated()
    } catch (err) {
      console.error('[candidature unlock] threw', err)
      setError(t('error_generic'))
    } finally {
      setBusy(null)
    }
  }

  const handleMarkViewed = async () => {
    if (busy) return
    setBusy('view')
    setError(null)
    try {
      await markCandidatureViewed(candidature.id)
      // Pas de onMutated() : on évite un re-fetch global juste pour ça.
      // Le badge se décrémente via skilloria:notif-bump dispatché par le hook.
      // Override local optimiste → pill + bordure accent disparaissent instantanément.
      setViewedOptimistic(true)
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
      // Auto-mark vu côté serveur (route select) + optimiste côté UI.
      setViewedOptimistic(true)
      onMutated()
    } catch (err) {
      console.error('[candidature select] threw', err)
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
      // Auto-mark vu côté serveur (route reject) + optimiste côté UI.
      setViewedOptimistic(true)
      onMutated()
    } catch (err) {
      console.error('[candidature reject] threw', err)
      setError(t('error_generic'))
    } finally {
      setBusy(null)
      setConfirmReject(false)
    }
  }

  // ── Display name : anonyme avant unlock, NOM COMPLET après ─────────────
  //
  // ⚠️ CE COMMENTAIRE A ÉTÉ FAUX. Il affirmait que le serveur fournit ici un
  // `display_name` « déjà pseudonymisé ». Ce n'est plus vrai depuis le lot de
  // re-masquage : `buildOrgCandidatureDTOs` ne charge le profil complet QUE
  // si la candidature est déverrouillée ET encore active, cas dans lequel la
  // policy autorise le nom complet. Sur toute autre candidature,
  // `unlocked_profile` vaut `null` et l'on affiche « Candidat anonyme ».
  // Le CODE MASQUÉ (« YCH ») n'apparaît donc JAMAIS sur cette carte — il est
  // réservé aux surfaces messagerie et notifications.
  // Un commentaire qui ment sur une règle de sécurité est pire que pas de
  // commentaire : il fait prendre une décision sur une prémisse fausse.
  //
  // Ce qui reste vrai : le navigateur ne reçoit jamais
  // civility/email/phone/cv — aucune reconstruction possible côté client.
  const displayName = isUnlocked && unlocked_profile
    ? unlocked_profile.display_name || t('candidate_label')
    : t('anonymous_candidate')

  return (
    <article
      style={{
        background: 'var(--sk-surface)',
        // Lot bascule badges par item : accent border si non consultée
        // (et pas fermée). Cohérent avec MissionCard.
        border: isUnlocked || (isUnviewed && !isClosed)
          ? `1.5px solid var(--sk-accent)`
          : '0.5px solid var(--sk-border)',
        borderRadius: 14,
        padding: '18px 20px',
        opacity: isClosed ? 0.65 : 1,
        transition: 'opacity .15s, box-shadow .2s',
      }}
    >
      {/* Header : avatar (initiale du pseudo) + nom + score + status badge.
          Lot masquage : JAMAIS de photo de l'expert côté org. L'avatar est
          toujours l'initiale (du pseudo post-unlock, '?' avant). */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--sk-surface-2)', color: 'var(--sk-faint)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 600, flexShrink: 0 }}>
            {isUnlocked && unlocked_profile?.display_name ? unlocked_profile.display_name[0]?.toUpperCase() ?? '?' : '?'}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--sk-text)', marginBottom: 2, lineHeight: 1.35 }}>
              {displayName}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--sk-muted)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {preview.title && <span>{preview.title}</span>}
              {preview.seniorities.length > 0 && (<><span aria-hidden>·</span><span>{preview.seniorities.join(', ')}</span></>)}
              {(preview.years_experience ?? preview.years_total_experience) != null && (
                <><span aria-hidden>·</span><span>{t('years_experience', { years: preview.years_experience ?? preview.years_total_experience ?? 0 })}</span></>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          {ai_match_score != null && (
            <span
              title={t('ai_score_tooltip')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                background: `${scoreColor(ai_match_score, 'var(--sk-accent)')}1A`,
                color: scoreColor(ai_match_score, 'var(--sk-accent)'),
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 12,
              }}
            >
              <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: scoreColor(ai_match_score, 'var(--sk-accent)') }} />
              {t('ai_score', { score: Math.round(ai_match_score) })}
            </span>
          )}
          <span
            style={{
              padding: '3px 9px',
              // Teinte dérivée de la RAISON : un « Échange ouvert » vert ne
              // peut plus survivre à sa fenêtre (raison → exchange_expired
              // → gris). Repli neutre si le DTO n'a pas de lifecycle.
              background: statusTone.bg,
              color: statusTone.fg,
              fontSize: 10,
              fontWeight: 600,
              borderRadius: 10,
              textTransform: 'uppercase',
              letterSpacing: '.05em',
            }}
          >
            {lifecycleLabel(lifecycle, publicationType)}
          </span>
          {/* Lot bascule badges par item : pill "Nouveau" + bouton "Marquer
              comme vue" pour les candidatures non consultées par cet user. */}
          {isUnviewed && !isClosed && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--sk-accent)',
                textTransform: 'uppercase',
                letterSpacing: '.05em',
              }}
            >
              {t('new_label')}
            </span>
          )}
        </div>
      </div>

      {/* Méta : ville / pays / disponibilité (preview) */}
      <div style={{ fontSize: 12, color: 'var(--sk-muted)', marginBottom: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(preview.city ?? preview.country) && (
          <span>📍 {[preview.city, preview.country].filter(Boolean).join(', ')}</span>
        )}
        {rateText && (<><span aria-hidden>·</span><span>{rateText}</span></>)}
        {preview.availability_status && (
          <><span aria-hidden>·</span><span>{t(`availability.${preview.availability_status}` as 'availability.immediate', {} as never)}</span></>
        )}
        <span aria-hidden>·</span>
        <span title={created_at}>{t('candidated_ago', { time: relTime(created_at) })}</span>
      </div>

      {/* Compétences */}
      {preview.skills.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {preview.skills.slice(0, 12).map((s) => (
            <span key={s} style={{ background: 'var(--sk-surface-2)', color: 'var(--sk-muted)', padding: '3px 9px', borderRadius: 10, fontSize: 11, fontWeight: 500 }}>{s}</span>
          ))}
          {preview.skills.length > 12 && (
            <span style={{ color: 'var(--sk-faint)', fontSize: 11 }}>+{preview.skills.length - 12}</span>
          )}
        </div>
      )}

      {/* Lot synthèse candidat CDI — bloc "Préférences CDI" affiché UNIQUEMENT
          quand l'annonce est une offre CDI (publicationType==='offre'). Données
          non-PII issues du snapshot preview (cf. whitelist server-side). */}
      {publicationType === 'offre' && (
        (preview.cdi_status ||
          preview.cdi_notice_period ||
          preview.cdi_geo_mobility ||
          (preview.cdi_contract_types?.length ?? 0) > 0 ||
          (preview.cdi_company_size?.length ?? 0) > 0 ||
          (preview.cdi_sectors?.length ?? 0) > 0) && (
          <div
            style={{
              background: 'var(--sk-surface-2)',
              border: '1px solid var(--sk-border)',
              borderRadius: 10,
              padding: '10px 12px',
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--sk-faint)', marginBottom: 6 }}>
              {t('cdi_preferences_label')}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {preview.cdi_status && (
                <span style={{ background: 'var(--sk-surface)', border: '1px solid var(--sk-border)', color: 'var(--sk-text)', padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 500 }}>
                  {(() => { try { return tCdi(`cdi_status_options.${preview.cdi_status}` as 'cdi_status_options.open_to_work') } catch { return preview.cdi_status } })()}
                </span>
              )}
              {preview.cdi_notice_period && (
                <span style={{ background: 'var(--sk-surface)', border: '1px solid var(--sk-border)', color: 'var(--sk-text)', padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 500 }}>
                  {(() => { try { return tCdi(`notice_period_options.${preview.cdi_notice_period}` as 'notice_period_options.immediate') } catch { return preview.cdi_notice_period } })()}
                </span>
              )}
              {preview.cdi_geo_mobility && (
                <span style={{ background: 'var(--sk-surface)', border: '1px solid var(--sk-border)', color: 'var(--sk-text)', padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 500 }}>
                  {(() => { try { return tCdi(`geo_mobility_options.${preview.cdi_geo_mobility}` as 'geo_mobility_options.local') } catch { return preview.cdi_geo_mobility } })()}
                </span>
              )}
              {(preview.cdi_contract_types ?? []).map((ct) => (
                <span key={`ct-${ct}`} style={{ background: 'var(--sk-surface)', border: '1px solid var(--sk-border)', color: 'var(--sk-text)', padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 500 }}>
                  {(() => { try { return tCdi(`contract_types_options.${ct}` as 'contract_types_options.cdi') } catch { return ct } })()}
                </span>
              ))}
              {(preview.cdi_company_size ?? []).map((cs) => (
                <span key={`cs-${cs}`} style={{ background: 'var(--sk-surface)', border: '1px solid var(--sk-border)', color: 'var(--sk-muted)', padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 500 }}>
                  {cs}
                </span>
              ))}
              {(preview.cdi_sectors ?? []).map((s) => (
                <span key={`sec-${s}`} style={{ background: 'var(--sk-surface)', border: '1px solid var(--sk-border)', color: 'var(--sk-muted)', padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 500 }}>
                  {s}
                </span>
              ))}
            </div>
          </div>
        )
      )}

      {/* Pitch IA orienté org (Lot finitions UX Point 2) — affiché en haut
          comme accroche. Si absent (matchs legacy), fallback discret sur
          preview.summary tronqué. Toujours sans PII (whitelist côté IA). */}
      {ai_pitch ? (
        <div
          style={{
            background: `color-mix(in srgb, var(--sk-accent) 6%, transparent)`,
            border: `1px solid color-mix(in srgb, var(--sk-accent) 20%, transparent)`,
            borderRadius: 10,
            padding: '11px 14px',
            fontSize: 13,
            color: 'var(--sk-text)',
            lineHeight: 1.55,
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--sk-accent)', marginBottom: 5 }}>
            ✨ {t('ai_pitch_label')}
          </div>
          {ai_pitch}
        </div>
      ) : preview.summary && (
        <p style={{ fontSize: 13, color: 'var(--sk-muted)', lineHeight: 1.5, margin: '0 0 12px 0' }}>
          {preview.summary.length > 220 ? `${preview.summary.slice(0, 220)}…` : preview.summary}
        </p>
      )}

      {/* Cover message expert */}
      {cover_message && (
        <div style={{ background: `color-mix(in srgb, var(--sk-accent) 4%, transparent)`, border: `1px solid color-mix(in srgb, var(--sk-accent) 13%, transparent)`, borderRadius: 10, padding: '10px 12px', fontSize: 12, color: 'var(--sk-muted)', lineHeight: 1.55, marginBottom: 12, whiteSpace: 'pre-wrap' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--sk-accent)', marginBottom: 4 }}>
            {t('cover_message_label')}
          </div>
          {cover_message}
        </div>
      )}

      {/* PROFIL COMPLET (post-unlock) — affiché aussi en 'selected' (l'org
          conserve l'accès au profil débloqué après avoir retenu le candidat). */}
      {(isUnlocked || isSelected) && unlocked_profile && (
        <div
          style={{
            background: isSelected ? 'color-mix(in srgb, var(--sk-amber-soft) 19%, transparent)' : 'color-mix(in srgb, var(--sk-success-soft) 19%, transparent)',
            border: `1px solid ${isSelected ? 'var(--sk-amber-soft)' : 'var(--sk-success-soft)'}`,
            borderRadius: 12,
            padding: '14px 16px',
            marginBottom: 12,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '.06em',
              color: isSelected ? 'var(--sk-amber)' : 'var(--sk-success)',
              marginBottom: 10,
            }}
          >
            {isSelected
              ? `🏆 ${t(publicationType === 'mission' ? 'selected_section_label_mission' : 'selected_section_label_offre')}`
              : `✓ ${t('unlocked_section_label')}`}
          </div>
          {/* Lot masquage : aucune coordonnée personnelle. Le seul canal de
              contact est la conversation interne. Email/téléphone/CV/LinkedIn/
              adresse NE PARTENT PLUS dans le payload serveur (cf.
              lib/candidature-org-dto.ts). */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {candidature.conversation_id ? (
              <Link
                href={`/dashboard/entreprise/messages/${candidature.conversation_id}`}
                style={{
                  display: 'inline-block',
                  padding: '8px 14px',
                  background: 'var(--sk-accent)',
                  color: 'var(--sk-sur-accent)',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textDecoration: 'none',
                }}
              >
                💬 {t('conversation_button')}
              </Link>
            ) : (
              <button
                type="button"
                disabled
                title={t('conversation_unavailable_tooltip')}
                style={{
                  padding: '8px 14px',
                  background: 'var(--sk-surface)',
                  color: 'var(--sk-faint)',
                  border: '1px solid var(--sk-border)',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'not-allowed',
                  fontFamily: 'inherit',
                }}
              >
                💬 {t('conversation_button')}
              </button>
            )}

            {/* Bouton "Accepter ce candidat" — UNIQUEMENT en 'unlocked'.
                Action IRRÉVERSIBLE → demande de confirmation explicite. */}
            {canSelect && !confirmSelect && (
              <button
                type="button"
                onClick={() => setConfirmSelect(true)}
                disabled={busy !== null}
                style={{
                  padding: '8px 14px',
                  background: 'var(--sk-surface)',
                  color: 'var(--sk-amber)',
                  border: '1.5px solid var(--sk-amber)',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                🏆 {t('button_select')}
              </button>
            )}
          </div>

          {/* Bandeau de confirmation "Accepter" — explicite que c'est définitif. */}
          {canSelect && confirmSelect && (
            <div
              role="alertdialog"
              aria-label={t('select_confirm_title')}
              style={{
                marginTop: 12,
                background: 'var(--sk-amber-soft)',
                border: '1.5px solid var(--sk-amber)',
                borderRadius: 10,
                padding: '12px 14px',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--sk-amber)', marginBottom: 6 }}>
                {t('select_confirm_title')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--sk-amber)', lineHeight: 1.55, marginBottom: 12 }}>
                {t(publicationType === 'mission' ? 'select_confirm_body_mission' : 'select_confirm_body_offre')}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => { setConfirmSelect(false); setError(null) }}
                  disabled={busy !== null}
                  style={{ padding: '8px 14px', background: 'transparent', color: 'var(--sk-amber)', border: '1px solid var(--sk-amber-soft)', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                >
                  {t('select_cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleSelect}
                  disabled={busy !== null}
                  style={{
                    padding: '8px 14px',
                    background: 'var(--sk-amber)',
                    color: 'var(--sk-sur-accent)',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: busy ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                    opacity: busy === 'select' ? 0.6 : 1,
                  }}
                >
                  {busy === 'select' ? t('button_selecting') : t('select_confirm')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Refus : raison */}
      {isRejected && status_reason && (
        <div style={{ background: 'var(--sk-red-soft)', border: '1px solid var(--sk-red-soft)', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: 'var(--sk-red)', lineHeight: 1.5, marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--sk-red)', marginBottom: 4 }}>
            {t('rejection_reason_label')}
          </div>
          {status_reason}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          style={{
            background: limiteAtteinte ? 'var(--sk-amber-soft)' : 'var(--sk-red-soft)',
            border: `1px solid ${limiteAtteinte ? 'var(--sk-amber-soft)' : 'var(--sk-red-soft)'}`,
            color: limiteAtteinte ? 'var(--sk-amber)' : 'var(--sk-red)',
            padding: '10px 12px',
            borderRadius: 10,
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          {error}
          {/* Ambre plutôt que rouge, et l’issue qui reste quand la carte ne peut
              rien corriger. AUCUN bouton de paiement — le verrou est fermé (§D.1). */}
          {limiteAtteinte && (
            <p style={{ margin: '5px 0 0', fontSize: 11.5, color: 'var(--sk-amber)' }}>
              {tCommerce('need_more_contact')}
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      {/* Lot bascule badges par item : bouton "Marquer comme vue" — ghost
          style, visible UNIQUEMENT si la candidature n'a pas encore été
          consultée par cet user ET qu'elle n'est pas dans un état terminal.
          Les actions métier (Accepter/Refuser) auto-marquent côté
          serveur via markCandidatureViewedServerSide → ce bouton sert au
          cas où l'org veut acquitter SANS prendre de décision tout de suite. */}
      {isUnviewed && !isClosed && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: canAct || canSelect ? 8 : 0 }}>
          <button
            type="button"
            onClick={() => void handleMarkViewed()}
            disabled={busy !== null}
            style={{
              padding: '6px 12px',
              background: 'transparent',
              color: 'var(--sk-muted)',
              border: '1px solid var(--sk-border)',
              borderRadius: 8,
              fontSize: 11.5,
              fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              opacity: busy === 'view' ? 0.6 : 1,
            }}
          >
            {busy === 'view' ? t('mark_viewed_busy') : `✓ ${t('mark_viewed_cta')}`}
          </button>
        </div>
      )}

      {canAct && !confirmReject && (
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => setConfirmReject(true)}
            disabled={busy !== null}
            style={{
              padding: '9px 16px',
              background: 'transparent',
              color: 'var(--sk-muted)',
              border: '1px solid var(--sk-border)',
              borderRadius: 9,
              fontSize: 12,
              fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('button_reject')}
          </button>
          <button
            type="button"
            onClick={handleUnlock}
            disabled={busy !== null}
            style={{
              padding: '9px 18px',
              background: 'var(--sk-accent)',
              color: 'var(--sk-sur-accent)',
              border: 'none',
              borderRadius: 9,
              fontSize: 12,
              fontWeight: 700,
              cursor: busy ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              opacity: busy === 'unlock' ? 0.6 : 1,
            }}
          >
            {busy === 'unlock' ? t('button_unlocking') : t('button_unlock')}
          </button>
        </div>
      )}

      {/* Confirm reject inline form */}
      {canAct && confirmReject && (
        <div style={{ background: 'var(--sk-red-soft)', border: '1.5px solid var(--sk-red-soft)', borderRadius: 10, padding: '14px 16px', marginTop: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sk-red)', marginBottom: 8 }}>{t('reject_confirm_title')}</div>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder={t('reject_reason_placeholder')}
            maxLength={2000}
            rows={3}
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: 12,
              border: '1px solid var(--sk-red-soft)',
              borderRadius: 8,
              outline: 'none',
              fontFamily: 'inherit',
              resize: 'vertical',
              boxSizing: 'border-box',
              lineHeight: 1.5,
              marginBottom: 10,
            }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => { setConfirmReject(false); setRejectReason(''); setError(null) }}
              disabled={busy !== null}
              style={{ padding: '8px 14px', background: 'transparent', color: 'var(--sk-muted)', border: '1px solid var(--sk-border)', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
            >
              {t('reject_cancel')}
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={busy !== null}
              style={{ padding: '8px 14px', background: 'var(--sk-red)', color: 'var(--sk-sur-accent)', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: busy === 'reject' ? 0.6 : 1 }}
            >
              {busy === 'reject' ? t('button_rejecting') : t('reject_confirm')}
            </button>
          </div>
        </div>
      )}
    </article>
  )
}
