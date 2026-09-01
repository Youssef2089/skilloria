'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { useDomain } from '@/context/DomainContext'
import { dashboardUrlForUserType } from '@/lib/auth-routing'
import { initSession } from '@/lib/secure-fetch'
import LanguageSwitcher from '@/components/LanguageSwitcher'

/**
 * /[locale]/nouveau-mot-de-passe — réinitialisation après clic sur le lien email.
 *
 * Page d'AUTH (carte centrée, style connexion).
 *
 * Flow IMPLICIT (cf. audit) : le lien email amène ici avec un hash
 * `#access_token=…&type=recovery`. Le SDK (`detectSessionInUrl` par défaut) le
 * parse de façon ASYNCHRONE → on ne peut pas se fier à un seul getSession()
 * immédiat. Détection robuste à 3 états :
 *   - 'checking' : on attend (getSession + onAuthStateChange) ;
 *   - 'ready'    : session de recovery détectée → formulaire ;
 *   - 'invalid'  : ni session ni jeton après délai → lien expiré.
 *
 * Détection :
 *   1. getSession() au mount → session déjà là (reload / hash déjà consommé).
 *   2. onAuthStateChange : 'PASSWORD_RECOVERY' OU ('SIGNED_IN' && session) → ready.
 *   3. Délais : pas de jeton du tout dans le hash → invalid vite (1.5s) ; jeton
 *      présent mais aucune session établie → invalid (filet 5s).
 *   4. Désabonnement propre au unmount.
 */

type Phase = 'checking' | 'ready' | 'invalid'

export default function NouveauMotDePassePage() {
  const router = useRouter()
  const domain = useDomain()
  const t = useTranslations('reset_password')

  const [phase, setPhase] = useState<Phase>('checking')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // ── Détection robuste du jeton de recovery ───────────────────────────────
  useEffect(() => {
    let cancelled = false
    let settled = false

    const markReady = () => {
      if (cancelled || settled) return
      settled = true
      setPhase('ready')
    }
    const markInvalid = () => {
      if (cancelled || settled) return
      settled = true
      setPhase('invalid')
    }

    // 1. Session déjà présente (reload, ou hash déjà consommé).
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) markReady()
    })

    // 2. Le SDK parse le hash de façon asynchrone → on écoute.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        markReady()
      }
    })

    // 3a. Aucun jeton du tout dans l'URL → lien invalide rapidement.
    const quickTimer = setTimeout(() => {
      const hash = typeof window !== 'undefined' ? window.location.hash : ''
      const hasToken = hash.includes('access_token') || hash.includes('type=recovery')
      if (!hasToken) markInvalid()
    }, 1500)

    // 3b. Filet : jeton présent mais aucune session établie après 5s → invalide.
    const hardTimer = setTimeout(() => {
      markInvalid()
    }, 5000)

    return () => {
      cancelled = true
      clearTimeout(quickTimer)
      clearTimeout(hardTimer)
      sub.subscription.unsubscribe()
    }
  }, [])

  // ── Soumission du nouveau mot de passe ───────────────────────────────────
  const handleSubmit = async () => {
    // Garde de RÉ-ENTRANCE — cf. le même motif dans connexion/page.tsx. Le
    // bouton est `disabled={submitting}`, mais la touche Entrée (câblée plus
    // bas) et un double clic avalé pendant un re-rendu passeraient à côté.
    if (submitting) return

    if (pw.length < 8) {
      setError(t('errors.too_short'))
      return
    }
    if (pw !== confirm) {
      setError(t('errors.mismatch'))
      return
    }
    setSubmitting(true)
    setError('')

    /**
     * ÉTAT DE CHARGEMENT RELÂCHÉ DANS UN `finally`, JAMAIS PAR ÉNUMÉRATION.
     *
     * Même règle, et même leçon, que connexion/page.tsx — où l'explication
     * complète est écrite. Ici le défaut était LATENT, pas visible : le refus
     * pour compte suspendu, juste en dessous, sort sans relâcher `submitting`,
     * mais il redirige vers une AUTRE route, donc le composant se démonte et
     * personne ne voit le bouton figé. Il suffirait que la cible change, ou
     * qu'une navigation échoue, pour que le gel apparaisse ici aussi.
     *
     * On ne corrige pas un symptôme absent : on aligne la méthode, pour que le
     * défaut ne puisse pas se réveiller.
     */
    try {
      const { error: upErr } = await supabase.auth.updateUser({ password: pw })
      if (upErr) {
        setError(t('errors.generic'))
        return
      }

      // Succès → l'utilisateur est authentifié (session de recovery). On RÉUTILISE
      // la redirection post-login de connexion/page.tsx : lookup user_type +
      // initSession (session unique 11F) + dashboardUrlForUserType. Repli sur
      // /connexion si le lookup échoue.
      //
      // Ce try/catch INTERNE a un autre rôle que le `finally` externe : il
      // convertit un échec de lecture en REPLI (`/connexion`), il ne gère pas
      // le drapeau. Les deux ne se remplacent pas.
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user) {
          const { data: userData } = await supabase
            .from('users')
            .select('user_type')
            .eq('id', session.user.id)
            .single()
          const init = await initSession({ accessToken: session.access_token, subdomain: domain.subdomain })
          // Compte suspendu : réinitialiser son mot de passe ne rend pas l'accès.
          // Sans ce test, la page de reset serait la troisième porte d'entrée
          // (avec /connexion et /auth/callback) et la seule restée ouverte.
          if (init.code === 'account_suspended') {
            await supabase.auth.signOut()
            router.replace('/connexion?reason=account_suspended')
            return
          }
          router.push(dashboardUrlForUserType((userData?.user_type as string | null) ?? null))
          return
        }
      } catch {
        /* fallthrough → repli connexion */
      }
      router.push('/connexion')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Header partagé (logo + switcher) ─────────────────────────────────────
  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32, flexWrap: 'wrap', justifyContent: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: domain.primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L12 22M2 12L22 12M5 5L19 19M19 5L5 19" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>
        <span style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{domain.name}</span>
      </div>
      <LanguageSwitcher />
    </div>
  )

  const shell = (children: React.ReactNode) => (
    <div style={{
      minHeight: '100vh', background: '#f8fafc',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'flex-start',
      padding: '24px', fontFamily: 'Inter, sans-serif',
    }}>
      {header}
      <div style={{
        background: '#fff', borderRadius: 24,
        border: '1px solid #e2e8f0', padding: '40px',
        width: '100%', maxWidth: 440,
        boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
      }}>
        {children}
      </div>
    </div>
  )

  // ── État : vérification du lien ──────────────────────────────────────────
  if (phase === 'checking') {
    return shell(
      <div style={{ textAlign: 'center', padding: '8px 0' }}>
        <div
          aria-label="loading"
          style={{
            width: 48, height: 48, margin: '0 auto 20px', borderRadius: '50%',
            border: `4px solid ${domain.primaryColor}33`, borderTopColor: domain.primaryColor,
            animation: 'reset-pw-spin 0.9s linear infinite',
          }}
        />
        <p style={{ fontSize: 14, color: '#64748b' }}>{t('loading')}</p>
        <style>{`@keyframes reset-pw-spin { to { transform: rotate(360deg); } }`}</style>
      </div>,
    )
  }

  // ── État : lien invalide / expiré ────────────────────────────────────────
  if (phase === 'invalid') {
    return shell(
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
            <path d="M12 8v5M12 16h.01M3 12a9 9 0 1018 0 9 9 0 00-18 0z" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>
          {t('invalid_title')}
        </h1>
        <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6, marginBottom: 28 }}>
          {t('invalid_message')}
        </p>
        <button
          onClick={() => router.push('/mot-de-passe-oublie')}
          style={{
            width: '100%', padding: 13,
            background: domain.primaryColor, color: '#fff', border: 'none',
            borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {t('request_new_link')}
        </button>
      </div>,
    )
  }

  // ── État : prêt (formulaire) ─────────────────────────────────────────────
  return shell(
    <>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', marginBottom: 6 }}>
        {t('title')}
      </h1>
      <p style={{ fontSize: 14, color: '#64748b', marginBottom: 28 }}>
        {t('subtitle')}
      </p>

      {/* Nouveau mot de passe */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
          {t('new_password_label')}
        </label>
        <input
          type="password"
          placeholder={t('new_password_placeholder')}
          value={pw}
          onChange={e => setPw(e.target.value)}
          style={{
            width: '100%', padding: '10px 14px',
            border: '1.5px solid #e2e8f0', borderRadius: 10,
            fontSize: 14, color: '#0f172a', outline: 'none',
          }}
        />
      </div>

      {/* Confirmation */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
          {t('confirm_label')}
        </label>
        <input
          type="password"
          placeholder={t('confirm_placeholder')}
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !submitting) void handleSubmit() }}
          style={{
            width: '100%', padding: '10px 14px',
            border: '1.5px solid #e2e8f0', borderRadius: 10,
            fontSize: 14, color: '#0f172a', outline: 'none',
          }}
        />
      </div>

      {/* Erreur */}
      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#dc2626' }}>
          {error}
        </div>
      )}

      {/* Bouton */}
      <button
        onClick={handleSubmit}
        disabled={submitting}
        style={{
          width: '100%', padding: 13,
          background: submitting ? '#7dd3fc' : domain.primaryColor,
          color: '#fff', border: 'none',
          borderRadius: 12, fontSize: 15,
          fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer',
        }}
      >
        {submitting ? t('submitting') : t('submit')}
      </button>
    </>,
  )
}
