'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'
import ReauthModal from '@/components/settings/ReauthModal'

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

  // Activation / désactivation : confirmation → ré-auth → exécution. Trois
  // états distincts pour que l'administrateur sache toujours ce qu'il s'apprête
  // à faire AVANT de saisir son mot de passe.
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null)
  const [toggling, setToggling] = useState<{ job: CronJob; next: boolean } | null>(null)
  const [confirmName, setConfirmName] = useState('')
  const [pending, setPending] = useState<{ job: CronJob; next: boolean; confirmName: string } | null>(null)
  const [reauthOpen, setReauthOpen] = useState(false)

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

  /** Exécute la bascule une fois le grant de ré-auth obtenu. */
  const runToggle = useCallback(
    async (p: { job: CronJob; next: boolean; confirmName: string }, reauthToken: string) => {
      setBusy(true)
      try {
        const res = await secureFetch(
          `/api/admin/cron-jobs/${encodeURIComponent(p.job.job_name)}/toggle`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-reauth-token': reauthToken },
            body: JSON.stringify({ active: p.next, confirm_name: p.confirmName }),
          },
        )
        const payload = (await res.json().catch(() => ({}))) as { code?: string }
        if (!res.ok) {
          setToast({
            msg:
              payload.code === 'confirm_name_mismatch' ? t('err_confirm_name_mismatch')
                : payload.code === 'nothing_to_update' ? t('err_nothing_to_update')
                  : payload.code === 'not_found' ? t('not_found_title')
                    : t('error_title'),
            kind: 'error',
          })
          return
        }
        setToast({ msg: p.next ? t('toast_enabled') : t('toast_disabled'), kind: 'success' })
        await load()
      } catch {
        setToast({ msg: t('error_title'), kind: 'error' })
      } finally {
        setBusy(false)
      }
    },
    [secureFetch, t, load],
  )

  const card: React.CSSProperties = {
    borderRadius: 12,
    padding: '16px 18px',
    marginBottom: 10,
    border: '1px solid',
  }
  /** `danger` = l'action retire quelque chose (désactivation). */
  const actionBtn = (danger: boolean): React.CSSProperties => ({
    padding: '8px 13px',
    borderRadius: 9,
    border: danger ? '1px solid #FCA5A5' : '1px solid var(--color-border-tertiary, #e5e7eb)',
    background: danger ? '#FEE2E2' : 'var(--color-background-primary, #fff)',
    color: danger ? '#991B1B' : 'var(--color-text-primary, #0f172a)',
    fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit',
    cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
  })

  return (
    <div style={{ padding: '24px 26px 40px', fontFamily: 'inherit' }}>
      {/* AUCUN bandeau de conformité local : <CronComplianceBanner /> est monté
          dans le layout admin, donc DÉJÀ rendu au-dessus de cette page — et sur
          toutes les autres. En poser un second ici en donnerait deux, empilés,
          sur le seul écran où il était le moins utile : celui qu'on ouvre déjà
          pour regarder les tâches. Même règle que le bouton Retour global. */}

      {toast && (
        <div
          role="status"
          style={{
            marginBottom: 14, padding: '12px 16px', borderRadius: 10, fontSize: 13, lineHeight: 1.55,
            background: toast.kind === 'error' ? '#FEE2E2' : '#DCFCE7',
            color: toast.kind === 'error' ? '#991B1B' : '#166534',
          }}
        >
          {toast.msg}
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
                  {/* Vers la fiche : l'historique répond à « depuis quand ? »,
                      question que la liste ne peut pas trancher (elle ne montre
                      que la dernière exécution). */}
                  <Link
                    href={`/admin/taches-planifiees/${encodeURIComponent(j.job_name)}`}
                    style={{
                      fontSize: 15, fontWeight: 700,
                      color: 'var(--color-text-primary, #0f172a)', textDecoration: 'none',
                    }}
                  >
                    {labelOf(j)}
                  </Link>
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
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => { setConfirmName(''); setToggling({ job: j, next: !j.active }) }}
                    style={actionBtn(j.active === true)}
                  >
                    {j.active ? t('action_disable') : t('action_enable')}
                  </button>
                </div>
              </div>
            </div>
          </section>
        )
      })}

      {/* ─── CONFIRMATION D'ACTIVATION / DÉSACTIVATION ────────────────────
          Elle NOMME l'obligation légale quand il y en a une, et exige de
          retaper le nom de la tâche. Les deux exigences sont revalidées par
          /toggle : ce que l'écran en fait n'est que de la courtoisie. */}
      {toggling && (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 60 }}
        >
          <div style={{ background: '#fff', borderRadius: 14, padding: '22px 24px', maxWidth: 560, width: '100%' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 10px', color: toggling.next ? '#0f172a' : '#991B1B' }}>
              {toggling.next ? t('confirm_enable_title') : t('confirm_disable_title')}
            </h3>
            <p style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.6, margin: '0 0 12px' }}>
              {toggling.next
                ? t('confirm_enable_body', { name: labelOf(toggling.job) })
                : t('confirm_disable_body', { name: labelOf(toggling.job) })}
            </p>

            {/* L'obligation est NOMMÉE, jamais résumée en « tâche critique ». */}
            {toggling.job.criticality === 'legal' && toggling.job.legal_basis_key && (
              <p role="alert" style={{ fontSize: 13, color: '#991B1B', background: '#FEE2E2', borderRadius: 10, padding: '11px 14px', lineHeight: 1.6, margin: '0 0 14px' }}>
                {toggling.next
                  ? t('confirm_enable_legal', { basis: t(toggling.job.legal_basis_key as 'title') })
                  : t('confirm_disable_legal', { basis: t(toggling.job.legal_basis_key as 'title') })}
              </p>
            )}

            <label style={{ display: 'block', fontSize: 13, color: '#475569', marginBottom: 6 }}>
              {t('confirm_type_name', { name: toggling.job.job_name })}
            </label>
            <input
              value={confirmName}
              autoComplete="off"
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={toggling.job.job_name}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 9,
                border: '1px solid var(--color-border-tertiary, #e5e7eb)', fontSize: 13,
                fontFamily: 'inherit', marginBottom: 16,
              }}
            />

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setToggling(null)} style={actionBtn(false)}>
                {t('confirm_cancel')}
              </button>
              <button
                type="button"
                disabled={busy || confirmName.trim() !== toggling.job.job_name}
                onClick={() => {
                  setPending({ job: toggling.job, next: toggling.next, confirmName: confirmName.trim() })
                  setToggling(null)
                  setReauthOpen(true)
                }}
                style={{
                  ...actionBtn(!toggling.next),
                  opacity: confirmName.trim() !== toggling.job.job_name ? 0.5 : 1,
                }}
              >
                {toggling.next ? t('action_enable') : t('action_disable')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ré-authentification — mécanisme EXISTANT, réutilisé tel quel. */}
      <ReauthModal
        open={reauthOpen}
        onConfirm={(token) => {
          setReauthOpen(false)
          const p = pending
          setPending(null)
          if (p) void runToggle(p, token)
        }}
        onCancel={() => { setReauthOpen(false); setPending(null) }}
      />
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
