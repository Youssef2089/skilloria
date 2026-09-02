'use client'

import { useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

/**
 * Modale de reprogrammation d'une tâche planifiée.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ ⚠️  AUCUN CHAMP LIBRE — ET CE N'EST PAS UN CHOIX D'ERGONOMIE            ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║ pg_cron valide la FORME d'une expression, pas sa SATISFIABILITÉ.        ║
 * ║ `0 3 30 2 *` — 30 février — est acceptée sans la moindre erreur et NE   ║
 * ║ SE DÉCLENCHERA JAMAIS. Aucune exception, aucune trace : la tâche        ║
 * ║ s'arrête en silence.                                                    ║
 * ║                                                                          ║
 * ║ Un champ texte imposerait donc d'écrire un validateur d'expressions —   ║
 * ║ c'est-à-dire de détecter l'erreur. Ces sélecteurs la rendent            ║
 * ║ IRREPRÉSENTABLE : le jour du mois s'arrête à 28, et tous les mois ont   ║
 * ║ un 28. La classe entière du problème disparaît.                        ║
 * ║                                                                          ║
 * ║ Ne remplacez jamais ces sélecteurs par une saisie libre, même « pour    ║
 * ║ les cas avancés ». Une expression hors de ce modèle reste modifiable    ║
 * ║ en base, et l'écran l'affiche alors en lecture seule.                   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Le client n'envoie JAMAIS d'expression : il envoie des composants typés, et
 * c'est la base qui assemble. La garde est en base (règle 20) ; ce que la
 * modale empêche de saisir n'est que de la courtoisie.
 */

export type ScheduleDraft = {
  frequency: 'daily' | 'weekly' | 'monthly'
  minutes: number[]
  hour: number
  days_of_week: number[]
  day_of_month: number
}

/** Minutes proposées : pas de 5. Couvre les horaires réels (0, 10, 15, 30, 45). */
const MINUTE_CHOICES = Array.from({ length: 12 }, (_, i) => i * 5)
const HOUR_CHOICES = Array.from({ length: 24 }, (_, i) => i)
/** 1 à 28 UNIQUEMENT — cf. l'encadré. Jamais 29, 30 ni 31. */
const DOM_CHOICES = Array.from({ length: 28 }, (_, i) => i + 1)
const DOW_CHOICES = [1, 2, 3, 4, 5, 6, 0] // lundi → dimanche

export default function CronScheduleModal({
  jobName,
  jobLabel,
  currentSchedule,
  busy,
  chainError,
  onCancel,
  onSubmit,
}: {
  jobName: string
  jobLabel: string
  currentSchedule: string | null
  busy: boolean
  chainError: { otherJobLabel: string; minGap: number; suggested: string | null } | null
  onCancel: () => void
  onSubmit: (draft: ScheduleDraft, confirmName: string) => void
}) {
  const t = useTranslations('admin_back_office.cron')
  const locale = useLocale()

  /**
   * Pré-remplissage depuis l'horaire courant, quand il est représentable.
   * Sinon on part d'un défaut lisible — on n'invente pas une interprétation
   * d'une expression qu'on ne sait pas relire.
   */
  const initial = useMemo<ScheduleDraft>(() => {
    const m = (currentSchedule ?? '').trim().match(/^([\d,]+)\s+(\d{1,2})\s+(\S+)\s+\*\s+(\S+)$/)
    if (m) {
      const mins = m[1].split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 59)
      const hour = Number(m[2])
      if (mins.length > 0 && hour >= 0 && hour <= 23) {
        if (m[3] !== '*' && /^\d+$/.test(m[3]) && Number(m[3]) <= 28) {
          return { frequency: 'monthly', minutes: mins, hour, days_of_week: [1], day_of_month: Number(m[3]) }
        }
        if (m[4] !== '*' && /^[\d,]+$/.test(m[4])) {
          return { frequency: 'weekly', minutes: mins, hour, days_of_week: m[4].split(',').map(Number), day_of_month: 1 }
        }
        if (m[3] === '*' && m[4] === '*') {
          return { frequency: 'daily', minutes: mins, hour, days_of_week: [1], day_of_month: 1 }
        }
      }
    }
    return { frequency: 'daily', minutes: [0], hour: 3, days_of_week: [1], day_of_month: 1 }
  }, [currentSchedule])

  const [draft, setDraft] = useState<ScheduleDraft>(initial)
  const [confirmName, setConfirmName] = useState('')

  const dowLabel = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' })
    // 2024-01-07 est un dimanche : l'index cron 0..6 s'aligne dessus.
    return (d: number) => fmt.format(new Date(Date.UTC(2024, 0, 7 + d)))
  }, [locale])

  /** Aperçu UTC + heure locale — on n'affiche jamais l'heure locale seule. */
  const preview = useMemo(() => {
    const mins = [...draft.minutes].sort((a, b) => a - b)
    const utc = mins.map((m) => `${String(draft.hour).padStart(2, '0')}:${String(m).padStart(2, '0')}`).join(', ')
    const local = mins
      .map((m) =>
        new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
          .format(new Date(Date.UTC(2000, 0, 1, draft.hour, m))),
      )
      .join(', ')
    return { utc, local }
  }, [draft, locale])

  const canSubmit =
    !busy &&
    draft.minutes.length > 0 &&
    (draft.frequency !== 'weekly' || draft.days_of_week.length > 0) &&
    confirmName.trim() === jobName

  const field: React.CSSProperties = {
    padding: '8px 10px', borderRadius: 9,
    border: '1px solid var(--color-border-tertiary, #e5e7eb)',
    background: 'var(--color-background-primary, #fff)',
    color: 'var(--color-text-primary, #0f172a)',
    fontSize: 13, fontFamily: 'inherit',
  }
  const chip = (on: boolean): React.CSSProperties => ({
    padding: '5px 9px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
    border: on ? '1px solid #0f172a' : '1px solid var(--color-border-tertiary, #e5e7eb)',
    background: on ? '#0f172a' : 'var(--color-background-primary, #fff)',
    color: on ? '#fff' : 'var(--color-text-secondary, #64748b)',
    cursor: 'pointer', fontFamily: 'inherit',
  })

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 60, overflowY: 'auto' }}
    >
      <div style={{ background: '#fff', borderRadius: 14, padding: '22px 24px', maxWidth: 560, width: '100%' }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px', color: '#0f172a' }}>
          {t('reschedule_title')}
        </h3>
        <p style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.6, margin: '0 0 14px' }}>
          {t('reschedule_body', { name: jobLabel })}
        </p>

        {/* Refus de chaîne : NOMME la contrainte et PROPOSE un horaire valide. */}
        {chainError && (
          <div role="alert" style={{ margin: '0 0 14px', padding: '12px 14px', borderRadius: 10, background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B', fontSize: 13, lineHeight: 1.6 }}>
            {t('chain_violation_body', { other: chainError.otherJobLabel, minutes: chainError.minGap })}
            {chainError.suggested && (
              <div style={{ marginTop: 6, fontWeight: 600 }}>
                {t('chain_violation_suggestion', { schedule: chainError.suggested })}
              </div>
            )}
          </div>
        )}

        <label style={{ display: 'block', fontSize: 12.5, color: '#475569', marginBottom: 5 }}>
          {t('field_frequency')}
        </label>
        <select
          value={draft.frequency}
          onChange={(e) => setDraft({ ...draft, frequency: e.target.value as ScheduleDraft['frequency'] })}
          style={{ ...field, width: '100%', boxSizing: 'border-box', marginBottom: 12 }}
        >
          <option value="daily">{t('frequency_daily')}</option>
          <option value="weekly">{t('frequency_weekly')}</option>
          <option value="monthly">{t('frequency_monthly')}</option>
        </select>

        <label style={{ display: 'block', fontSize: 12.5, color: '#475569', marginBottom: 5 }}>
          {t('field_hour_utc')}
        </label>
        <select
          value={draft.hour}
          onChange={(e) => setDraft({ ...draft, hour: Number(e.target.value) })}
          style={{ ...field, width: 120, marginBottom: 12 }}
        >
          {HOUR_CHOICES.map((h) => (
            <option key={h} value={h}>{String(h).padStart(2, '0')} h UTC</option>
          ))}
        </select>

        <label style={{ display: 'block', fontSize: 12.5, color: '#475569', marginBottom: 5 }}>
          {t('field_minutes')}
        </label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {MINUTE_CHOICES.map((m) => {
            const on = draft.minutes.includes(m)
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setDraft({
                    ...draft,
                    minutes: on
                      ? draft.minutes.filter((x) => x !== m)
                      : [...draft.minutes, m].slice(0, 6),
                  })
                }
                style={chip(on)}
              >
                :{String(m).padStart(2, '0')}
              </button>
            )
          })}
        </div>

        {draft.frequency === 'weekly' && (
          <>
            <label style={{ display: 'block', fontSize: 12.5, color: '#475569', marginBottom: 5 }}>
              {t('field_days_of_week')}
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {DOW_CHOICES.map((d) => {
                const on = draft.days_of_week.includes(d)
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        days_of_week: on
                          ? draft.days_of_week.filter((x) => x !== d)
                          : [...draft.days_of_week, d],
                      })
                    }
                    style={chip(on)}
                  >
                    {dowLabel(d)}
                  </button>
                )
              })}
            </div>
          </>
        )}

        {draft.frequency === 'monthly' && (
          <>
            <label style={{ display: 'block', fontSize: 12.5, color: '#475569', marginBottom: 5 }}>
              {t('field_day_of_month')}
            </label>
            <select
              value={draft.day_of_month}
              onChange={(e) => setDraft({ ...draft, day_of_month: Number(e.target.value) })}
              style={{ ...field, width: 120, marginBottom: 6 }}
            >
              {DOM_CHOICES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            {/* On DIT pourquoi la liste s'arrête à 28 — sinon la borne passe
                pour une limitation arbitraire et quelqu'un la « corrigera ». */}
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary, #94a3b8)', margin: '0 0 12px', lineHeight: 1.5 }}>
              {t('day_of_month_hint')}
            </p>
          </>
        )}

        <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary, #64748b)', marginBottom: 14, lineHeight: 1.6 }}>
          {t('preview_utc', { times: preview.utc })}
          <span style={{ color: 'var(--color-text-tertiary, #94a3b8)' }}> · {preview.local}</span>
        </div>

        <label style={{ display: 'block', fontSize: 13, color: '#475569', marginBottom: 6 }}>
          {t('confirm_type_name', { name: jobName })}
        </label>
        <input
          value={confirmName}
          autoComplete="off"
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={jobName}
          style={{ ...field, width: '100%', boxSizing: 'border-box', marginBottom: 16 }}
        />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} style={{ ...field, cursor: 'pointer', fontWeight: 600 }}>
            {t('confirm_cancel')}
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onSubmit(draft, confirmName.trim())}
            style={{
              padding: '8px 14px', borderRadius: 9, border: 'none',
              background: 'var(--color-text-primary, #0f172a)', color: '#fff',
              fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              cursor: canSubmit ? 'pointer' : 'not-allowed', opacity: canSubmit ? 1 : 0.5,
            }}
          >
            {t('reschedule_submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
