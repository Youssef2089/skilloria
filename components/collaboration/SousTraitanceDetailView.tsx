'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch } from '@/lib/secure-fetch'
import { type CandidatureData } from '@/components/dashboard/CandidatureCard'
import CastingCarousel from '@/components/dashboard/CastingCarousel'

/**
 * SousTraitanceDetailView — DÉTAIL d'un besoin de sous-traitance + candidatures
 * reçues (page de DÉTAIL → bouton Retour global fourni par la coquille).
 *
 * RÉUTILISE la chaîne de divulgation SANS duplication :
 *   - GET /api/publications/[id]            → rappel du besoin (owner-scoped)
 *   - GET /api/publications/[id]/candidatures → DTO masqué/dévoilé (service_role)
 *   - <CastingCarousel> → mêmes cartes candidat que l'org (masquage porté
 *     serveur). Le meilleur candidat est auto-dévoilé (nom + photo). Le contact
 *     (email/tél) n'est JAMAIS exposé (reveal_contact:false).
 *   - GET /api/me/collaboration/quota → droits de l'offre.
 *
 * ┌─ MUR DE DÉVOILEMENT : DÉRIVÉ DU CATALOGUE, PLUS CODÉ EN DUR ────────────┐
 * │ `conversionMode` était un littéral 'wall' : porter                       │
 * │ manual_unlocks_per_month de 0 à 3 dans le back-office ne changeait RIEN  │
 * │ pour l'expert. La règle était écrite deux fois et c'est le code qui      │
 * │ gagnait. Elle est désormais lue une seule fois, au catalogue :           │
 * │   limite = 0  → mur « Bientôt disponible »                               │
 * │   sinon       → bouton « Débloquer » actif                               │
 * │ L'UI n'est QUE de l'affichage : le refus fait autorité côté serveur      │
 * │ (candidatures/[id]/unlock → 402 unlock_limit_reached).                   │
 * └────────────────────────────────────────────────────────────────────────┘
 *   - Lien conversation → /dashboard/{role}/messages (messagesBasePath), fenêtre
 *     15 j de la messagerie interne — INDÉPENDANTE de la clôture.
 *
 * CLÔTURE (A1) : published → archived via POST /api/publications/[id]/close.
 * Confirmation explicite ; libère le quota ; candidatures + conversations
 * restent consultables.
 *
 * `basePath` = '/dashboard/freelance' | '/dashboard/cdi'.
 */

type PublicationDetail = {
  id: string
  type: string
  title: string
  description: string
  skills_required: string[]
  seniority: string | null
  location: string | null
  work_mode: string | null
  duration: string | null
  budget_min: number | null
  budget_max: number | null
  status: string
}

type BucketCounts = { active: number; archived: number }
type BucketKey = 'active' | 'archived'
type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; publication: PublicationDetail; candidatures: CandidatureData[]; counts: BucketCounts }

type Props = { basePath: string; params: Promise<{ id: string }> }

export default function SousTraitanceDetailView({ basePath, params }: Props) {
  const t = useTranslations('collaboration.detail')
  const tClose = useTranslations('collaboration.close')
  const tPub = useTranslations('publications')
  const tLifecycle = useTranslations('candidature_lifecycle')
  const locale = useLocale()
  const router = useRouter()
  const domain = useDomain()
  const secureFetch = useSecureFetch()

  const [pubId, setPubId] = useState<string | null>(null)
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [confirmClose, setConfirmClose] = useState(false)
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)
  // Actives / Archivées : l'expert publiant est ici DONNEUR D'ORDRE — il voit
  // ses candidats reçus, exactement comme une org. Mêmes buckets, même défaut,
  // même helper serveur : aucun miroir partiel.
  const [bucket, setBucket] = useState<BucketKey>('active')
  // Droits de l'offre. `null` tant que non lu : on garde alors le mur (posture
  // prudente — on ne propose jamais une action que l'offre pourrait refuser).
  const [canUnlockManually, setCanUnlockManually] = useState<boolean | null>(null)

  const load = useCallback(async (id: string) => {
    setState({ kind: 'loading' })
    try {
      const [pubRes, candRes, quotaRes] = await Promise.all([
        secureFetch(`/api/publications/${id}`, { method: 'GET' }),
        secureFetch(`/api/publications/${id}/candidatures?locale=${encodeURIComponent(locale)}&filter=${bucket}`, { method: 'GET' }),
        secureFetch('/api/me/collaboration/quota', { method: 'GET' }),
      ])
      // Best-effort : un quota illisible n'empêche pas d'afficher le besoin.
      if (quotaRes.ok) {
        const q = (await quotaRes.json().catch(() => null)) as { canUnlockManually?: boolean } | null
        setCanUnlockManually(q?.canUnlockManually ?? null)
      } else {
        setCanUnlockManually(null)
      }
      const pubPayload = (await pubRes.json().catch(() => ({}))) as { code?: string; publication?: PublicationDetail }
      if (!pubRes.ok || !pubPayload.publication) {
        setState({ kind: 'error', message: pubPayload.code === 'not_found' ? t('error_not_found') : t('error_generic') })
        return
      }
      const candPayload = (await candRes.json().catch(() => ({}))) as {
        candidatures?: CandidatureData[]
        counts?: BucketCounts
      }
      setState({
        kind: 'ready',
        publication: pubPayload.publication,
        candidatures: candRes.ok ? (candPayload.candidatures ?? []) : [],
        counts: (candRes.ok ? candPayload.counts : null) ?? { active: 0, archived: 0 },
      })
    } catch {
      setState({ kind: 'error', message: t('error_generic') })
    }
  }, [secureFetch, locale, t, bucket])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const p = await params
      if (cancelled) return
      setPubId(p.id)
      void load(p.id)
    })()
    return () => { cancelled = true }
  }, [params, load])

  const refresh = useCallback(() => { if (pubId) void load(pubId) }, [pubId, load])

  const doClose = useCallback(async () => {
    if (!pubId) return
    setClosing(true)
    setCloseError(null)
    try {
      const res = await secureFetch(`/api/publications/${pubId}/close`, { method: 'POST' })
      if (!res.ok) { setCloseError(tClose('error')); return }
      setConfirmClose(false)
      void load(pubId)
    } catch {
      setCloseError(tClose('error'))
    } finally {
      setClosing(false)
    }
  }, [pubId, secureFetch, tClose, load])

  if (state.kind === 'loading') {
    return <div style={{ padding: 48, textAlign: 'center', color: 'var(--sk-muted)' }}>{t('loading')}</div>
  }
  if (state.kind === 'error') {
    return (
      // Bouton de RÉCUPÉRATION, pas de navigation : sur un lien profond ou un
      // rechargement en erreur, la pile de NavHistory n'a pas de cible et le
      // <GlobalBackButton> ne s'affiche pas — sans celui-ci l'utilisateur
      // resterait bloqué sur l'écran d'erreur. Même motif qu'admin/experts/[id].
      // Le rendu NORMAL, lui, ne porte aucun bouton Retour local (règle projet).
      <div style={{ maxWidth: 560, margin: '60px auto', padding: '0 24px', textAlign: 'center' }}>
        <p style={{ fontSize: 14, color: 'var(--sk-red)', marginBottom: 18 }}>{state.message}</p>
        <button
          type="button"
          onClick={() => router.push(`${basePath}/sous-traitance`)}
          style={{ padding: '10px 18px', background: domain.primaryColor, color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {t('back_to_list')}
        </button>
      </div>
    )
  }

  const { publication: pub, candidatures } = state
  const isPublished = pub.status === 'published'
  const isClosed = pub.status === 'archived'

  const budgetText = (() => {
    const unit = tPub('budget_unit.day')
    const { budget_min, budget_max } = pub
    if (budget_min == null && budget_max == null) return null
    if (budget_min != null && budget_max != null) return `${Math.round(budget_min)}-${Math.round(budget_max)}€${unit}`
    if (budget_min != null) return `${Math.round(budget_min)}€${unit}`
    return `${Math.round(budget_max!)}€${unit}`
  })()

  return (
    <div style={{ padding: '24px 26px 40px', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {/* En-tête : statut + titre + action clôture */}
      <header style={{ background: 'var(--sk-surface)', border: '1px solid var(--sk-border)', borderRadius: 14, padding: '18px 22px', marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ padding: '4px 10px', borderRadius: 999, background: `${domain.primaryColor}14`, color: domain.primaryColor, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              {t('type_label')}
            </span>
            <span style={{ padding: '4px 10px', borderRadius: 999, background: 'var(--sk-surface-2)', color: 'var(--sk-muted)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              {tPub(`status.${pub.status}` as 'status.published')}
            </span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--sk-text)', margin: 0, letterSpacing: '-0.3px', lineHeight: 1.3 }}>{pub.title}</h1>
        </div>

        {isPublished && !confirmClose && (
          <button
            type="button"
            onClick={() => { setConfirmClose(true); setCloseError(null) }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 9, border: '1px solid #fca5a5', color: '#b91c1c', background: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
          >
            {tClose('cta')}
          </button>
        )}
      </header>

      {/* Confirmation de clôture */}
      {isPublished && confirmClose && (
        <div style={{ background: '#FEF2F2', border: '1.5px solid #FECACA', borderRadius: 12, padding: '16px 18px', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#991B1B', marginBottom: 6 }}>{tClose('confirm_title')}</div>
          <p style={{ fontSize: 13, color: '#7f1d1d', lineHeight: 1.55, margin: '0 0 14px' }}>{tClose('confirm_body')}</p>
          {closeError && (
            <div role="alert" style={{ fontSize: 12.5, color: '#b91c1c', marginBottom: 10 }}>{closeError}</div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={() => setConfirmClose(false)} disabled={closing} style={{ padding: '9px 16px', background: 'transparent', color: '#64748b', border: '1px solid #cbd5e1', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: closing ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
              {tClose('cancel')}
            </button>
            <button type="button" onClick={() => void doClose()} disabled={closing} style={{ padding: '9px 16px', background: '#DC2626', color: '#fff', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: closing ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: closing ? 0.6 : 1 }}>
              {closing ? tClose('closing') : tClose('confirm_cta')}
            </button>
          </div>
        </div>
      )}

      {/* Bandeau besoin clôturé */}
      {isClosed && (
        <div role="status" style={{ background: '#f8fafc', border: '1px solid var(--sk-border)', borderRadius: 12, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: 'var(--sk-muted)', lineHeight: 1.5 }}>
          {t('closed_notice')}
        </div>
      )}

      {/* Rappel du besoin */}
      <section style={{ background: 'var(--sk-surface)', border: '1px solid var(--sk-border)', borderRadius: 14, padding: '18px 22px', marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sk-faint)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10 }}>{t('section_recap')}</div>
        <div style={{ fontSize: 14, color: 'var(--sk-text)', lineHeight: 1.65, whiteSpace: 'pre-wrap', marginBottom: pub.skills_required.length > 0 || budgetText ? 14 : 0 }}>
          {pub.description}
        </div>
        {(budgetText || pub.location || pub.seniority) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: pub.skills_required.length > 0 ? 14 : 0 }}>
            {budgetText && <Field label={t('field_budget')} value={budgetText} />}
            {pub.location && <Field label={t('field_location')} value={pub.location} />}
            {pub.seniority && <Field label={t('field_seniority')} value={tPub(`seniority.${pub.seniority}` as 'seniority.junior')} />}
          </div>
        )}
        {pub.skills_required.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {pub.skills_required.map((s) => (
              <span key={s} style={{ padding: '4px 10px', background: `${domain.primaryColor}14`, color: domain.primaryColor, fontSize: 12, fontWeight: 600, borderRadius: 8, border: `1px solid ${domain.primaryColor}33` }}>{s}</span>
            ))}
          </div>
        )}
      </section>

      {/* Candidatures reçues */}
      <section>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--sk-text)', margin: 0 }}>{t('section_candidatures')}</h2>
          <span style={{ fontSize: 13, color: 'var(--sk-muted)' }}>{t('count_candidates', { count: candidatures.length })}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {([
            { key: 'active' as const,   label: tLifecycle('filters.active_count',   { count: state.counts.active }) },
            { key: 'archived' as const, label: tLifecycle('filters.archived_count', { count: state.counts.archived }) },
          ]).map((b) => {
            const on = bucket === b.key
            return (
              <button
                key={b.key}
                type="button"
                aria-pressed={on}
                onClick={() => setBucket(b.key)}
                style={{
                  fontSize: 12.5, fontWeight: 600, padding: '6px 13px',
                  borderRadius: 999,
                  color: on ? 'var(--sk-accent-ink)' : 'var(--sk-muted)',
                  background: on ? 'var(--sk-accent-soft)' : 'var(--sk-surface)',
                  border: on ? '1px solid transparent' : '1px solid var(--sk-border)',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {b.label}
              </button>
            )
          })}
        </div>
        {candidatures.length === 0 ? (
          <div style={{ background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: 14, padding: '40px 24px', textAlign: 'center', color: '#64748b', fontSize: 14, lineHeight: 1.6 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>
              {bucket === 'archived' ? tLifecycle('empty_archived_title') : t('candidatures_empty_title')}
            </div>
            <div>{bucket === 'archived' ? tLifecycle('empty_archived_body') : t('candidatures_empty_body')}</div>
          </div>
        ) : (
          <CastingCarousel
            items={candidatures}
            publicationType="mission"
            pubSkillsRequired={pub.skills_required}
            onMutated={refresh}
            messagesBasePath={basePath}
            conversionMode={canUnlockManually === true ? 'unlock' : 'wall'}
          />
        )}
      </section>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--sk-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, color: 'var(--sk-text)', fontWeight: 500 }}>{value}</div>
    </div>
  )
}
