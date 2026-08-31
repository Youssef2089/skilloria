'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'
import ReauthModal from '@/components/settings/ReauthModal'

/**
 * /admin/utilisateurs/[id] — fiche d'un compte.
 *
 * Page de DÉTAIL : UN SEUL bouton Retour, global, en haut (règle projet).
 *
 * CE QU'ELLE N'AFFICHE PAS, ET C'EST VOULU
 *   Le NUMÉRO de téléphone n'est jamais servi par l'API (seulement
 *   `phone_verified`). Un administrateur n'a besoin d'aucun numéro pour
 *   suspendre ou révoquer. Idem pour le CV, le contenu du profil et les
 *   messages : la fiche expert existe déjà et a ses propres gardes.
 *
 * TROIS ACTIONS, TOUTES RÉ-AUTHENTIFIÉES
 *   Suspendre/réactiver, forcer la déconnexion, changer le rôle en
 *   organisation. Chacune passe par <ReauthModal> — le mécanisme EXISTANT
 *   (grant HMAC de 5 min, header `x-reauth-token`), le même que le changement
 *   d'e-mail et la suppression de compte. Les gardes réelles sont SERVEUR ;
 *   ce que l'écran fait ici n'est que de la courtoisie.
 */

type ApiUser = {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  job_title: string | null
  user_type: string | null
  status: string | null
  email_verified: boolean
  phone_verified: boolean
  is_verified: boolean
  locale: string | null
  last_login_at: string | null
  has_ever_logged_in: boolean
  created_at: string
  deletion_scheduled_at: string | null
  anonymized_at: string | null
  ecosystem: { id: string; name: string | null; slug: string | null } | null
}
type ApiOrg = {
  membership_id: string
  id: string
  company_name: string | null
  org_type: string | null
  verification_status: string | null
  role_in_org: string
}
type ApiProfile = { id: string; verification_status: string | null; expert_type: string | null; title: string | null }
type Detail = { user: ApiUser; organization: ApiOrg | null; profile: ApiProfile | null }

type TimelineEntry = {
  kind: 'login' | 'revocation'
  at: string
  ip_address: string | null
  user_agent: string | null
  action?: string
  by_self?: boolean
}

const ROLES = ['viewer', 'editor', 'admin'] as const

/** Action en attente de ré-authentification. */
type PendingAction =
  | { kind: 'suspend' | 'reactivate' | 'revoke' }
  | { kind: 'role'; role: string; force: boolean }

export default function AdminUserDetailPage() {
  const t = useTranslations('admin_back_office.users')
  const tErr = useTranslations('admin_back_office.errors')
  const locale = useLocale()
  const secureFetch = useSecureFetch()
  const params = useParams<{ id: string }>()
  const userId = params?.id ?? ''

  const [detail, setDetail] = useState<Detail | null>(null)
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [loginCount, setLoginCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null)
  const [busy, setBusy] = useState(false)

  // Confirmation → ré-auth → exécution. Trois états distincts pour que l'admin
  // sache toujours ce qu'il s'apprête à faire AVANT de saisir son mot de passe.
  const [confirming, setConfirming] = useState<PendingAction | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [reauthOpen, setReauthOpen] = useState(false)

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setError(null)
    try {
      const [dRes, sRes] = await Promise.all([
        secureFetch(`/api/admin/get-user/${userId}`, { method: 'GET' }),
        secureFetch(`/api/admin/get-user/${userId}/sessions`, { method: 'GET' }),
      ])
      if (dRes.status === 403) { setError(tErr('forbidden')); return }
      if (dRes.status === 404) { setError(t('empty_title')); return }
      if (!dRes.ok) { setError(tErr('generic')); return }
      setDetail((await dRes.json()) as Detail)
      if (sRes.ok) {
        const s = (await sRes.json()) as { entries: TimelineEntry[]; login_count: number }
        setTimeline(s.entries ?? [])
        setLoginCount(s.login_count ?? 0)
      }
    } catch {
      setError(tErr('generic'))
    } finally {
      setLoading(false)
    }
  }, [secureFetch, userId, t, tErr])

  useEffect(() => { void load() }, [load])

  const dateTimeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    [locale],
  )
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }),
    [locale],
  )

  const u = detail?.user ?? null
  const org = detail?.organization ?? null
  const fullName = u ? [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || (u.email ?? '—') : '—'

  /** Traduit le code d'erreur serveur en message. Jamais de code brut à l'écran. */
  const messageForCode = useCallback(
    (code: string | undefined): string => {
      switch (code) {
        case 'self_forbidden': return t('err_self_forbidden')
        case 'target_is_admin': return t('err_target_is_admin')
        case 'last_platform_admin': return t('err_last_platform_admin')
        case 'no_membership': return t('err_no_membership')
        case 'nothing_to_update': return t('err_nothing_to_update')
        default: return t('err_generic')
      }
    },
    [t],
  )

  /** Exécute l'action une fois le grant de ré-auth obtenu. */
  const run = useCallback(
    async (action: PendingAction, reauthToken: string) => {
      setBusy(true)
      try {
        const headers = { 'content-type': 'application/json', 'x-reauth-token': reauthToken }
        let res: Response
        if (action.kind === 'role') {
          res = await secureFetch('/api/admin/user-org-role', {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ user_id: userId, role_in_org: action.role, force: action.force }),
          })
        } else if (action.kind === 'revoke') {
          res = await secureFetch('/api/admin/user-revoke-session', {
            method: 'POST', headers, body: JSON.stringify({ user_id: userId }),
          })
        } else {
          res = await secureFetch('/api/admin/user-status', {
            method: 'POST', headers, body: JSON.stringify({ user_id: userId, action: action.kind }),
          })
        }

        const payload = (await res.json().catch(() => ({}))) as { code?: string }
        if (!res.ok) {
          // 409 `last_admin` sans `force` : le serveur refuse et FOURNIT le
          // contexte. On re-pose la question en nommant l'organisation, puis on
          // renvoie l'action avec force — jamais en silence.
          if (res.status === 409 && payload.code === 'last_admin' && action.kind === 'role') {
            setConfirming({ kind: 'role', role: action.role, force: true })
            return
          }
          setToast({ msg: messageForCode(payload.code), kind: 'error' })
          return
        }
        setToast({
          msg:
            action.kind === 'role' ? t('toast_role_changed')
              : action.kind === 'revoke' ? t('toast_revoked')
                : action.kind === 'suspend' ? t('toast_suspended')
                  : t('toast_reactivated'),
          kind: 'success',
        })
        await load()
      } catch {
        setToast({ msg: t('err_generic'), kind: 'error' })
      } finally {
        setBusy(false)
      }
    },
    [secureFetch, userId, messageForCode, t, load],
  )

  const card: React.CSSProperties = {
    background: 'var(--color-background-primary, #fff)',
    border: '0.5px solid var(--color-border-tertiary, #e5e7eb)',
    borderRadius: 12,
    padding: '18px 20px',
  }
  const btn = (danger?: boolean): React.CSSProperties => ({
    padding: '9px 15px',
    borderRadius: 9,
    border: danger ? '1px solid #FCA5A5' : '1px solid var(--color-border-tertiary, #e5e7eb)',
    background: danger ? '#FEE2E2' : 'var(--color-background-primary, #fff)',
    color: danger ? '#991B1B' : 'var(--color-text-primary, #0f172a)',
    fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer',
    opacity: busy ? 0.6 : 1, fontFamily: 'inherit',
  })
  const rowStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between', gap: 14,
    padding: '8px 0', fontSize: 13, borderBottom: '1px solid #f1f5f9',
  }

  return (
    <div style={{ padding: '24px 26px 40px', fontFamily: 'inherit' }}>
      {/* Bouton Retour GLOBAL UNIQUE — page de détail (règle projet). */}
      <Link
        href="/admin/utilisateurs"
        style={{ display: 'inline-block', marginBottom: 16, fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary, #64748b)', textDecoration: 'none' }}
      >
        {t('back_to_list')}
      </Link>

      {loading ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-secondary, #64748b)' }}>{t('loading')}</div>
      ) : error || !u ? (
        <div role="alert" style={{ padding: '28px 20px', textAlign: 'center', background: '#FEE2E2', color: '#991B1B', borderRadius: 12, fontSize: 14 }}>
          {error ?? tErr('generic')}
        </div>
      ) : (
        <>
          {toast && (
            <div
              role="status"
              style={{
                marginBottom: 14, padding: '12px 16px', borderRadius: 10, fontSize: 13,
                background: toast.kind === 'error' ? '#FEE2E2' : '#DCFCE7',
                color: toast.kind === 'error' ? '#991B1B' : '#166534',
              }}
            >
              {toast.msg}
            </div>
          )}

          {/* Cycle de vie suppression : l'admin doit le savoir AVANT d'agir. */}
          {u.anonymized_at && (
            <div role="note" style={{ marginBottom: 14, padding: '12px 16px', borderRadius: 10, background: '#f1f5f9', color: '#475569', fontSize: 13 }}>
              {t('anonymized_notice')}
            </div>
          )}
          {!u.anonymized_at && u.deletion_scheduled_at && (
            <div role="note" style={{ marginBottom: 14, padding: '12px 16px', borderRadius: 10, background: '#FEF9C3', color: '#713F12', fontSize: 13 }}>
              {t('deletion_scheduled_notice', { date: dateFmt.format(new Date(u.deletion_scheduled_at)) })}
            </div>
          )}

          {/* En-tête : identité + actions */}
          <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary, #0f172a)', margin: 0, letterSpacing: '-0.2px' }}>
                {fullName}
              </h1>
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', margin: '4px 0 0' }}>
                {u.email ?? '—'} · {u.user_type ? t(`type_${u.user_type}` as 'type_admin') : '—'}
                {u.ecosystem?.name ? ` · ${u.ecosystem.name}` : ''}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming({ kind: u.status === 'suspended' ? 'reactivate' : 'suspend' })}
                style={btn(u.status !== 'suspended')}
              >
                {u.status === 'suspended' ? t('action_reactivate') : t('action_suspend')}
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirming({ kind: 'revoke' })} style={btn()}>
                {t('action_revoke')}
              </button>
            </div>
          </header>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 14 }}>
            <section style={card} aria-label={t('section_identity')}>
              <h2 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--color-text-secondary, #64748b)', margin: '0 0 10px' }}>
                {t('section_identity')}
              </h2>
              <div style={rowStyle}><span>{t('field_type')}</span><strong>{u.user_type ? t(`type_${u.user_type}` as 'type_admin') : '—'}</strong></div>
              <div style={rowStyle}><span>{t('field_status')}</span><strong>{u.status ? t(`status_${u.status}` as 'status_active') : '—'}</strong></div>
              <div style={rowStyle}><span>{t('field_ecosystem')}</span><strong>{u.ecosystem?.name ?? u.ecosystem?.slug ?? '—'}</strong></div>
              <div style={rowStyle}><span>{t('field_locale')}</span><strong>{u.locale ?? '—'}</strong></div>
              <div style={{ ...rowStyle, borderBottom: 'none' }}><span>{t('field_created')}</span><strong>{dateFmt.format(new Date(u.created_at))}</strong></div>
              {detail?.profile && (
                <Link href={`/admin/experts/${detail.profile.id}`} style={{ display: 'inline-block', marginTop: 10, fontSize: 12.5, fontWeight: 600, color: 'var(--sk-accent, #0ea5e9)', textDecoration: 'none' }}>
                  {t('link_expert_profile')}
                </Link>
              )}
            </section>

            <section style={card} aria-label={t('section_access')}>
              <h2 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--color-text-secondary, #64748b)', margin: '0 0 10px' }}>
                {t('section_access')}
              </h2>
              {/* « Jamais connecté » vient de session_logs, pas de last_login_at :
                  la migration d'inactivité a rétro-rempli cette colonne avec
                  created_at, elle ne prouve donc aucune connexion réelle. */}
              <div style={rowStyle}>
                <span>{t('field_last_login')}</span>
                <strong>{u.has_ever_logged_in && u.last_login_at ? dateTimeFmt.format(new Date(u.last_login_at)) : t('never_logged_in')}</strong>
              </div>
              <div style={rowStyle}><span>{t('field_email_verified')}</span><strong>{u.email_verified ? t('yes') : t('no')}</strong></div>
              {/* Le NUMÉRO n'est jamais affiché — seulement le fait vérifié. */}
              <div style={{ ...rowStyle, borderBottom: 'none' }}><span>{t('field_phone_verified')}</span><strong>{u.phone_verified ? t('yes') : t('no')}</strong></div>
            </section>
          </div>

          {org && (
            <section style={{ ...card, marginBottom: 14 }} aria-label={t('section_organization')}>
              <h2 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--color-text-secondary, #64748b)', margin: '0 0 10px' }}>
                {t('section_organization')}
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{org.company_name ?? '—'}</div>
                  <Link href={`/admin/organisations/${org.id}`} style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--sk-accent, #0ea5e9)', textDecoration: 'none' }}>
                    {t('link_organization')}
                  </Link>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <span style={{ color: 'var(--color-text-secondary, #64748b)' }}>{t('field_role')}</span>
                  <select
                    value={org.role_in_org}
                    disabled={busy}
                    onChange={(e) => setConfirming({ kind: 'role', role: e.target.value, force: false })}
                    style={{ padding: '7px 10px', borderRadius: 9, border: '1px solid var(--color-border-tertiary, #e5e7eb)', fontSize: 13, fontFamily: 'inherit', background: 'var(--color-background-primary, #fff)', color: 'var(--color-text-primary, #0f172a)' }}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{t(`role_${r}` as 'role_admin')}</option>
                    ))}
                  </select>
                </label>
              </div>
            </section>
          )}

          {/* Frise UNIFIÉE connexions + invalidations (fusionnée serveur). */}
          <section style={card} aria-label={t('section_sessions')}>
            <h2 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--color-text-secondary, #64748b)', margin: '0 0 10px' }}>
              {t('section_sessions')} · {t('sessions_count', { count: loginCount })}
            </h2>
            {timeline.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', padding: '10px 0' }}>{t('sessions_empty')}</div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {timeline.map((e, i) => (
                  <li key={`${e.at}-${i}`} style={{ display: 'flex', gap: 12, padding: '9px 0', borderBottom: i === timeline.length - 1 ? 'none' : '1px solid #f1f5f9', fontSize: 12.5, flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--color-text-secondary, #64748b)', minWidth: 150 }}>{dateTimeFmt.format(new Date(e.at))}</span>
                    <span style={{ fontWeight: 600, flex: '1 1 220px' }}>
                      {e.kind === 'login'
                        ? t('session_login')
                        : e.action === 'user_suspended'
                          ? t('session_suspended')
                          : e.by_self
                            ? t('session_revoked_by_self')
                            : t('session_revoked_by_admin')}
                    </span>
                    <span style={{ color: 'var(--color-text-tertiary, #94a3b8)' }}>{e.ip_address ?? '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Confirmation : NOMME ce qui va se passer ─────────────────── */}
          {confirming && (
            <div
              role="dialog"
              aria-modal="true"
              style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 60 }}
            >
              <div style={{ background: '#fff', borderRadius: 14, padding: '22px 24px', maxWidth: 520, width: '100%' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 10px', color: '#0f172a' }}>
                  {confirming.kind === 'role' ? t('confirm_role_title')
                    : confirming.kind === 'revoke' ? t('confirm_revoke_title')
                      : confirming.kind === 'suspend' ? t('confirm_suspend_title')
                        : t('confirm_reactivate_title')}
                </h3>
                <p style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.6, margin: '0 0 12px' }}>
                  {confirming.kind === 'role'
                    ? t('confirm_role_body', {
                        name: fullName,
                        from: t(`role_${org?.role_in_org ?? 'viewer'}` as 'role_admin'),
                        to: t(`role_${confirming.role}` as 'role_admin'),
                        org: org?.company_name ?? '—',
                      })
                    : confirming.kind === 'revoke' ? t('confirm_revoke_body', { name: fullName })
                      : confirming.kind === 'suspend' ? t('confirm_suspend_body', { name: fullName })
                        : t('confirm_reactivate_body', { name: fullName })}
                </p>
                {/* Anti-lock-out : on DIT ce qui arrive à l'organisation. */}
                {confirming.kind === 'role' && confirming.force && (
                  <p role="alert" style={{ fontSize: 13, color: '#991B1B', background: '#FEE2E2', borderRadius: 10, padding: '11px 14px', lineHeight: 1.6, margin: '0 0 12px' }}>
                    {t('confirm_role_last_admin_warning', { org: org?.company_name ?? '—' })}
                  </p>
                )}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setConfirming(null)} style={btn()}>{t('confirm_cancel')}</button>
                  <button
                    type="button"
                    onClick={() => { setPending(confirming); setConfirming(null); setReauthOpen(true) }}
                    style={btn(confirming.kind === 'suspend' || (confirming.kind === 'role' && confirming.force))}
                  >
                    {t('confirm_yes')}
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
              const action = pending
              setPending(null)
              if (action) void run(action, token)
            }}
            onCancel={() => { setReauthOpen(false); setPending(null) }}
          />
        </>
      )}
    </div>
  )
}
