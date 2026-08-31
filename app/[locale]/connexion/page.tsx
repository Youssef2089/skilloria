'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { useDomain } from '@/context/DomainContext'
import { dashboardUrlForUserType } from '@/lib/auth-routing'
import { initSession } from '@/lib/secure-fetch'
import LanguageSwitcher from '@/components/LanguageSwitcher'

export default function ConnexionPage() {
  const router = useRouter()
  const domain = useDomain()
  const t = useTranslations('login')
  const tSession = useTranslations('session')
  const searchParams = useSearchParams()
  // Bandeau d'arrivée, piloté par `?reason=` — UN SEUL mécanisme, deux motifs :
  //   session_superseded : compte rouvert ailleurs (11F D2).
  //   account_suspended  : compte suspendu par un administrateur.
  // Tous deux posés par secure-fetch (onSuperseded / onSuspended) ou, pour la
  // suspension, par le refus de `initSession` juste en dessous. Un motif
  // inconnu n'affiche rien plutôt qu'un bandeau vide.
  const reason = searchParams.get('reason')
  const bannerKind: 'superseded' | 'suspended' | null =
    reason === 'session_superseded' ? 'superseded'
      : reason === 'account_suspended' ? 'suspended'
        : null
  const [form, setForm] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (!form.email || !form.password) {
      setError(t('errors.missing_fields'))
      return
    }

    setLoading(true)
    setError('')

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email: form.email,
      password: form.password,
    })

    if (authError) {
      setError(t('errors.invalid_credentials'))
      setLoading(false)
      return
    }

    // Routage via la fonction SECURITY DEFINER my_account_routing() (C4) plutôt
    // qu'un SELECT direct sur `users` : ce dernier est désormais verrouillé par
    // RLS pour un compte EN GRÂCE (verrou de lecture des données perso). La
    // fonction n'expose QUE le routage (user_type, domain_slug + 2 dates de
    // suppression) et reste accessible en grâce → la réactivation fonctionne.
    let userData: {
      user_type?: string | null
      domain_slug?: string | null
      deletion_scheduled_at?: string | null
      anonymized_at?: string | null
    } | null = null
    const { data: routingRows, error: rpcErr } = await supabase.rpc('my_account_routing')
    if (!rpcErr) {
      userData = (Array.isArray(routingRows) ? routingRows[0] : routingRows) ?? null
    } else {
      // Filet indépendant de l'ORDRE de déploiement : si la fonction n'existe
      // pas encore (migration C4 pas appliquée), on retombe sur le SELECT direct
      // — non verrouillé tant que la migration n'est pas là. Une fois la
      // migration poussée, la RPC répond et ce fallback n'est plus atteint.
      const { data: row } = await supabase
        .from('users')
        .select('user_type, domains(slug), deletion_scheduled_at, anonymized_at')
        .eq('id', data.user.id)
        .maybeSingle()
      if (row) {
        userData = {
          user_type: row.user_type as string | null,
          domain_slug: (row.domains as { slug?: string } | null)?.slug ?? null,
          deletion_scheduled_at: (row as { deletion_scheduled_at?: string | null }).deletion_scheduled_at ?? null,
          anonymized_at: (row as { anonymized_at?: string | null }).anonymized_at ?? null,
        }
      }
    }

    if (!userData) {
      setError(t('errors.profile_not_found'))
      setLoading(false)
      return
    }

    // Compte en GRÂCE (suppression programmée, non purgé) : la session vient
    // d'être ré-établie → on établit le cookie puis on mène droit à
    // /reactivation (évite un flash de dashboard avant le redirect du gate).
    if (userData.deletion_scheduled_at && !userData.anonymized_at) {
      const initGrace = await initSession({
        accessToken: data.session.access_token,
        subdomain: domain.subdomain,
      })
      // La SUSPENSION PRIME sur la suppression programmée — même ordre que
      // dans lib/auth-guard.ts. Un compte suspendu ne doit pas atteindre
      // /reactivation : la réactivation est en self-service, la levée de
      // suspension ne l'est pas. Sans ce test, la porte de service serait
      // ouverte ici, dans l'écran de login, hors de portée du garde serveur.
      if (initGrace.code === 'account_suspended') {
        await supabase.auth.signOut()
        router.replace('/connexion?reason=account_suspended')
        return
      }
      router.push('/reactivation')
      return
    }

    const userType = userData.user_type as string

    // Vérification du domaine — uniquement pour les experts (freelance + CDI)
    if (userType === 'expert_freelance' || userType === 'expert_cdi') {
      const userDomainSlug = userData.domain_slug as string | null
      if (userDomainSlug && userDomainSlug !== domain.subdomain) {
        await supabase.auth.signOut()
        setError(t('errors.wrong_domain', { subdomain: userDomainSlug }))
        setLoading(false)
        return
      }
    }

    // Session unique (11F) : on pose le last_session_token + cookie httpOnly
    // AVANT le redirect. Effet voulu : invalide les sessions actives du
    // même compte sur d'autres appareils/onglets (D2). Best-effort.
    const init = await initSession({
      accessToken: data.session.access_token,
      subdomain: domain.subdomain,
    })

    // COMPTE SUSPENDU : le serveur a refusé d'ouvrir la session. On purge
    // l'authentification Supabase (sans quoi l'utilisateur resterait à
    // moitié connecté) et on affiche le motif. Surtout pas de redirection
    // vers un tableau de bord : il se chargerait vide, et l'utilisateur
    // croirait à une panne au lieu de comprendre qu'on lui a coupé l'accès.
    if (init.code === 'account_suspended') {
      await supabase.auth.signOut()
      router.replace('/connexion?reason=account_suspended')
      return
    }

    // Redirection selon le type d'utilisateur — mapping mutualisé
    // dans lib/auth-routing.ts, partagé avec /auth/callback (B3.3.fix2).
    router.push(dashboardUrlForUserType(userType))
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#f8fafc',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'flex-start',
      padding: '24px', fontFamily: 'Inter, sans-serif',
    }}>

      {/* Logo + LanguageSwitcher */}
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

      {/* Bandeau d'arrivée (session rouverte ailleurs, ou compte suspendu) */}
      {bannerKind && (
        <div
          role="alert"
          style={{
            width: '100%',
            maxWidth: 440,
            marginBottom: 16,
            padding: '14px 18px',
            background: '#FEF9C3',
            border: '1px solid #FDE047',
            color: '#713F12',
            borderRadius: 12,
            fontSize: 13,
            lineHeight: 1.55,
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: '#CA8A04' }} />
            <strong style={{ fontWeight: 600 }}>
              {bannerKind === 'suspended' ? tSession('suspended_title') : tSession('superseded_title')}
            </strong>
          </div>
          <div>
            {bannerKind === 'suspended' ? tSession('suspended_message') : tSession('superseded_message')}
          </div>
        </div>
      )}

      {/* Card */}
      <div style={{
        background: '#fff', borderRadius: 24,
        border: '1px solid #e2e8f0', padding: '40px',
        width: '100%', maxWidth: 440,
        boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
      }}>

        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', marginBottom: 6 }}>
          {t('title')}
        </h1>
        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 28 }}>
          {t('subtitle', { name: domain.name })}
        </p>

        {/* Email */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
            {t('email_label')}
          </label>
          <input
            type="email"
            placeholder={t('email_placeholder')}
            value={form.email}
            onChange={e => setForm({ ...form, email: e.target.value })}
            style={{
              width: '100%', padding: '10px 14px',
              border: '1.5px solid #e2e8f0', borderRadius: 10,
              fontSize: 14, color: '#0f172a', outline: 'none',
            }}
          />
        </div>

        {/* Mot de passe */}
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
            {t('password_label')}
          </label>
          <input
            type="password"
            placeholder={t('password_placeholder')}
            value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
            style={{
              width: '100%', padding: '10px 14px',
              border: '1.5px solid #e2e8f0', borderRadius: 10,
              fontSize: 14, color: '#0f172a', outline: 'none',
            }}
          />
        </div>

        {/* Mot de passe oublié */}
        <div style={{ textAlign: 'right', marginBottom: 24 }}>
          <span
            onClick={() => router.push('/mot-de-passe-oublie')}
            style={{ fontSize: 12, color: domain.primaryColor, fontWeight: 600, cursor: 'pointer' }}
          >
            {t('forgot_password')}
          </span>
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
          disabled={loading}
          style={{
            width: '100%', padding: 13,
            background: loading ? '#7dd3fc' : domain.primaryColor,
            color: '#fff', border: 'none',
            borderRadius: 12, fontSize: 15,
            fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
            marginBottom: 20,
          }}
        >
          {loading ? t('submitting') : t('submit')}
        </button>

        {/* Séparateur */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1, height: 1, background: '#e2e8f0' }}></div>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>{t('separator_or')}</span>
          <div style={{ flex: 1, height: 1, background: '#e2e8f0' }}></div>
        </div>

        {/* Créer un compte */}
        <p style={{ textAlign: 'center', fontSize: 13, color: '#64748b' }}>
          {t('no_account')}{' '}
          <span
            onClick={() => router.push('/inscription')}
            style={{ color: domain.primaryColor, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}
          >
            {t('create_account')}
          </span>
        </p>

      </div>
    </div>
  )
}
