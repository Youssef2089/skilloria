'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { useSecureFetch } from '@/lib/secure-fetch'
import { useDomain } from '@/context/DomainContext'
import LanguageSwitcher from '@/components/LanguageSwitcher'

/**
 * /invitation/[token] — page PUBLIQUE d'acceptation d'invitation (Lot B, B3).
 *
 * Résout le token via GET /api/invitations/resolve (route publique, réponse
 * uniforme si invalide → aucune fuite).
 *
 *  - CAS 1 (session active) : bouton « Accepter » → POST /api/me/invitations/
 *    accept { token } → dashboard.
 *  - CAS 2 (pas de session) : le token N'EST PAS propagé par email (A2). On
 *    amorce l'inscription avec l'email verrouillé + le rôle/domaine DÉRIVÉS de
 *    l'org (A1) ; après confirmation email, l'acceptation se fait par détection
 *    d'email vérifié (PendingInvitationGate), pas par ce token.
 *  - Compte déjà existant (email_already_exists) mais non connecté → invite à se
 *    connecter (l'acceptation se fera à la 1re session, par détection d'email).
 */

const font = 'var(--font-jakarta), Inter, system-ui, sans-serif'

type Resolved = {
  valid: true
  company_name: string | null
  role_in_org: string
  email: string
  email_already_exists: boolean
  signup_role: 'entreprise' | 'cabinet'
  domain_slug: string | null
  // null = acceptable ; sinon code de refus (compte expert/admin/autre org).
  blocked_reason:
    | 'email_is_expert_account'
    | 'email_is_admin_account'
    | 'email_already_in_organization'
    | null
}

type View =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'ready'; data: Resolved; hasSession: boolean }
  | { kind: 'accepted' }
  | { kind: 'signup_sent' }

export default function InvitationPage() {
  const params = useParams()
  const token = String(params.token ?? '')
  const t = useTranslations('invitation_public')
  const locale = useLocale()
  const domain = useDomain()
  const router = useRouter()
  const secureFetch = useSecureFetch()

  const [view, setView] = useState<View>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Champs d'inscription (cas 2).
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [cgu, setCgu] = useState(false)

  const roleLabel = (r: string) => t(`role_${r}` as 'role_admin')

  const resolve = useCallback(async () => {
    try {
      const [res, sess] = await Promise.all([
        fetch(`/api/invitations/resolve?token=${encodeURIComponent(token)}`),
        supabase.auth.getSession(),
      ])
      if (!res.ok) { setView({ kind: 'invalid' }); return }
      const data = (await res.json()) as { valid?: boolean } & Resolved
      if (!data?.valid) { setView({ kind: 'invalid' }); return }
      setView({ kind: 'ready', data, hasSession: !!sess.data.session?.user })
    } catch (e) {
      console.error('[invitation] resolve failed', e)
      setView({ kind: 'invalid' })
    }
  }, [token])

  useEffect(() => { void resolve() }, [resolve])

  // ── Cas 1 : accepter (session active) ──────────────────────────────────────
  async function accept() {
    if (busy) return
    setBusy(true)
    setErr('')
    try {
      const res = await secureFetch('/api/me/invitations/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setErr(body?.code === 'email_mismatch' ? t('err_email_mismatch') : t('err_generic'))
        return
      }
      setView({ kind: 'accepted' })
      setTimeout(() => { window.location.href = `/${locale}/dashboard/entreprise` }, 1400)
    } finally {
      setBusy(false)
    }
  }

  // ── Cas 2 : créer un compte (email verrouillé, rôle/domaine dérivés) ────────
  async function signup(e: React.FormEvent) {
    e.preventDefault()
    if (busy || view.kind !== 'ready') return
    if (!cgu) { setErr(t('err_cgu')); return }
    if (password.length < 8) { setErr(t('err_password_short')); return }
    setBusy(true)
    setErr('')
    try {
      const { error } = await supabase.auth.signUp({
        email: view.data.email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/${locale}/auth/callback`,
          data: {
            firstname: firstName.trim(),
            lastname: lastName.trim(),
            // A1 : rôle/domaine DÉRIVÉS de l'org, l'invité ne les choisit pas.
            role: view.data.signup_role,
            domain_slug: view.data.domain_slug ?? domain.subdomain,
          },
        },
      })
      if (error) { setErr(error.message); return }
      setView({ kind: 'signup_sent' })
    } finally {
      setBusy(false)
    }
  }

  // ── Rendu ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 24, fontFamily: font }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28, flexWrap: 'wrap', justifyContent: 'center' }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{domain.name}</span>
        <LanguageSwitcher />
      </div>

      <div style={{ background: '#fff', borderRadius: 20, border: '1px solid #e2e8f0', padding: 36, width: '100%', maxWidth: 460, boxShadow: '0 4px 24px rgba(0,0,0,0.05)' }}>
        {view.kind === 'loading' && <p style={{ color: '#64748b', margin: 0 }}>{t('loading')}</p>}

        {view.kind === 'invalid' && (
          <>
            <h1 style={{ fontSize: 19, fontWeight: 800, color: '#0f172a', margin: '0 0 10px' }}>{t('invalid_title')}</h1>
            <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.55, margin: '0 0 20px' }}>{t('invalid_body')}</p>
            <button type="button" onClick={() => router.push('/')} style={primaryBtn(domain.primaryColor)}>{t('go_home')}</button>
          </>
        )}

        {view.kind === 'accepted' && (
          <>
            <h1 style={{ fontSize: 19, fontWeight: 800, color: '#0f172a', margin: '0 0 10px' }}>{t('accepted_title')}</h1>
            <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>{t('accepted_body')}</p>
          </>
        )}

        {view.kind === 'signup_sent' && (
          <>
            <h1 style={{ fontSize: 19, fontWeight: 800, color: '#0f172a', margin: '0 0 10px' }}>{t('signup_sent_title')}</h1>
            <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.55, margin: 0 }}>{t('signup_sent_body')}</p>
          </>
        )}

        {view.kind === 'ready' && (
          <>
            <h1 style={{ fontSize: 19, fontWeight: 800, color: '#0f172a', margin: '0 0 8px' }}>
              {t('invite_title', { company: view.data.company_name ?? '—' })}
            </h1>
            <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.55, margin: '0 0 20px' }}>
              {t('invite_body', { company: view.data.company_name ?? '—', role: roleLabel(view.data.role_in_org) })}
            </p>

            {err && <p style={{ fontSize: 13, color: '#B91C1C', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 12px', margin: '0 0 16px' }}>{err}</p>}

            {/* BLOCAGE (filet serveur) : compte expert/admin ou déjà dans une
                autre org → message explicite, aucune action d'acceptation. */}
            {view.data.blocked_reason && (
              <p role="alert" style={{ fontSize: 13.5, color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '12px 14px', margin: 0, lineHeight: 1.55 }}>
                {t(`blocked_${view.data.blocked_reason}` as 'blocked_email_is_expert_account')}
              </p>
            )}

            {/* CAS 1 : déjà connecté → accepter directement. */}
            {!view.data.blocked_reason && view.hasSession && (
              <button type="button" disabled={busy} onClick={accept} style={{ ...primaryBtn(domain.primaryColor), opacity: busy ? 0.6 : 1 }}>
                {t('accept_cta')}
              </button>
            )}

            {/* CAS "compte existant non connecté" → invitation à se connecter. */}
            {!view.data.blocked_reason && !view.hasSession && view.data.email_already_exists && (
              <>
                <p style={{ fontSize: 13.5, color: '#475569', margin: '0 0 12px', lineHeight: 1.5 }}>{t('existing_account_body')}</p>
                <button type="button" onClick={() => router.push('/connexion')} style={primaryBtn(domain.primaryColor)}>{t('signin_cta')}</button>
              </>
            )}

            {/* CAS 2 : pas de compte → inscription (email verrouillé). */}
            {!view.data.blocked_reason && !view.hasSession && !view.data.email_already_exists && (
              <form onSubmit={signup} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Field label={t('email_label')}>
                  <input value={view.data.email} readOnly style={{ ...inputStyle, background: '#f1f5f9', color: '#64748b' }} />
                </Field>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <Field label={t('firstname_label')} style={{ flex: '1 1 140px' }}>
                    <input value={firstName} onChange={(e) => setFirstName(e.target.value)} style={inputStyle} />
                  </Field>
                  <Field label={t('lastname_label')} style={{ flex: '1 1 140px' }}>
                    <input value={lastName} onChange={(e) => setLastName(e.target.value)} style={inputStyle} />
                  </Field>
                </div>
                <Field label={t('password_label')}>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} placeholder={t('password_placeholder')} />
                </Field>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: '#475569', lineHeight: 1.45 }}>
                  <input type="checkbox" checked={cgu} onChange={(e) => setCgu(e.target.checked)} style={{ marginTop: 2 }} />
                  <span>{t('cgu_label')}</span>
                </label>
                <button type="submit" disabled={busy} style={{ ...primaryBtn(domain.primaryColor), opacity: busy ? 0.6 : 1 }}>{t('signup_cta')}</button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1.5px solid #e2e8f0',
  borderRadius: 10, fontSize: 14, fontFamily: font, outline: 'none',
}
function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={style}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  )
}
function primaryBtn(color: string): React.CSSProperties {
  return { border: 'none', borderRadius: 10, padding: '11px 20px', fontSize: 14, fontWeight: 700, fontFamily: font, color: '#fff', background: color, cursor: 'pointer', width: '100%' }
}
