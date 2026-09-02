'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/taches-planifiees — LES TRAITEMENTS AUTOMATIQUES, TELS QUE LA BASE
 * LES EXÉCUTE.
 *
 * Page de MENU : aucun bouton Retour (règle projet).
 *
 * POURQUOI CET ÉCRAN EXISTE
 *   Cinq tâches tournent dans pg_cron, dont deux exécutent une obligation
 *   légale. Le seul moyen d'en connaître l'état était de lancer un script en
 *   ligne de commande — et une purge a pu cesser de fonctionner pendant des
 *   mois sans que personne ne puisse le voir.
 *
 *   Un écran qui LISTE sans ALERTER ne réglerait rien. L'état de santé est donc
 *   calculé pour chaque tâche et remonté en tête : ce qui doit sauter aux yeux,
 *   c'est ce qui ne tourne plus.
 *
 * LOT 0 — LECTURE SEULE
 *   Activer/désactiver, reprogrammer et déclencher viendront ensuite, avec
 *   leurs propres gardes (ré-authentification, saisie du nom pour les tâches
 *   légales, validation de la chaîne d'enchaînement).
 *
 * ⚠️ LA LISTE VIENT DE LA BASE, JAMAIS DU CODE. Cet écran ne connaît aucun nom
 *    de tâche : il rend ce que `admin_cron_jobs_overview()` renvoie, dont le
 *    FROM est `cron.job`. C'est ce qui lui permet d'afficher une tâche que
 *    personne n'a déclarée — et c'est tout l'intérêt d'un écran de supervision.
 */

type CronJob = {
  job_name: string
  catalogued: boolean
  label_key: string | null
  description_key: string | null
  criticality: 'legal' | 'technical'
  legal_basis_key: string | null
  depends_on: string[]
  min_gap_minutes: number
  writes_run_log: boolean
  schedule: string | null
  active: boolean | null
  period_minutes: number | null
  last_run_started_at: string | null
  last_run_ended_at: string | null
  last_run_status: string | null
  last_run_message: string | null
  recent_runs: number
  recent_failures: number
  http_requested_at: string | null
  http_status: number | null
  http_timed_out: boolean | null
  http_error: string | null
  http_reconciled_at: string | null
  health:
    | 'legal_disabled' | 'never_ran' | 'failed' | 'stale' | 'repeated_failures'
    | 'verdict_missing' | 'disabled' | 'uncatalogued' | 'ok'
}

/** Rouge = il faut agir. Orange = il faut regarder. Gris = état voulu. */
const SEVERITY: Record<CronJob['health'], 'red' | 'amber' | 'grey' | 'green'> = {
  legal_disabled: 'red',
  never_ran: 'red',
  failed: 'red',
  stale: 'red',
  repeated_failures: 'amber',
  verdict_missing: 'amber',
  uncatalogued: 'amber',
  disabled: 'grey',
  ok: 'green',
}

const TONE: Record<'red' | 'amber' | 'grey' | 'green', { bg: string; border: string; fg: string; dot: string }> = {
  red: { bg: '#FEF2F2', border: '#FCA5A5', fg: '#991B1B', dot: '#DC2626' },
  amber: { bg: '#FEFCE8', border: '#FDE68A', fg: '#713F12', dot: '#CA8A04' },
  grey: { bg: '#F8FAFC', border: '#E2E8F0', fg: '#475569', dot: '#94A3B8' },
  green: { bg: 'var(--color-background-primary, #fff)', border: '#E2E8F0', fg: '#166534', dot: '#16A34A' },
}

export default function AdminScheduledTasksPage() {
  const t = useTranslations('admin_back_office.cron')
  const tErr = useTranslations('admin_back_office.errors')
  const locale = useLocale()
  const secureFetch = useSecureFetch()

  const [jobs, setJobs] = useState<CronJob[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** Migration non poussée : état DISTINCT d'une panne, et actionnable. */
  const [pendingMigration, setPendingMigration] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setPendingMigration(null)
    try {
      const res = await secureFetch('/api/admin/cron-jobs', { method: 'GET' })
      const payload = (await res.json().catch(() => ({}))) as {
        jobs?: CronJob[]
        code?: string
        migration?: string
      }
      if (res.status === 403) { setError(tErr('forbidden')); return }
      if (res.status === 503 && payload.code === 'migration_pending') {
        setPendingMigration(payload.migration ?? '')
        return
      }
      if (!res.ok) { setError(t('error_title')); return }
      setJobs(payload.jobs ?? [])
    } catch {
      setError(t('error_title'))
    } finally {
      setLoading(false)
    }
  }, [secureFetch, t, tErr])

  useEffect(() => { void load() }, [load])

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    }),
    [locale],
  )
  const relFmt = useMemo(() => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }), [locale])

  /** Âge lisible sans bibliothèque (règle 11) — Intl suffit. */
  const ago = useCallback((iso: string | null): string => {
    if (!iso) return t('field_never')
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
    if (min < 60) return relFmt.format(-min, 'minute')
    if (min < 60 * 48) return relFmt.format(-Math.round(min / 60), 'hour')
    return relFmt.format(-Math.round(min / 1440), 'day')
  }, [relFmt, t])

  /**
   * Heure locale d'un horaire UTC `M H * * *`, en indication grise. On n'affiche
   * JAMAIS l'heure locale seule : pg_cron exécute en UTC, et masquer ce fait
   * produirait un décalage silencieux deux fois par an.
   */
  const localHint = useCallback((schedule: string | null): string | null => {
    if (!schedule) return null
    const m = schedule.trim().match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/)
    if (!m) return null
    const d = new Date(Date.UTC(2000, 0, 1, Number(m[2]), Number(m[1])))
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(d)
  }, [locale])

  /** Libellé d'une tâche : clé du catalogue, ou son nom brut si non cataloguée. */
  const labelOf = useCallback(
    (j: CronJob): string => (j.label_key ? t(j.label_key as 'title') : j.job_name),
    [t],
  )

  /** Obligations légales désactivées — le bandeau qui ne doit jamais s'oublier. */
  const legalDisabled = (jobs ?? []).filter((j) => j.health === 'legal_disabled')

  const card: React.CSSProperties = {
    borderRadius: 12,
    padding: '16px 18px',
    marginBottom: 10,
    border: '1px solid',
  }

  return (
    <div style={{ padding: '24px 26px 40px', fontFamily: 'inherit' }}>
      {/* ─── BANDEAU DE CONFORMITÉ ────────────────────────────────────────
          Permanent, non refermable, tant qu'une obligation légale est
          désactivée. Youssef doit pouvoir désactiver une purge ; il ne doit
          pas pouvoir l'oublier. */}
      {legalDisabled.length > 0 && (
        <div
          role="alert"
          style={{
            marginBottom: 18, padding: '14px 18px', borderRadius: 12,
            background: '#FEE2E2', border: '1.5px solid #FCA5A5', color: '#991B1B',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: '#DC2626' }} />
            <strong style={{ fontSize: 14, fontWeight: 700 }}>{t('banner_title')}</strong>
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
            {t('banner_body', {
              count: legalDisabled.length,
              jobs: legalDisabled.map(labelOf).join(', '),
            })}
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 4, opacity: 0.9 }}>
            {t('banner_hint')}
          </div>
        </div>
      )}

      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary, #0f172a)', margin: 0, letterSpacing: '-0.2px' }}>
          {t('title')}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', margin: '4px 0 0', lineHeight: 1.55, maxWidth: 760 }}>
          {t('subtitle')}
        </p>
        <p style={{ fontSize: 12.5, color: 'var(--color-text-tertiary, #94a3b8)', margin: '6px 0 0' }}>
          {t('utc_hint')}
        </p>
      </header>

      {/* Migration non poussée : on DIT quoi faire. Jamais un écran mort. */}
      {pendingMigration !== null && (
        <div role="note" style={{ ...card, background: '#FEFCE8', borderColor: '#FDE68A', color: '#713F12' }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{t('migration_pending_title')}</div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            {t('migration_pending_body', { migration: pendingMigration })}
          </div>
        </div>
      )}

      {loading && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-secondary, #64748b)', fontSize: 14 }}>
          {t('loading')}
        </div>
      )}

      {!loading && error && (
        <div role="alert" style={{ ...card, background: '#FEE2E2', borderColor: '#FCA5A5', color: '#991B1B' }}>
          {error}
        </div>
      )}

      {!loading && !error && pendingMigration === null && jobs?.length === 0 && (
        <div style={{ ...card, background: '#F8FAFC', borderColor: '#E2E8F0' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary, #0f172a)', marginBottom: 5 }}>
            {t('empty_title')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', lineHeight: 1.6 }}>
            {t('empty_body')}
          </div>
        </div>
      )}

      {!loading && !error && (jobs ?? []).map((j) => {
        const tone = TONE[SEVERITY[j.health]]
        const local = localHint(j.schedule)
        return (
          <section
            key={j.job_name}
            style={{ ...card, background: tone.bg, borderColor: tone.border }}
            aria-label={labelOf(j)}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
              <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: tone.dot, marginTop: 6, flexShrink: 0 }} />
              <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                  <strong style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text-primary, #0f172a)' }}>
                    {labelOf(j)}
                  </strong>
                  <Badge tone={j.criticality === 'legal' ? 'legal' : 'neutral'}>
                    {j.criticality === 'legal' ? t('badge_legal') : t('badge_technical')}
                  </Badge>
                  <Badge tone={j.active ? 'neutral' : 'warn'}>
                    {j.active ? t('badge_active') : t('badge_disabled')}
                  </Badge>
                  {!j.catalogued && <Badge tone="warn">{t('badge_uncatalogued')}</Badge>}
                </div>

                {j.description_key && (
                  <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', margin: '0 0 6px', lineHeight: 1.55 }}>
                    {t(j.description_key as 'title')}
                  </p>
                )}
                {j.legal_basis_key && (
                  <p style={{ fontSize: 12.5, color: tone.fg, margin: '0 0 6px', fontWeight: 600 }}>
                    {t(j.legal_basis_key as 'title')}
                  </p>
                )}
                {!j.catalogued && (
                  <p style={{ fontSize: 13, color: '#713F12', margin: '0 0 6px', lineHeight: 1.55 }}>
                    {t('uncatalogued_body')}
                  </p>
                )}

                {/* Faits bruts : horaire, dernière exécution, verdict HTTP. */}
                <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary, #64748b)', lineHeight: 1.7 }}>
                  <div>
                    <strong style={{ fontWeight: 600 }}>{t('field_schedule')}</strong>{' '}
                    <code style={{ fontSize: 12 }}>{j.schedule ?? '—'}</code>
                    {j.period_minutes === null && ` · ${t('schedule_advanced')}`}
                    {local && (
                      <span style={{ color: 'var(--color-text-tertiary, #94a3b8)' }}> · {local}</span>
                    )}
                  </div>
                  <div>
                    <strong style={{ fontWeight: 600 }}>{t('field_last_run')}</strong>{' '}
                    {j.last_run_started_at
                      ? `${dateFmt.format(new Date(j.last_run_started_at))} (${ago(j.last_run_started_at)})`
                      : t('field_never')}
                    {j.last_run_status && ` · ${t('field_scheduler')} : ${j.last_run_status}`}
                  </div>
                  {/* Verdict HTTP servi UNIQUEMENT pour les tâches qui en produisent
                      un. Sans cette condition, les tâches SQL pures afficheraient
                      éternellement « aucune réponse » — un faux rouge. */}
                  {j.writes_run_log && (
                    <div>
                      <strong style={{ fontWeight: 600 }}>{t('field_http')}</strong>{' '}
                      {j.http_status ?? '—'}
                      {j.http_timed_out ? ' · timeout' : ''}
                      {j.http_error ? ` · ${j.http_error}` : ''}
                    </div>
                  )}
                  {j.recent_failures > 0 && (
                    <div style={{ color: tone.fg }}>
                      {t('recent_failures', { failures: j.recent_failures, runs: j.recent_runs })}
                    </div>
                  )}
                  {j.depends_on.length > 0 && (
                    <div style={{ color: 'var(--color-text-tertiary, #94a3b8)' }}>
                      {t('chain_notice', {
                        minutes: j.min_gap_minutes,
                        jobs: j.depends_on
                          .map((n) => (jobs ?? []).find((x) => x.job_name === n))
                          .map((x, i) => (x ? labelOf(x) : j.depends_on[i]))
                          .join(', '),
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Verdict de santé, à droite : la raison, en clair. */}
              <div style={{ flex: '0 1 300px', minWidth: 0, fontSize: 13, color: tone.fg, lineHeight: 1.55, fontWeight: SEVERITY[j.health] === 'green' ? 400 : 600 }}>
                {t(`health.${j.health}` as 'health.ok')}
                {j.last_run_message && j.last_run_status !== 'succeeded' && (
                  <div style={{ fontWeight: 400, marginTop: 4, fontSize: 12.5 }}>{j.last_run_message}</div>
                )}
              </div>
            </div>
          </section>
        )
      })}
    </div>
  )
}

function Badge({ tone, children }: { tone: 'legal' | 'warn' | 'neutral'; children: React.ReactNode }) {
  const c =
    tone === 'legal' ? { bg: '#EDE9FE', fg: '#5B21B6' }
      : tone === 'warn' ? { bg: '#FEF9C3', fg: '#713F12' }
        : { bg: '#F1F5F9', fg: '#475569' }
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em',
      padding: '2px 7px', borderRadius: 6, background: c.bg, color: c.fg,
    }}>
      {children}
    </span>
  )
}
