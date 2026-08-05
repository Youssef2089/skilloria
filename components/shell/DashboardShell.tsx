'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { usePathname } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { useDomain } from '@/context/DomainContext'
import { useAvatarUrl } from '@/hooks/useAvatarUrl'
import { deriveVerificationUiState } from '@/lib/verification-state'
import DashboardSidebar from './DashboardSidebar'
import DashboardTopbar from './DashboardTopbar'
import GlobalBackButton from './GlobalBackButton'

/**
 * DashboardShell — shell pleine largeur partagé (Lot refonte UX).
 *
 *   ┌──────────┬──────────────────────────────────────┐
 *   │ Sidebar  │ Topbar                                │
 *   │  248px   ├──────────────────────────────────────┤
 *   │  fixe    │ {children} pleine largeur            │
 *   │          │                                      │
 *   └──────────┴──────────────────────────────────────┘
 *
 *  - Multi-tenant : `--sk-accent` est posé en CSS variable inline depuis
 *    `useDomain().primaryColor`, et `--sk-accent-soft` / `--sk-accent-ink`
 *    sont DÉRIVÉS via color-mix dans globals.css. Un domaine non-bleu reste
 *    cohérent.
 *  - Fetch léger user+profile pour alimenter sidebar (nom/photo + statut de
 *    vérification dérivé de profiles.verification_status/visible) et topbar
 *    (statut "Disponible"). Pas de re-fetch périodique ici : les
 *    pages enfants gèrent leur propre temps réel.
 *  - Pas de gate session/auth ici : DashboardLayout amont monte déjà
 *    SessionHeartbeat ; chaque page enfant gère son propre redirect /
 *    /connexion si besoin (legacy pattern conservé).
 */

type UserInfo = {
  id: string | null
  first_name: string | null
  last_name: string | null
  user_type: string | null
}
type ProfileInfo = {
  verification_status: string | null
  // D1 : source de vérité de « profil vérifié » (avec verification_status),
  // via deriveVerificationUiState — jamais users.is_verified (drapeau non fiable).
  visible: boolean | null
  availability_status: string | null
  cdi_status: string | null
}

export default function DashboardShell({
  side,
  pageTitle,
  children,
}: {
  side: 'freelance' | 'entreprise' | 'cdi'
  /** Override optionnel ; sinon dérivé du pathname + i18n shell.page_titles. */
  pageTitle?: string
  children: React.ReactNode
}) {
  const domain = useDomain()
  // M3 : photo propre via URL signée serveur (plus de lecture publique directe).
  const { url: ownAvatarUrl } = useAvatarUrl()
  const tCommon = useTranslations('common')
  const tShell = useTranslations('shell')
  const pathname = usePathname()
  const [user, setUser] = useState<UserInfo | null>(null)
  const [profile, setProfile] = useState<ProfileInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return
      const [{ data: uRow }, { data: pRow }] = await Promise.all([
        supabase.from('users').select('id, first_name, last_name, user_type').eq('id', session.user.id).maybeSingle(),
        supabase.from('profiles').select('verification_status, visible, availability_status, cdi_status').eq('user_id', session.user.id).maybeSingle(),
      ])
      if (cancelled) return
      setUser((uRow as UserInfo | null) ?? null)
      setProfile((pRow as ProfileInfo | null) ?? null)
    }
    void load()
    // Lot disponibilité — la pill topbar doit refléter en LIVE le statut
    // après changement via AvailabilityToggle (freelance) ou CdiStatusToggle
    // (CDI), tous deux situés dans les pages enfants. Custom event
    // `sk:availability-changed` dispatché par les handlers de toggle :
    // on refetch alors le profile pour mettre à jour la pill.
    //
    // Lot global C3 (micro-ajout) : MÊME refetch quand la photo de profil
    // change (event `sk:profile-changed` dispatché par AvatarUploadModal
    // onSaved côté freelance + CDI mon-profil). L'avatar de la sidebar se
    // met à jour INSTANTANÉMENT sans reload — zéro duplication, on relance
    // exactement le même `load()`.
    const onProfileLikeChanged = () => { void load() }
    window.addEventListener('sk:availability-changed', onProfileLikeChanged)
    window.addEventListener('sk:profile-changed', onProfileLikeChanged)
    return () => {
      cancelled = true
      window.removeEventListener('sk:availability-changed', onProfileLikeChanged)
      window.removeEventListener('sk:profile-changed', onProfileLikeChanged)
    }
  }, [])

  // Multi-tenant : pose --sk-accent dynamiquement. color-mix() dans globals.css
  // dérivera automatiquement --sk-accent-soft et --sk-accent-ink.
  const shellRootStyle: React.CSSProperties = {
    ['--sk-accent' as string]: domain.primaryColor,
    display: 'flex',
    height: '100vh',
    overflow: 'hidden',
    background: 'var(--sk-bg)',
    color: 'var(--sk-text)',
  }

  // Subtitle utilisateur :
  //  - side='entreprise' : "{org_role} · {ecosystem}" (besoin de l'org, fetché ailleurs — placeholder OK pour V1)
  //  - side='freelance'  : "Freelance · {ecosystem}"
  //  - side='cdi'        : "CDI · {ecosystem}"
  const subtitleByType = side === 'entreprise'
    ? tShell('user_subtitle.entreprise', { ecosystem: domain.ecosystemName })
    : side === 'cdi'
      ? tShell('user_subtitle.cdi', { ecosystem: domain.ecosystemName })
      : tShell('user_subtitle.freelance', { ecosystem: domain.ecosystemName })

  const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || tCommon('user_fallback')
  // D1 : « profil vérifié » = source de vérité verification_status (via
  // deriveVerificationUiState === 'approved'), la MÊME que la garde serveur
  // isExpertProfileApproved. On n'utilise plus users.is_verified (non fiable).
  const isVerified = deriveVerificationUiState({
    visible: profile?.visible ?? null,
    verificationStatus: profile?.verification_status ?? null,
  }) === 'approved'

  // Titre topbar : prop si fournie, sinon résolution pathname → i18n key.
  //   /dashboard/{side}                                  → 'dashboard'
  //   /dashboard/freelance/missions [.. /[id]]           → 'missions'
  //   /dashboard/freelance/candidatures                  → 'candidatures'
  //   /dashboard/{side}/messages [.. /[id]]              → 'messages'
  //   /dashboard/freelance/mon-profil                    → 'mon_profil'
  //   /dashboard/freelance/profil/valider                → 'profil_valider'
  //   /dashboard/entreprise/annonces/...                 → 'annonces'
  //   etc. (cf. shell.page_titles)
  let resolvedTitle: string = pageTitle ?? ''
  if (!resolvedTitle) {
    const p = pathname.toLowerCase()
    const segs = p.split('/').filter(Boolean)
    // /dashboard / {side} / {section?} / {subsection?}
    const section = segs[2] ?? null
    let key = 'dashboard'
    if (!section) key = 'dashboard'
    // SC5 correctif libellé CDI : /dashboard/cdi/missions affiche "Offres".
    else if (section === 'missions')     key = side === 'cdi' ? 'offres' : 'missions'
    else if (section === 'candidatures') key = 'candidatures'
    else if (section === 'messages')     key = 'messages'
    else if (section === 'mon-profil')   key = 'mon_profil'
    else if (section === 'profil')       key = segs[3] === 'valider' ? 'profil_valider' : 'profil'
    else if (section === 'annonces')     key = 'annonces'
    else if (section === 'parametres')   key = 'settings'
    // Section COMPTE entreprise (Lot A). 'membres' est déclaré ici bien que la
    // page arrive au Lot B : le titre est prêt, l'entrée de sidebar est locked.
    else if (section === 'organisation') key = 'organisation'
    else if (section === 'membres')      key = 'membres'
    else if (section === 'offre')        key = 'offre'
    resolvedTitle = tShell(`page_titles.${key}` as 'page_titles.dashboard')
  }

  // StatusPill côté topbar (expert uniquement) — DYNAMIQUE selon le statut
  // d'écoute (Lot disponibilité).
  //   Freelance : profiles.availability_status
  //     - 'do_not_disturb' → rouge "🔕 Ne pas déranger"
  //     - sinon (incl. NULL = défaut) → vert "Disponible"
  //   CDI : profiles.cdi_status
  //     - 'employed' → rouge "🔕 Ne pas déranger"
  //     - sinon (incl. NULL = défaut) → vert "À l'écoute"
  // Pas de libellé en dur. Côté org : laisse vide V1.
  const statusPill = (() => {
    if (side === 'entreprise' || !isVerified) return undefined
    const isFreelance = side === 'freelance'
    const dnd = isFreelance
      ? profile?.availability_status === 'do_not_disturb'
      : profile?.cdi_status === 'employed'
    if (dnd) {
      return (
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            fontSize: 13, fontWeight: 600,
            color: '#b91c1c',
            background: '#fee2e2',
            padding: '7px 13px', borderRadius: 999, whiteSpace: 'nowrap',
          }}
        >
          <span aria-hidden>🔕</span>
          {tShell('topbar.status_do_not_disturb')}
        </span>
      )
    }
    return (
      <span
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          fontSize: 13, fontWeight: 600,
          color: 'var(--sk-success)',
          background: 'var(--sk-success-soft)',
          padding: '7px 13px', borderRadius: 999, whiteSpace: 'nowrap',
        }}
      >
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--sk-success)' }} />
        {tShell(isFreelance ? 'topbar.status_available' : 'topbar.status_open_to_work')}
      </span>
    )
  })()

  return (
    <div style={shellRootStyle}>
      <DashboardSidebar
        side={side}
        userName={fullName}
        userPhotoUrl={ownAvatarUrl}
        userIsVerified={isVerified}
        userSubtitle={subtitleByType}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <DashboardTopbar side={side} title={resolvedTitle} statusPill={statusPill} />
        <main style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          <GlobalBackButton />
          {children}
        </main>
      </div>
    </div>
  )
}
