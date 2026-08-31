'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from '@/i18n/navigation'
import { routing, type Locale } from '@/i18n/routing'
import { supabase } from '@/lib/supabase'
import { useSecureFetch } from '@/lib/secure-fetch'
import ReauthModal from './ReauthModal'

const fontJakarta = 'var(--font-jakarta), system-ui, sans-serif'

/**
 * Normalise un numéro saisi vers le format E.164 (+33…) avant l'appel Vonage.
 *   - retire espaces et séparateurs courants
 *   - `+…`        → conservé tel quel (déjà international)
 *   - `00…`       → préfixe international ISO → `+…`
 *   - `0XXXXXXXXX`→ numéro national : défaut FR → `+33XXXXXXXXX`
 *   - sinon       → laissé tel quel (la validation E.164 tranchera)
 */
function toE164(raw: string): string {
  const s = raw.replace(/[\s().\-]/g, '')
  if (s.startsWith('+')) return s
  if (s.startsWith('00')) return '+' + s.slice(2)
  if (s.startsWith('0')) return '+33' + s.slice(1)
  return s
}

type SectionId = 'identity' | 'email' | 'phone' | 'password' | 'language' | 'security' | 'notifications' | 'deletion'
// Notifications s'insère entre Sécurité et Suppression (réglages fonctionnels
// d'abord, action destructive en dernier). Réservé aux experts (freelance/cdi) :
// filtré pour l'entreprise (pas de matching d'opportunités sur son profil).
const SECTIONS: SectionId[] = ['identity', 'email', 'phone', 'password', 'language', 'security', 'notifications', 'deletion']

type UserData = {
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  phone_verified: boolean
  locale: string | null
}

/**
 * Un réglage de notification, TEL QUE SERVI par le serveur.
 * Le client ne construit jamais cette liste : elle vient du catalogue
 * (lib/notifications/catalog.ts) filtré pour ce compte. Un réglage absent de
 * la réponse n'existe pas pour cet utilisateur.
 */
type NotificationSetting = {
  event: string
  channel: 'email' | 'sms'
  /**
   * Vocabulaire à employer pour CE lecteur, DÉRIVÉ SERVEUR. `null` = l'événement
   * n'a qu'une voix. Le composant ne déduit jamais la voix de son propre côté :
   * c'est ce qui empêche un expert de lire « Un expert postule à l'une de vos
   * annonces » alors qu'il ne peut recevoir que des réponses à ses besoins de
   * sous-traitance.
   */
  voice: 'expert' | 'org' | null
  /**
   * Mode d'envoi de l'événement, DÉRIVÉ SERVEUR du catalogue — même source que
   * le dispatcher. `digest` = les notifications en attente d'un même événement
   * partent en un seul message ; `per_item` = un message par notification.
   * C'est ce champ, et non le type de compte, qui décide de la note de bas
   * d'écran : une organisation ne reçoit aucun événement `digest`, la phrase
   * sur le regroupement ne s'affiche donc pas chez elle.
   */
  grouping: 'digest' | 'per_item'
  enabled: boolean
}

type RequestReauth = () => Promise<string | null>
type Notify = (msg: string, kind?: 'success' | 'error') => void
type SecureFetch = ReturnType<typeof useSecureFetch>

// ─── primitives UI ──────────────────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>{children}</label>
}
function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        width: '100%', boxSizing: 'border-box', padding: '11px 13px',
        border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, outline: 'none',
        fontFamily: fontJakarta, ...(props.style || {}),
      }}
    />
  )
}
function PrimaryButton({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      style={{
        padding: '11px 18px', borderRadius: 10, border: 'none',
        background: 'var(--sk-accent, #0ea5e9)', color: '#fff', fontSize: 14, fontWeight: 700,
        cursor: rest.disabled ? 'default' : 'pointer', opacity: rest.disabled ? 0.55 : 1,
        fontFamily: fontJakarta, ...(rest.style || {}),
      }}
    >
      {children}
    </button>
  )
}
function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{title}</h2>
      <p style={{ margin: '6px 0 0', fontSize: 14, color: '#64748b', lineHeight: 1.5 }}>{description}</p>
    </div>
  )
}
function FieldRow({ children }: { children: React.ReactNode }) {
  return <div style={{ marginBottom: 16, maxWidth: 460 }}>{children}</div>
}
function Switch({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 46, height: 27, borderRadius: 999, border: 'none', padding: 0, flexShrink: 0,
        cursor: disabled ? 'not-allowed' : 'pointer', position: 'relative',
        background: checked ? 'var(--sk-accent, #0ea5e9)' : '#cbd5e1', opacity: disabled ? 0.45 : 1,
        transition: 'background .15s',
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute', top: 3, left: checked ? 22 : 3, width: 21, height: 21, borderRadius: '50%',
          background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.25)', transition: 'left .15s',
        }}
      />
    </button>
  )
}

// ─── Section: Identité ──────────────────────────────────────────────────────
function IdentitySection({ user, secureFetch, requestReauth, notify, reload }: {
  user: UserData; secureFetch: SecureFetch; requestReauth: RequestReauth; notify: Notify; reload: () => void
}) {
  const t = useTranslations('settings.identity')
  const tc = useTranslations('settings.common')
  const [first, setFirst] = useState(user.first_name ?? '')
  const [last, setLast] = useState(user.last_name ?? '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!first.trim() || !last.trim()) { notify(tc('required'), 'error'); return }
    const token = await requestReauth()
    if (!token) return
    setBusy(true)
    try {
      const res = await secureFetch('/api/me/identity', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-reauth-token': token },
        body: JSON.stringify({ first_name: first.trim(), last_name: last.trim() }),
      })
      if (!res.ok) { notify(tc('error_generic'), 'error'); setBusy(false); return }
      notify(t('success'))
      reload()
    } catch { notify(tc('error_generic'), 'error') }
    setBusy(false)
  }

  return (
    <div>
      <SectionHeader title={t('title')} description={t('description')} />
      <FieldRow><Label>{t('first_name')}</Label><Input value={first} onChange={(e) => setFirst(e.target.value)} /></FieldRow>
      <FieldRow><Label>{t('last_name')}</Label><Input value={last} onChange={(e) => setLast(e.target.value)} /></FieldRow>
      <PrimaryButton onClick={() => void save()} disabled={busy}>{busy ? tc('saving') : t('save')}</PrimaryButton>
    </div>
  )
}

// ─── Section: Email ─────────────────────────────────────────────────────────
function EmailSection({ user, secureFetch, requestReauth, notify }: {
  user: UserData; secureFetch: SecureFetch; requestReauth: RequestReauth; notify: Notify
}) {
  const t = useTranslations('settings.email')
  const tc = useTranslations('settings.common')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!email.trim()) { notify(tc('required'), 'error'); return }
    const token = await requestReauth()
    if (!token) return
    setBusy(true)
    try {
      const res = await secureFetch('/api/me/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reauth-token': token },
        body: JSON.stringify({ new_email: email.trim() }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { code?: string } | null
        notify(d?.code === 'email_taken' ? t('error_taken') : t('error_failed'), 'error')
        setBusy(false)
        return
      }
      notify(t('success'))
      setEmail('')
    } catch { notify(t('error_failed'), 'error') }
    setBusy(false)
  }

  return (
    <div>
      <SectionHeader title={t('title')} description={t('description')} />
      <FieldRow><Label>{t('current_label')}</Label><Input value={user.email ?? ''} disabled style={{ background: '#f8fafc', color: '#64748b' }} /></FieldRow>
      <FieldRow><Label>{t('new_label')}</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('new_placeholder')} /></FieldRow>
      <p style={{ fontSize: 13, color: '#64748b', maxWidth: 460, lineHeight: 1.5, marginTop: -4, marginBottom: 16 }}>{t('confirmation_info')}</p>
      <PrimaryButton onClick={() => void submit()} disabled={busy}>{busy ? tc('saving') : t('submit')}</PrimaryButton>
    </div>
  )
}

// ─── Section: Téléphone (réutilise le flux OTP Vonage existant) ──────────────
function PhoneSection({ user, secureFetch, requestReauth, notify, reload }: {
  user: UserData; secureFetch: SecureFetch; requestReauth: RequestReauth; notify: Notify; reload: () => void
}) {
  const t = useTranslations('settings.phone')
  const tc = useTranslations('settings.common')
  const [phone, setPhone] = useState('')
  const [requestId, setRequestId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const sendCode = async () => {
    const e164 = toE164(phone)
    if (!/^\+[1-9]\d{6,14}$/.test(e164)) { notify(tc('error_generic'), 'error'); return }
    const token = await requestReauth()
    if (!token) return
    setBusy(true)
    try {
      const res = await secureFetch('/api/auth/send-phone-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reauth-token': token },
        body: JSON.stringify({ phone: e164 }),
      })
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { code?: string } | null
        notify(e?.code === 'rate_limited' ? t('error_rate_limited') : tc('error_generic'), 'error')
        setBusy(false); return
      }
      const d = (await res.json()) as { request_id?: string }
      setRequestId(d.request_id ?? null)
    } catch { notify(tc('error_generic'), 'error') }
    setBusy(false)
  }

  const verify = async () => {
    const e164 = toE164(phone)
    if (!/^\d{4,6}$/.test(code) || !requestId) { notify(t('error_invalid_code'), 'error'); return }
    setBusy(true)
    try {
      const res = await secureFetch('/api/auth/verify-phone-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, code, phone: e164 }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { code?: string } | null
        notify(
          d?.code === 'rate_limited'
            ? t('error_rate_limited')
            : d?.code === 'expired'
              ? t('error_expired')
              : d?.code === 'phone_already_used'
                ? t('error_phone_already_used')
                : t('error_invalid_code'),
          'error',
        )
        setBusy(false)
        return
      }
      notify(t('success'))
      setRequestId(null); setCode(''); setPhone('')
      reload()
    } catch { notify(t('error_failed'), 'error') }
    setBusy(false)
  }

  return (
    <div>
      <SectionHeader title={t('title')} description={t('description')} />
      <FieldRow><Label>{t('current_label')}</Label><Input value={user.phone ?? '—'} disabled style={{ background: '#f8fafc', color: '#64748b' }} /></FieldRow>
      {!requestId ? (
        <>
          <FieldRow><Label>{t('new_label')}</Label><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('new_placeholder')} /></FieldRow>
          <PrimaryButton onClick={() => void sendCode()} disabled={busy}>{busy ? tc('saving') : t('send_code')}</PrimaryButton>
        </>
      ) : (
        <>
          <p style={{ fontSize: 13, color: '#64748b', maxWidth: 460, lineHeight: 1.5, marginBottom: 12 }}>{t('otp_info')}</p>
          <FieldRow><Label>{t('code_label')}</Label><Input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder={t('code_placeholder')} maxLength={6} /></FieldRow>
          <div style={{ display: 'flex', gap: 10 }}>
            <PrimaryButton onClick={() => void verify()} disabled={busy}>{busy ? tc('saving') : t('verify')}</PrimaryButton>
            <button type="button" onClick={() => { setRequestId(null); setCode('') }} style={{ padding: '11px 16px', borderRadius: 10, border: '1.5px solid #e2e8f0', background: '#fff', color: '#0f172a', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: fontJakarta }}>{t('resend')}</button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Section: Mot de passe ──────────────────────────────────────────────────
function PasswordSection({ secureFetch, requestReauth, notify }: {
  secureFetch: SecureFetch; requestReauth: RequestReauth; notify: Notify
}) {
  const t = useTranslations('settings.password')
  const tc = useTranslations('settings.common')
  const [pwd, setPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (pwd.length < 8) { notify(t('error_weak'), 'error'); return }
    if (pwd !== confirm) { notify(t('error_mismatch'), 'error'); return }
    const token = await requestReauth()
    if (!token) return
    setBusy(true)
    try {
      const res = await secureFetch('/api/me/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reauth-token': token },
        body: JSON.stringify({ new_password: pwd }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { code?: string } | null
        notify(d?.code === 'password_same_as_old' ? t('error_same') : t('error_failed'), 'error')
        setBusy(false)
        return
      }
      notify(t('success'))
      setPwd(''); setConfirm('')
    } catch { notify(t('error_failed'), 'error') }
    setBusy(false)
  }

  return (
    <div>
      <SectionHeader title={t('title')} description={t('description')} />
      <FieldRow><Label>{t('new_label')}</Label><Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder={t('new_placeholder')} /></FieldRow>
      <FieldRow><Label>{t('confirm_label')}</Label><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={t('confirm_placeholder')} /></FieldRow>
      <PrimaryButton onClick={() => void submit()} disabled={busy}>{busy ? tc('saving') : t('submit')}</PrimaryButton>
    </div>
  )
}

// ─── Section: Langue ────────────────────────────────────────────────────────
const LOCALE_LABELS: Record<Locale, string> = { fr: 'Français', en: 'English', es: 'Español', de: 'Deutsch' }
function LanguageSection({ secureFetch, notify }: {
  secureFetch: SecureFetch; notify: Notify
}) {
  const t = useTranslations('settings.language')
  const tc = useTranslations('settings.common')
  const current = useLocale() as Locale
  const router = useRouter()
  const pathname = usePathname()
  const [busy, setBusy] = useState(false)

  const change = async (loc: Locale) => {
    if (loc === current || busy) return
    setBusy(true)
    try {
      // Persiste la préférence (users.locale) PUIS bascule l'URL (next-intl).
      const res = await secureFetch('/api/me/locale', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: loc }),
      })
      if (!res.ok) { notify(tc('error_generic'), 'error'); setBusy(false); return }
      notify(t('success'))
      router.replace(pathname, { locale: loc })
    } catch { setBusy(false) }
  }

  return (
    <div>
      <SectionHeader title={t('title')} description={t('description')} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 460 }}>
        {(routing.locales as readonly Locale[]).map((loc) => {
          const active = loc === current
          return (
            <button
              key={loc}
              type="button"
              onClick={() => void change(loc)}
              disabled={busy}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '13px 16px', borderRadius: 12, cursor: 'pointer', fontFamily: fontJakarta,
                border: active ? '2px solid var(--sk-accent, #0ea5e9)' : '1.5px solid #e2e8f0',
                background: active ? 'color-mix(in srgb, var(--sk-accent, #0ea5e9) 8%, #fff)' : '#fff',
                fontSize: 14, fontWeight: active ? 700 : 500, color: '#0f172a',
              }}
            >
              <span>{LOCALE_LABELS[loc]}</span>
              {active && <span aria-hidden style={{ color: 'var(--sk-accent, #0ea5e9)' }}>✓</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Section: Sécurité ──────────────────────────────────────────────────────
function SecuritySection({ secureFetch, notify }: {
  secureFetch: SecureFetch; notify: Notify
}) {
  const t = useTranslations('settings.security')
  const tc = useTranslations('settings.common')
  const [busy, setBusy] = useState(false)

  const revoke = async () => {
    setBusy(true)
    try {
      const res = await secureFetch('/api/me/sessions/revoke-others', { method: 'POST' })
      if (!res.ok) { notify(tc('error_generic'), 'error'); setBusy(false); return }
      notify(t('revoke_success'))
    } catch { setBusy(false) }
    setBusy(false)
  }

  return (
    <div>
      <SectionHeader title={t('title')} description={t('description')} />
      <div style={{ maxWidth: 560, padding: 18, border: '1.5px solid #e2e8f0', borderRadius: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{t('revoke_title')}</h3>
        <p style={{ margin: '6px 0 14px', fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>{t('revoke_desc')}</p>
        <PrimaryButton onClick={() => void revoke()} disabled={busy}>{t('revoke_button')}</PrimaryButton>
      </div>
    </div>
  )
}

// ─── Section: Suppression du compte ─────────────────────────────────────────
function DeletionSection({ secureFetch, requestReauth, notify }: {
  secureFetch: SecureFetch; requestReauth: RequestReauth; notify: Notify
}) {
  const t = useTranslations('settings.deletion')
  const router = useRouter()
  const word = t('confirm_word')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const armed = typed.trim().toUpperCase() === word.toUpperCase()

  const del = async () => {
    if (!armed) return
    const token = await requestReauth()
    if (!token) return
    setBusy(true)
    try {
      const res = await secureFetch('/api/me/account/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reauth-token': token },
      })
      if (!res.ok) {
        // Le refus « dernier administrateur » (409) N'EST PAS une panne : il a
        // un remède, et l'utilisateur doit le lire. Sans cette distinction,
        // toute réponse non-OK affichait « Impossible de programmer la
        // suppression » — indiscernable d'une erreur serveur, sans indication
        // de ce qu'il fallait faire.
        // Le refus reste SERVEUR : le bouton n'est jamais masqué, l'admin peut
        // tenter et comprendre.
        const payload = (await res.json().catch(() => null)) as { code?: string } | null
        notify(
          payload?.code === 'last_platform_admin'
            ? t('error_last_platform_admin')
            : t('error_failed'),
          'error',
        )
        setBusy(false)
        return
      }
      // C1 : la route delete a révoqué la session serveur (signOut global +
      // last_session_token vidé + cookie effacé). On coupe AUSSI la session
      // locale supabase-js — sans jeton local, plus aucune lecture directe
      // Supabase possible immédiatement. L'écran /reactivation détecte
      // l'absence de session et invite à se reconnecter pour réactiver.
      await supabase.auth.signOut()
      router.replace('/reactivation')
    } catch { notify(t('error_failed'), 'error'); setBusy(false) }
  }

  return (
    <div>
      <SectionHeader title={t('title')} description={t('description')} />
      <div style={{ maxWidth: 560, padding: 18, border: '1.5px solid #fecaca', background: '#fef2f2', borderRadius: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#b91c1c' }}>{t('warning_title')}</h3>
        {/* C5 : deux temporalités SÉPARÉES — immédiat vs 90 jours. */}
        <div style={{ margin: '10px 0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ margin: 0, fontSize: 13.5, color: '#7f1d1d', lineHeight: 1.55 }}>
            <strong>{t('warning_immediate_label')} </strong>{t('warning_immediate')}
          </p>
          <p style={{ margin: 0, fontSize: 13.5, color: '#7f1d1d', lineHeight: 1.55 }}>
            <strong>{t('warning_delayed_label')} </strong>{t('warning_delayed')}
          </p>
        </div>
        <Label>{t('confirm_instruction', { word })}</Label>
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t('confirm_placeholder', { word })} style={{ maxWidth: 280, marginBottom: 14 }} />
        <div>
          <button
            type="button"
            onClick={() => void del()}
            disabled={!armed || busy}
            style={{
              padding: '11px 18px', borderRadius: 10, border: 'none', fontFamily: fontJakarta,
              background: '#dc2626', color: '#fff', fontSize: 14, fontWeight: 700,
              cursor: armed && !busy ? 'pointer' : 'default', opacity: armed && !busy ? 1 : 0.5,
            }}
          >
            {t('button')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Section: Notifications ─────────────────────────────────────────────────
function NotificationsSection({ user, secureFetch, notify, goToPhone }: {
  user: UserData; secureFetch: SecureFetch; notify: Notify; goToPhone: () => void
}) {
  const t = useTranslations('settings.notifications')
  const tc = useTranslations('settings.common')
  // Les réglages sont SERVIS par /api/me/notification-preferences : la réponse
  // EST le catalogue applicable à ce compte. Le composant ne connaît aucune
  // liste d'événements — il rend ce qu'on lui donne. C'est ce qui garantit
  // qu'un interrupteur affiché est toujours un interrupteur honoré, et que
  // l'expert-publiant (qui reçoit à la fois opportunités, candidatures et
  // messages) voit les trois sans code particulier.
  const [settings, setSettings] = useState<NotificationSetting[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const phoneVerified = user.phone_verified === true

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await secureFetch('/api/me/notification-preferences', { method: 'GET' })
        if (!res.ok) { if (!cancelled) setSettings([]); return }
        const data = (await res.json()) as { settings?: NotificationSetting[] }
        if (!cancelled) setSettings(data.settings ?? [])
      } catch {
        if (!cancelled) setSettings([])
      }
    })()
    return () => { cancelled = true }
  }, [secureFetch])

  const keyOf = (s: { event: string; channel: string }) => `${s.event}:${s.channel}`

  // Enregistrement IMMÉDIAT au basculement (pas de bouton Enregistrer), avec
  // retour d'état (toast) + rollback optimiste en cas d'échec.
  const save = async (setting: NotificationSetting, next: boolean) => {
    if (busy || !settings) return
    const k = keyOf(setting)
    const previous = settings
    setSettings(settings.map((s) => (keyOf(s) === k ? { ...s, enabled: next } : s)))
    setBusy(k)
    try {
      const res = await secureFetch('/api/me/notification-preferences', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: setting.event, channel: setting.channel, enabled: next }),
      })
      if (!res.ok) {
        setSettings(previous)
        notify(tc('error_generic'), 'error')
        setBusy(null)
        return
      }
      notify(next ? t('saved_on') : t('saved_off'))
    } catch {
      setSettings(previous)
      notify(tc('error_generic'), 'error')
    }
    setBusy(null)
  }

  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
    padding: '16px 0', borderBottom: '1px solid #f1f5f9',
  }

  if (settings === null) {
    return (
      <div>
        <SectionHeader title={t('title')} description={t('description')} />
        <div style={{ padding: 24, color: '#94a3b8', fontSize: 13.5 }}>{tc('loading')}</div>
      </div>
    )
  }

  // Regroupement par ÉVÉNEMENT : l'utilisateur raisonne « de quoi veux-je être
  // prévenu », pas « quels canaux existent ». La voix est portée par chaque
  // réglage du groupe (identique pour tous les canaux d'un même événement).
  const events = Array.from(new Set(settings.map((s) => s.event))).map((event) => ({
    event,
    // Préfixe de clé i18n : `events.{event}.{voice}` quand l'événement a deux
    // vocabulaires, `events.{event}` sinon. La voix vient du serveur.
    keyBase: (() => {
      const voice = settings.find((s) => s.event === event)?.voice
      return voice ? `events.${event}.${voice}` : `events.${event}`
    })(),
  }))

  return (
    <div>
      <SectionHeader title={t('title')} description={t('description')} />
      <div style={{ maxWidth: 560 }}>
        {events.map(({ event, keyBase }, i) => (
          <div key={event} style={{ marginBottom: i === events.length - 1 ? 0 : 26 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: '#0f172a' }}>
              {t(`${keyBase}.label` as 'events.new_message.label')}
            </div>
            {/* Chaque réglage dit CE QU'IL DÉCLENCHE, en clair. */}
            <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 3, lineHeight: 1.5 }}>
              {t(`${keyBase}.description` as 'events.new_message.description')}
            </div>

            {settings
              .filter((s) => s.event === event)
              .map((s, j, arr) => {
                const isSms = s.channel === 'sms'
                const unavailable = isSms && !phoneVerified
                return (
                  <div
                    key={keyOf(s)}
                    style={{ ...rowStyle, borderBottom: j === arr.length - 1 ? 'none' : rowStyle.borderBottom }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: unavailable ? '#94a3b8' : '#0f172a' }}>
                        {isSms ? t('sms_label') : t('email_label')}
                      </div>
                      <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 3, wordBreak: 'break-all' }}>
                        {isSms
                          ? (phoneVerified ? (user.phone ?? '—') : t('sms_unavailable'))
                          : (user.email ?? '—')}
                      </div>
                      {unavailable && (
                        <button
                          type="button"
                          onClick={goToPhone}
                          style={{
                            marginTop: 6, padding: 0, background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--sk-accent, #0ea5e9)', fontSize: 12.5, fontWeight: 600, fontFamily: fontJakarta,
                            textDecoration: 'underline',
                          }}
                        >
                          {t('sms_verify_link')}
                        </button>
                      )}
                    </div>
                    <Switch
                      checked={s.enabled && !unavailable}
                      disabled={unavailable || busy === keyOf(s)}
                      onChange={(v) => void save(s, v)}
                    />
                  </div>
                )
              })}
          </div>
        ))}

        {/* Mention regroupement — DÉCRIT CE QUE CE LECTEUR REÇOIT.
            La note unique d'avant parlait d'opportunités regroupées « dans un
            court intervalle » : deux erreurs à la fois. Une organisation ne
            reçoit jamais d'opportunité, et l'intervalle décrivait la fenêtre de
            15 min du cron de dispatch, supprimé depuis (3ec7492, envoi
            immédiat). Le regroupement, lui, EXISTE TOUJOURS : `new_match_opportunity`
            est déclaré `digest` au catalogue et lib/notifications/dispatch.ts
            envoie un seul e-mail/SMS pour les N opportunités en attente d'un
            même cycle. On corrige donc la formulation ET le public, en lisant
            le mode d'envoi servi — pas le type de compte. */}
        <p style={{ margin: '18px 0 0', fontSize: 12.5, color: '#94a3b8', lineHeight: 1.5 }}>
          {settings.some((s) => s.grouping === 'digest')
            ? t('grouping_note_digest')
            : t('grouping_note_per_item')}
        </p>
      </div>
    </div>
  )
}

// ─── Vue principale ─────────────────────────────────────────────────────────
/**
 * La prop `side` a DISPARU. Elle ne servait qu'à masquer l'onglet Notifications
 * côté entreprise ; ce filtrage vient désormais du catalogue serveur, qui
 * raisonne sur ce que le compte peut réellement recevoir. Garder une prop que
 * le composant n'utilise plus aurait laissé croire qu'elle influence encore
 * quelque chose.
 */
export default function SettingsView() {
  const t = useTranslations('settings')
  const tn = useTranslations('settings.nav')
  const secureFetch = useSecureFetch()
  // L'onglet Notifications n'est plus filtré par CÔTÉ. Il l'était parce qu'il
  // ne servait qu'au matching d'opportunités ; il porte désormais aussi les
  // candidatures reçues et les messages, qui concernent l'organisation. Ce que
  // chacun y voit est décidé par le CATALOGUE, côté serveur — un compte sans
  // aucun réglage applicable verrait une section vide, ce qui n'arrive pas :
  // « nouveau message » vaut pour tout le monde.
  const sections = SECTIONS
  const [active, setActive] = useState<SectionId>('identity')
  const [user, setUser] = useState<UserData | null>(null)
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Ré-auth (promesse résolue par la modale).
  const reauthResolver = useRef<((token: string | null) => void) | null>(null)
  const [reauthOpen, setReauthOpen] = useState(false)
  const requestReauth: RequestReauth = useCallback(
    () => new Promise<string | null>((resolve) => { reauthResolver.current = resolve; setReauthOpen(true) }),
    [],
  )
  const onReauthConfirm = (token: string) => { setReauthOpen(false); reauthResolver.current?.(token); reauthResolver.current = null }
  const onReauthCancel = () => { setReauthOpen(false); reauthResolver.current?.(null); reauthResolver.current = null }

  const notify: Notify = useCallback((msg, kind = 'success') => {
    setToast({ msg, kind })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }, [])

  const loadUser = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return
    const { data } = await supabase
      .from('users')
      .select('first_name, last_name, email, phone, phone_verified, locale')
      .eq('id', session.user.id)
      .maybeSingle()
    setUser((data as UserData | null) ?? null)
  }, [])

  useEffect(() => { void loadUser() }, [loadUser])

  // Deep-link depuis le lien de désabonnement des emails (?tab=notifications&unsub=1) :
  // ouvre l'onglet Notifications et confirme la désactivation.
  const unsubHandled = useRef(false)
  useEffect(() => {
    if (unsubHandled.current || typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('tab') === 'notifications' && sections.includes('notifications')) {
      setActive('notifications')
      if (params.get('unsub') === '1') notify(t('notifications.unsub_done'))
      unsubHandled.current = true
    }
  }, [sections, notify, t])

  const sectionNode = useMemo(() => {
    if (!user) return null
    switch (active) {
      case 'identity': return <IdentitySection user={user} secureFetch={secureFetch} requestReauth={requestReauth} notify={notify} reload={loadUser} />
      case 'email': return <EmailSection user={user} secureFetch={secureFetch} requestReauth={requestReauth} notify={notify} />
      case 'phone': return <PhoneSection user={user} secureFetch={secureFetch} requestReauth={requestReauth} notify={notify} reload={loadUser} />
      case 'password': return <PasswordSection secureFetch={secureFetch} requestReauth={requestReauth} notify={notify} />
      case 'language': return <LanguageSection secureFetch={secureFetch} notify={notify} />
      case 'security': return <SecuritySection secureFetch={secureFetch} notify={notify} />
      case 'notifications': return <NotificationsSection user={user} secureFetch={secureFetch} notify={notify} goToPhone={() => setActive('phone')} />
      case 'deletion': return <DeletionSection secureFetch={secureFetch} requestReauth={requestReauth} notify={notify} />
    }
  }, [active, user, secureFetch, requestReauth, notify, loadUser])

  return (
    <div style={{ fontFamily: fontJakarta, display: 'flex', flexDirection: 'column', width: '100%' }}>
      {/* Pas de PageHeader ici : le titre « Paramètres » est porté par la topbar
          du DashboardShell (résolution pathname → shell.page_titles.settings).
          On évite ainsi le doublon de titre. */}
      <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start', flexWrap: 'wrap', padding: '24px 26px 28px' }}>
        {/* Sous-navigation gauche (style Malt) */}
        <nav
          aria-label={t('title')}
          style={{
            display: 'flex', flexDirection: 'column', gap: 2,
            minWidth: 200, flex: '0 0 auto', position: 'sticky', top: 12,
          }}
        >
          {sections.map((s) => {
            const on = s === active
            return (
              <button
                key={s}
                type="button"
                onClick={() => setActive(s)}
                style={{
                  textAlign: 'left', padding: '10px 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  fontFamily: fontJakarta, fontSize: 14, fontWeight: on ? 700 : 500,
                  color: on ? 'var(--sk-accent-ink, #0369a1)' : '#475569',
                  background: on ? 'var(--sk-accent-soft, #f0f9ff)' : 'transparent',
                }}
              >
                {tn(s)}
              </button>
            )
          })}
        </nav>

        {/* Panneau droit */}
        <div style={{ flex: '1 1 480px', minWidth: 0, background: '#fff', border: '1.5px solid #eef2f7', borderRadius: 18, padding: 'clamp(18px, 3vw, 30px)' }}>
          {sectionNode}
        </div>
      </div>

      {toast && (
        <div
          role="status"
          style={{
            position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)', zIndex: 900,
            padding: '12px 20px', borderRadius: 12, fontSize: 14, fontWeight: 600, fontFamily: fontJakarta,
            color: '#fff', background: toast.kind === 'error' ? '#dc2626' : '#16a34a',
            boxShadow: '0 10px 30px rgba(15,23,42,0.2)',
          }}
        >
          {toast.msg}
        </div>
      )}

      <ReauthModal open={reauthOpen} onConfirm={onReauthConfirm} onCancel={onReauthCancel} />
    </div>
  )
}
