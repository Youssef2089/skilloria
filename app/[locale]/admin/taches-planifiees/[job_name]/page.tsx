'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useParams, useSearchParams } from 'next/navigation'
import { usePathname, useRouter } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/taches-planifiees/[job_name] — HISTORIQUE D'UNE TÂCHE.
 *
 * Page de DÉTAIL : le bouton Retour est celui du layout admin
 * (<GlobalBackButton>), UNIQUE. Aucun bouton Retour local ici.
 *
 * POURQUOI CETTE FICHE EXISTE
 *   La liste ne montre que la DERNIÈRE exécution. Elle répond à « est-ce que ça
 *   tourne ? », pas à « depuis quand est-ce cassé ? » ni à « est-ce arrivé
 *   avant ? ». Or c'est précisément la seconde question qui manquait le jour où
 *   une purge s'est arrêtée : personne ne pouvait dater le début du silence.
 *
 * L'ÉTAT DE SANTÉ N'EST PAS RECALCULÉ ICI
 *   Il est servi par la route, qui le lit de `admin_cron_jobs_overview()` — la
 *   MÊME source que la liste. Le recalculer sur un jeu de colonnes différent
 *   garantirait qu'un jour les deux écrans se contredisent.
 *
 * PROFONDEUR RÉELLE ANNONCÉE
 *   `cron.job_run_details` est purgée à 30 jours. L'écran le DIT, plutôt que de
 *   laisser croire que l'historique remonte à la rétention du journal (90 j).
 *   Un historique qui s'arrête sans le dire est le genre de silence que cet
 *   écran combat.
 */

type CronJob = {
  job_name: string
  catalogued: boolean
  label_key: string | null
  description_key: string | null
  criticality: 'legal' | 'technical'
  legal_basis_key: string | null
  writes_run_log: boolean
  schedule: string | null
  active: boolean | null
  period_minutes: number | null
  health: string
}

type CronRun = {
  run_started_at: string
  run_ended_at: string | null
  duration_ms: number | null
  status: string | null
  return_message: string | null
  http_requested_at: string | null
  http_status: number | null
  http_timed_out: boolean | null
  http_error: string | null
  http_response: string | null
  http_reconciled_at: string | null
}

export default function AdminScheduledTaskDetailPage() {
  const t = useTranslations('admin_back_office.cron')
  const tErr = useTranslations('admin_back_office.errors')
  const locale = useLocale()
  const secureFetch = useSecureFetch()
  const params = useParams<{ job_name: string }>()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()

  const jobName = params?.job_name ?? ''
  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1)

  const [job, setJob] = useState<CronJob | null>(null)
  const [runs, setRuns] = useState<CronRun[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [perPage, setPerPage] = useState(25)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [pendingMigration, setPendingMigration] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!jobName) return
    setLoading(true)
    setError(null)
    setNotFound(false)
    setPendingMigration(null)
    try {
      const res = await secureFetch(
        `/api/admin/cron-jobs/${encodeURIComponent(jobName)}/runs?page=${page}`,
        { method: 'GET' },
      )
      const payload = (await res.json().catch(() => ({}))) as {
        job?: CronJob
        runs?: CronRun[]
        total?: number
        per_page?: number
        has_more?: boolean
        code?: string
        migration?: string
      }
      if (res.status === 403) { setError(tErr('forbidden')); return }
      if (res.status === 404) { setNotFound(true); return }
      if (res.status === 503 && payload.code === 'migration_pending') {
        setPendingMigration(payload.migration ?? '')
        return
      }
      if (!res.ok) { setError(t('error_title')); return }
      setJob(payload.job ?? null)
      setRuns(payload.runs ?? [])
      setTotal(payload.total ?? 0)
      setPerPage(payload.per_page ?? 25)
      setHasMore(payload.has_more === true)
    } catch {
      setError(t('error_title'))
    } finally {
      setLoading(false)
    }
  }, [secureFetch, jobName, page, t, tErr])

  useEffect(() => { void load() }, [load])

  /** La page vit dans l'URL : rechargeable, partageable, retour navigateur sain. */
  const goToPage = useCallback((next: number) => {
    const sp = new URLSearchParams(searchParams.toString())
    if (next <= 1) sp.delete('page')
    else sp.set('page', String(next))
    const qs = sp.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [searchParams, pathname, router])

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }),
    [locale],
  )

  /** Durée lisible, sans bibliothèque (règle 11). */
  const duration = useCallback((ms: number | null): string => {
    if (ms === null) return t('run_running')
    if (ms < 1000) return t('duration_ms', { ms })
    return t('duration_s', { s: Math.round(ms / 100) / 10 })
  }, [t])

  const label = job?.label_key ? t(job.label_key as 'title') : jobName

  const card: React.CSSProperties = {
    background: 'var(--color-background-primary, #fff)',
    border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
    borderRadius: 12,
    padding: '18px 20px',
  }
  const pageBtn: React.CSSProperties = {
    padding: '8px 12px', borderRadius: 9,
    border: '1px solid var(--color-border-tertiary, #e5e7eb)',
    background: 'var(--color-background-primary, #fff)',
    color: 'var(--color-text-primary, #0f172a)',
    fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
  }

  return (
    <div style={{ padding: '24px 26px 40px', fontFamily: 'inherit' }}>
      {/* AUCUN bouton Retour local : le layout admin rend déjà LE bouton global,
          et un seul (règle projet). */}

      {pendingMigration !== null && (
        <div role="note" style={{ ...card, background: '#FEFCE8', borderColor: '#FDE68A', color: '#713F12', marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{t('migration_pending_title')}</div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            {t('migration_pending_body', { migration: pendingMigration })}
          </div>
        </div>
      )}

      {notFound && (
        <div role="alert" style={{ ...card, background: '#FEE2E2', borderColor: '#FCA5A5', color: '#991B1B' }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 5 }}>{t('not_found_title')}</div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>{t('not_found_body', { name: jobName })}</div>
        </div>
      )}

      {error && !notFound && (
        <div role="alert" style={{ ...card, background: '#FEE2E2', borderColor: '#FCA5A5', color: '#991B1B' }}>
          {error}
        </div>
      )}

      {!notFound && !error && pendingMigration === null && (
        <>
          <header style={{ marginBottom: 16 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary, #0f172a)', margin: 0, letterSpacing: '-0.2px' }}>
              {label}
            </h1>
            {job?.description_key && (
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', margin: '4px 0 0', lineHeight: 1.55, maxWidth: 760 }}>
                {t(job.description_key as 'title')}
              </p>
            )}
            {job?.legal_basis_key && (
              <p style={{ fontSize: 12.5, color: '#991B1B', margin: '6px 0 0', fontWeight: 600 }}>
                {t(job.legal_basis_key as 'title')}
              </p>
            )}
            {job && (
              <p style={{ fontSize: 12.5, color: 'var(--color-text-secondary, #64748b)', margin: '8px 0 0' }}>
                <code>{job.schedule ?? '—'}</code>
                {job.period_minutes === null && ` · ${t('schedule_advanced')}`}
                {' · '}
                {job.active ? t('badge_active') : t('badge_disabled')}
                {' · '}
                {t(`health.${job.health}` as 'health.ok')}
              </p>
            )}
          </header>

          <section style={card} aria-label={t('history_title')}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
              <h2 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--color-text-secondary, #64748b)', margin: 0 }}>
                {t('history_title')}
              </h2>
              {/* Total EXACT, jamais un écrêtage muet (leçon MAX_ORGS). */}
              <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary, #64748b)' }}>
                {t('runs_count', { count: total })}
              </span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary, #94a3b8)', margin: '0 0 12px', lineHeight: 1.55 }}>
              {t('history_depth_notice')}
            </p>

            {loading && (
              <div style={{ padding: 28, textAlign: 'center', color: 'var(--color-text-secondary, #64748b)', fontSize: 14 }}>
                {t('loading')}
              </div>
            )}

            {!loading && runs.length === 0 && (
              <div style={{ padding: '18px 0' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary, #0f172a)', marginBottom: 4 }}>
                  {t('history_empty_title')}
                </div>
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', lineHeight: 1.6 }}>
                  {t('history_empty_body')}
                </div>
              </div>
            )}

            {!loading && runs.map((r, i) => {
              const failed = r.status !== null && r.status !== 'succeeded'
              const httpKo = job?.writes_run_log && r.http_status !== null && r.http_status !== 200
              const bad = failed || httpKo
              return (
                <div
                  key={`${r.run_started_at}-${i}`}
                  style={{
                    display: 'flex', gap: 12, padding: '10px 0', flexWrap: 'wrap',
                    borderBottom: i === runs.length - 1 ? 'none' : '1px solid #f1f5f9',
                    fontSize: 12.5,
                  }}
                >
                  <span style={{ minWidth: 190, color: 'var(--color-text-secondary, #64748b)' }}>
                    {dateFmt.format(new Date(r.run_started_at))}
                  </span>
                  <span style={{ minWidth: 90, color: 'var(--color-text-secondary, #64748b)' }}>
                    {duration(r.duration_ms)}
                  </span>
                  <span style={{ minWidth: 100, fontWeight: 600, color: bad ? '#991B1B' : '#166534' }}>
                    {r.status ?? '—'}
                  </span>
                  {/* Verdict HTTP servi UNIQUEMENT pour les tâches qui en produisent
                      un : l'ordonnanceur dit « succeeded » dès la mise en file,
                      même sur un 401. Pour les tâches SQL pures, cette colonne
                      n'existe pas — l'afficher vide serait un faux signal. */}
                  {job?.writes_run_log && (
                    <span style={{ minWidth: 110, color: httpKo ? '#991B1B' : 'var(--color-text-secondary, #64748b)' }}>
                      {r.http_status !== null
                        ? `${t('field_http')} ${r.http_status}`
                        : r.http_requested_at
                          ? t('http_no_verdict')
                          : '—'}
                      {r.http_timed_out ? ' · timeout' : ''}
                    </span>
                  )}
                  <span style={{ flex: '1 1 240px', minWidth: 0, color: bad ? '#991B1B' : 'var(--color-text-tertiary, #94a3b8)', wordBreak: 'break-word' }}>
                    {r.return_message ?? r.http_error ?? r.http_response ?? ''}
                  </span>
                </div>
              )
            })}

            {!loading && total > perPage && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => goToPage(page - 1)}
                  style={{ ...pageBtn, cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.45 : 1 }}
                >
                  {t('prev')}
                </button>
                <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary, #64748b)' }}>
                  {t('page_of', { page, pages: Math.max(1, Math.ceil(total / perPage)) })}
                </span>
                <button
                  type="button"
                  disabled={!hasMore}
                  onClick={() => goToPage(page + 1)}
                  style={{ ...pageBtn, cursor: !hasMore ? 'not-allowed' : 'pointer', opacity: !hasMore ? 0.45 : 1 }}
                >
                  {t('next')}
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
