'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { useSecureFetch, useSecureLogout } from '@/lib/secure-fetch'

const fontJakarta = 'var(--font-jakarta), system-ui, sans-serif'

type View = 'loading' | 'grace' | 'purged' | 'active' | 'need_login'

/**
 * Écran de réactivation (mission S3, section 7).
 *
 * Vit HORS du dashboard (pas de DashboardShell ni de DeletionGate → pas de
 * boucle de redirection). Pendant la grâce : propose de réactiver le compte.
 * Après purge : message « compte supprimé ». Si le compte est actif (cas d'un
 * accès direct à l'URL), on renvoie vers l'app.
 */
export default function ReactivationPage() {
  const t = useTranslations('settings.reactivation')
  const locale = useLocale()
  const router = useRouter()
  const secureFetch = useSecureFetch()
  const logout = useSecureLogout()
  const [view, setView] = useState<View>('loading')
  const [date, setDate] = useState<string | null>(null)
  const [userType, setUserType] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      // user_type (pour rediriger vers le bon dashboard après réactivation)
      const { data: { session } } = await supabase.auth.getSession()
      // C1 : après suppression la session est révoquée. Sans session, on ne
      // peut PAS lire le statut (requireAuth exige un Bearer) → on invite à se
      // reconnecter pour réactiver (le compte n'est PAS banni pendant la grâce).
      if (!session?.user) {
        if (!cancelled) setView('need_login')
        return
      }
      const { data: u } = await supabase.from('users').select('user_type').eq('id', session.user.id).maybeSingle()
      if (!cancelled) setUserType((u as { user_type?: string } | null)?.user_type ?? null)
      try {
        const res = await secureFetch('/api/me/account/status', { method: 'GET' })
        if (cancelled) return
        if (!res.ok) {
          const d = (await res.json().catch(() => null)) as { code?: string } | null
          setView(d?.code === 'account_anonymized' ? 'purged' : 'active')
          return
        }
        const d = (await res.json()) as { deletion_scheduled_at?: string | null; anonymized_at?: string | null }
        if (cancelled) return
        if (d.anonymized_at) setView('purged')
        else if (d.deletion_scheduled_at) { setDate(d.deletion_scheduled_at); setView('grace') }
        else setView('active')
      } catch {
        if (!cancelled) setView('active')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [secureFetch])

  useEffect(() => {
    if (view === 'active') {
      const dest = userType === 'cdi' ? '/dashboard/cdi' : '/dashboard/freelance'
      router.replace(dest)
    }
  }, [view, userType, router])

  const fmt = (iso: string) => {
    try { return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(iso)) } catch { return iso }
  }

  const reactivate = async () => {
    setBusy(true)
    try {
      const res = await secureFetch('/api/me/account/reactivate', { method: 'POST' })
      if (!res.ok) { setBusy(false); return }
      const dest = userType === 'cdi' ? '/dashboard/cdi' : '/dashboard/freelance'
      router.replace(dest)
    } catch { setBusy(false) }
  }

  const shell = (children: React.ReactNode) => (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: '#f8fafc', fontFamily: fontJakarta }}>
      <div style={{ width: '100%', maxWidth: 460, background: '#fff', borderRadius: 20, padding: 32, boxShadow: '0 20px 50px rgba(15,23,42,0.12)', textAlign: 'center' }}>
        {children}
      </div>
    </div>
  )

  if (view === 'loading') {
    return shell(<p style={{ color: '#64748b', fontSize: 14 }}>…</p>)
  }

  if (view === 'purged') {
    return shell(
      <>
        <div style={{ fontSize: 36, marginBottom: 8 }} aria-hidden>🗑️</div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0f172a' }}>{t('purged_title')}</h1>
        <p style={{ margin: '10px 0 24px', fontSize: 14.5, color: '#64748b', lineHeight: 1.6 }}>{t('purged_body')}</p>
        <button
          type="button"
          onClick={() => void logout({ redirectTo: '/' })}
          style={{ padding: '12px 20px', borderRadius: 12, border: '1.5px solid #e2e8f0', background: '#fff', color: '#0f172a', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: fontJakarta }}
        >
          {t('logout')}
        </button>
      </>,
    )
  }

  if (view === 'need_login') {
    return shell(
      <>
        <div style={{ fontSize: 36, marginBottom: 8 }} aria-hidden>🔒</div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0f172a' }}>{t('need_login_title')}</h1>
        <p style={{ margin: '10px 0 24px', fontSize: 14.5, color: '#64748b', lineHeight: 1.6 }}>{t('need_login_body')}</p>
        <button
          type="button"
          onClick={() => router.replace('/connexion')}
          style={{ width: '100%', padding: '13px 20px', borderRadius: 12, border: 'none', background: 'var(--sk-accent, #0ea5e9)', color: '#fff', fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: fontJakarta }}
        >
          {t('need_login_button')}
        </button>
      </>,
    )
  }

  if (view === 'grace') {
    return shell(
      <>
        <div style={{ fontSize: 36, marginBottom: 8 }} aria-hidden>⏳</div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0f172a' }}>{t('title')}</h1>
        <p style={{ margin: '10px 0 6px', fontSize: 14.5, color: '#64748b', lineHeight: 1.6 }}>
          {t('body', { date: date ? fmt(date) : '' })}
        </p>
        <p style={{ margin: '0 0 24px', fontSize: 13, fontWeight: 700, color: '#b91c1c' }}>
          {t('scheduled_for', { date: date ? fmt(date) : '' })}
        </p>
        <button
          type="button"
          onClick={() => void reactivate()}
          disabled={busy}
          style={{ width: '100%', padding: '13px 20px', borderRadius: 12, border: 'none', background: 'var(--sk-accent, #0ea5e9)', color: '#fff', fontSize: 15, fontWeight: 800, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1, fontFamily: fontJakarta }}
        >
          {t('reactivate_button')}
        </button>
        <button
          type="button"
          onClick={() => void logout({ redirectTo: '/' })}
          style={{ marginTop: 12, padding: '10px 16px', borderRadius: 10, border: 'none', background: 'transparent', color: '#64748b', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: fontJakarta }}
        >
          {t('logout')}
        </button>
      </>,
    )
  }

  return shell(<p style={{ color: '#64748b', fontSize: 14 }}>…</p>)
}
