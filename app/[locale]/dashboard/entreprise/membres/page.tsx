'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /dashboard/entreprise/membres — page « Membres équipe » (Lot B, B1).
 *
 * Données servies par GET /api/me/organisation/members (membres + invitations
 * pending — ces dernières uniquement pour un admin). Toute ÉCRITURE passe par
 * les routes serveur (D2) : inviter, changer un rôle, retirer, révoquer,
 * renvoyer, quitter. Aucune écriture client-directe sur les tables org.
 *
 * Règles UI :
 *  - actions ADMIN uniquement (masquées sinon, avec mention en lecture seule) ;
 *  - aucune action sur SA PROPRE ligne (cohérent RLS M4) ; à la place, action
 *    « Quitter l'organisation » distincte (B5) ;
 *  - garde anti lock-out appliquée côté serveur : un refus 'last_admin' est
 *    remonté en message explicite.
 */

const fontJakarta = 'var(--font-jakarta), system-ui, sans-serif'

type Member = {
  id: string
  user_id: string
  role_in_org: string
  status: string
  joined_at: string
  first_name: string | null
  last_name: string | null
  email: string | null
}
type Invitation = {
  id: string
  email: string
  role_in_org: string
  status: string
  expires_at: string
  domain_validation_passed: boolean
  email_already_exists: boolean
  created_at: string
}
type Data = { members: Member[]; invitations: Invitation[]; isAdmin: boolean; me: string }

const ROLES = ['admin', 'editor', 'viewer'] as const

// ─── primitives ──────────────────────────────────────────────────────────────
function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ background: '#fff', border: '1.5px solid #eef2f7', borderRadius: 18, padding: 'clamp(16px, 3vw, 24px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function RoleBadge({ role, label }: { role: string; label: string }) {
  const c =
    role === 'admin' ? { bg: '#EEF2FF', fg: '#3730A3' }
      : role === 'editor' ? { bg: '#ECFEFF', fg: '#155E75' }
        : { bg: '#F1F5F9', fg: '#475569' }
  return (
    <span style={{ background: c.bg, color: c.fg, borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>{label}</span>
  )
}

const btnBase: React.CSSProperties = {
  border: '1.5px solid #e2e8f0', background: '#fff', borderRadius: 9, padding: '7px 12px',
  fontSize: 13, fontWeight: 600, fontFamily: fontJakarta, cursor: 'pointer', color: '#334155',
}
const btnDanger: React.CSSProperties = { ...btnBase, borderColor: '#FECACA', color: '#B91C1C' }
const btnPrimary: React.CSSProperties = {
  ...btnBase, border: 'none', background: 'var(--sk-accent, #0369a1)', color: '#fff',
}

export default function MembresPage() {
  const t = useTranslations('dashboard_entreprise.membres')
  const locale = useLocale()
  const secureFetch = useSecureFetch()
  const fmtDate = useCallback((iso: string): string => {
    try { return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso)) } catch { return iso }
  }, [locale])

  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; data: Data }>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Formulaire d'invitation.
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<string>('viewer')
  // Confirmation « Quitter ».
  const [leaveOpen, setLeaveOpen] = useState(false)

  const notify = useCallback((msg: string, kind: 'success' | 'error' = 'success') => {
    setToast({ msg, kind })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4200)
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await secureFetch('/api/me/organisation/members')
      if (!res.ok) { setState({ kind: 'error' }); return }
      setState({ kind: 'ready', data: (await res.json()) as Data })
    } catch (err) {
      console.error('[entreprise/membres] load failed', err)
      setState({ kind: 'error' })
    }
  }, [secureFetch])

  useEffect(() => { void load() }, [load])
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  const roleLabel = (r: string) => t(`role_${r}` as 'role_admin')

  /** Traduit un code d'erreur serveur en message localisé. */
  const errMessage = (code: string | undefined): string => {
    switch (code) {
      case 'already_member': return t('err_already_member')
      case 'already_invited': return t('err_already_invited')
      case 'last_admin': return t('err_last_admin')
      case 'invalid_email': return t('err_invalid_email')
      case 'self_forbidden': return t('err_self_forbidden')
      default: return t('err_generic')
    }
  }

  async function doInvite(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const res = await secureFetch('/api/me/organisation/invitations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role_in_org: inviteRole }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { notify(errMessage(body?.code), 'error'); return }
      setInviteEmail('')
      notify(t('invite_sent'))
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function changeRole(m: Member, role: string) {
    if (busy || role === m.role_in_org) return
    setBusy(true)
    try {
      const res = await secureFetch(`/api/me/organisation/members/${m.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role_in_org: role }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { notify(errMessage(body?.code), 'error'); await load(); return }
      notify(t('role_changed'))
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function removeMember(m: Member) {
    if (busy) return
    if (!window.confirm(t('remove_confirm', { name: displayName(m) }))) return
    setBusy(true)
    try {
      const res = await secureFetch(`/api/me/organisation/members/${m.id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { notify(errMessage(body?.code), 'error'); return }
      notify(t('member_removed'))
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function invitationAction(inv: Invitation, action: 'revoke' | 'resend') {
    if (busy) return
    setBusy(true)
    try {
      const res = await secureFetch(`/api/me/organisation/invitations/${inv.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { notify(errMessage(body?.code), 'error'); return }
      notify(action === 'revoke' ? t('invite_revoked') : t('invite_resent'))
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function leaveOrg() {
    if (busy) return
    setBusy(true)
    try {
      const res = await secureFetch('/api/me/organisation/leave', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { notify(errMessage(body?.code), 'error'); setLeaveOpen(false); return }
      notify(t('left_org'))
      setLeaveOpen(false)
      window.location.href = '/'
    } finally {
      setBusy(false)
    }
  }

  if (state.kind === 'loading') return <div style={{ padding: 24, fontFamily: fontJakarta, color: '#64748b' }}>{t('loading')}</div>
  if (state.kind === 'error') return <div style={{ padding: 24, fontFamily: fontJakarta, color: '#991B1B' }}>{t('error_load')}</div>

  const { members, invitations, isAdmin, me } = state.data

  return (
    <div style={{ fontFamily: fontJakarta, display: 'flex', flexDirection: 'column', gap: 18, width: '100%', padding: '24px 26px 28px', boxSizing: 'border-box' }}>
      {!isAdmin && (
        <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>{t('read_only_notice')}</p>
      )}

      {/* ─── Inviter (admin) ─────────────────────────────────────────────────── */}
      {isAdmin && (
        <Card title={t('invite_title')}>
          <form onSubmit={doInvite} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>{t('invite_email_label')}</label>
              <input
                type="email" required value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                placeholder={t('invite_email_placeholder')}
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, fontFamily: fontJakarta, outline: 'none' }}
              />
            </div>
            <div style={{ flex: '0 0 auto' }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>{t('invite_role_label')}</label>
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} style={{ padding: '10px 12px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, fontFamily: fontJakarta, background: '#fff' }}>
                {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </select>
            </div>
            <button type="submit" disabled={busy} style={{ ...btnPrimary, padding: '10px 18px', opacity: busy ? 0.6 : 1 }}>{t('invite_cta')}</button>
          </form>
        </Card>
      )}

      {/* ─── Membres actifs ──────────────────────────────────────────────────── */}
      <Card title={t('members_title', { count: members.length })}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {members.map((m) => {
            const isSelf = m.user_id === me
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
                    {displayName(m)} {isSelf && <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>· {t('you')}</span>}
                  </div>
                  <div style={{ fontSize: 12.5, color: '#64748b' }}>{m.email}</div>
                </div>
                <div style={{ fontSize: 12.5, color: '#94a3b8', flex: '0 0 auto' }}>{t('joined_on', { date: fmtDate(m.joined_at) })}</div>

                {/* Actions admin, jamais sur soi-même (RLS M4). */}
                {isAdmin && !isSelf ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: '0 0 auto' }}>
                    <select
                      value={m.role_in_org} disabled={busy}
                      onChange={(e) => changeRole(m, e.target.value)}
                      style={{ ...btnBase, padding: '6px 10px' }}
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                    </select>
                    <button type="button" disabled={busy} onClick={() => removeMember(m)} style={btnDanger}>{t('remove')}</button>
                  </div>
                ) : (
                  <div style={{ flex: '0 0 auto' }}><RoleBadge role={m.role_in_org} label={roleLabel(m.role_in_org)} /></div>
                )}
              </div>
            )
          })}
        </div>

        {/* Quitter l'organisation (action sur SA propre ligne — B5). */}
        <div style={{ marginTop: 16 }}>
          {!leaveOpen ? (
            <button type="button" onClick={() => setLeaveOpen(true)} style={btnDanger}>{t('leave_cta')}</button>
          ) : (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '12px 14px', maxWidth: 520 }}>
              <p style={{ margin: '0 0 10px', fontSize: 13, color: '#991B1B', lineHeight: 1.5 }}>{t('leave_confirm')}</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" disabled={busy} onClick={leaveOrg} style={{ ...btnDanger, background: '#DC2626', color: '#fff', border: 'none' }}>{t('leave_confirm_cta')}</button>
                <button type="button" disabled={busy} onClick={() => setLeaveOpen(false)} style={btnBase}>{t('cancel')}</button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* ─── Invitations en attente (admin) ──────────────────────────────────── */}
      {isAdmin && (
        <Card title={t('invitations_title', { count: invitations.length })}>
          {invitations.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13.5, color: '#94a3b8' }}>{t('invitations_empty')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {invitations.map((inv) => (
                <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {inv.email}
                      {!inv.domain_validation_passed && (
                        <span title={t('domain_warning')} style={{ background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A', borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                          {t('domain_warning_badge')}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12.5, color: '#64748b' }}>
                      {t('invited_on', { date: fmtDate(inv.created_at) })} · {t('expires_on', { date: fmtDate(inv.expires_at) })}
                    </div>
                  </div>
                  <RoleBadge role={inv.role_in_org} label={roleLabel(inv.role_in_org)} />
                  <div style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>
                    <button type="button" disabled={busy} onClick={() => invitationAction(inv, 'resend')} style={btnBase}>{t('resend')}</button>
                    <button type="button" disabled={busy} onClick={() => invitationAction(inv, 'revoke')} style={btnDanger}>{t('revoke')}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {toast && (
        <div role="status" style={{ position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)', zIndex: 900, padding: '12px 20px', borderRadius: 12, fontSize: 14, fontWeight: 600, fontFamily: fontJakarta, color: '#fff', background: toast.kind === 'error' ? '#dc2626' : '#16a34a', boxShadow: '0 10px 30px rgba(15,23,42,0.2)' }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

function displayName(m: { first_name: string | null; last_name: string | null; email: string | null }): string {
  const full = [m.first_name, m.last_name].filter((s) => s && s.trim()).join(' ').trim()
  return full || (m.email ?? '—')
}
