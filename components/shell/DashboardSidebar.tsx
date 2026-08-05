'use client'

import { useTranslations } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'
import {
  IconLayoutDashboard,
  IconUser,
  IconBriefcase,
  IconSend,
  IconMessage2,
  IconBellPlus,
  IconUsersGroup,
  IconCreditCard,
  IconSettings,
  IconAsterisk,
  IconRosetteDiscountCheck,
  IconBuilding,
  IconFileInvoice,
  IconChecklist,
  IconPower,
} from '@tabler/icons-react'
import { useDomain } from '@/context/DomainContext'
import Avatar from '@/components/ui/Avatar'
import { useNavBadges } from '@/hooks/useNavBadges'
import { useSecureLogout } from '@/lib/secure-fetch'
import { dashboardNavSections } from '@/lib/nav-config'

/**
 * DashboardSidebar — sidebar unifiée multi-side (Lot refonte UX).
 *
 * `side` détermine les items de nav :
 *   - 'freelance' / 'cdi' : Tableau de bord, Mon profil, Missions,
 *     Candidatures, Messages, Lancer une alerte, Sous-traitance,
 *     Paiements, Paramètres
 *   - 'entreprise'        : Tableau de bord, Mes annonces (= dashboard),
 *     Messages, Mon entreprise, Membres, Factures, Paramètres
 *
 * Items lockés selon `isVerified` (freelance) ou `verification_status`
 * (entreprise). Badges live via useNavBadges (messages / candidatures).
 */

const ICONS: Record<string, React.ComponentType<{ size?: number; stroke?: number }>> = {
  dashboard: IconLayoutDashboard,
  profile:   IconUser,
  missions:  IconBriefcase,
  applications: IconSend,
  messages:  IconMessage2,
  alert:     IconBellPlus,
  subcontract: IconUsersGroup,
  payments:  IconCreditCard,
  settings:  IconSettings,
  organisation: IconBuilding,
  members:   IconUsersGroup,
  invoices:  IconFileInvoice,
  annonces:  IconChecklist,
}

export type DashboardSidebarProps = {
  side: 'freelance' | 'entreprise' | 'cdi'
  userName: string | null
  userPhotoUrl: string | null
  userIsVerified: boolean
  /** Sous-titre du bloc user ("Freelance · Microsoft" / "SAS · Approuvé"). */
  userSubtitle: string
}

export default function DashboardSidebar(props: DashboardSidebarProps) {
  const { side, userName, userPhotoUrl, userIsVerified, userSubtitle } = props
  const domain = useDomain()
  const pathname = usePathname()
  const badges = useNavBadges()
  const secureLogout = useSecureLogout()
  // Namespace 'shell' (pas 'shell.sidebar' — les clés vivent directement sous
  //  shell.nav.* / shell.sections.* / shell.user_fallback, cf. messages/*.json).
  const t = useTranslations('shell')

  const sections = dashboardNavSections(side, { userIsVerified })

  const accent = domain.primaryColor
  const isItemActive = (href: string): boolean => {
    if (href === pathname) return true
    // Special case : item "dashboard" est active sur l'URL racine /dashboard/{side}
    // mais aussi sur toute la racine. On considère seulement exact match pour éviter
    // que tous les items soient actifs.
    return false
  }

  return (
    <aside
      className="sk-sidebar"
      style={{
        width: 248,
        flexShrink: 0,
        background: 'var(--sk-surface)',
        borderRight: '1px solid var(--sk-border)',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 14px',
      }}
    >
      {/* Brand — cliquable vers l'accueil (convention universelle). Le nom vient
          de la config de domaine ; l'aria-label annonce la destination. */}
      <Link
        href="/"
        aria-label={t('brand_home_aria', { name: domain.name })}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px 16px',
          textDecoration: 'none', color: 'inherit', borderRadius: 8,
          transition: 'opacity .15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7' }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
      >
        <span
          style={{
            width: 30, height: 30, borderRadius: 8,
            background: accent, color: '#fff',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <IconAsterisk size={17} stroke={2.2} />
        </span>
        <b style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.2px', color: 'var(--sk-text)' }}>
          {domain.name}
        </b>
      </Link>

      {/* User block */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 8px', borderBottom: '1px solid var(--sk-border-soft)', marginBottom: 12 }}>
        <Avatar src={userPhotoUrl} name={userName} size={40} variant="accent" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 5, color: 'var(--sk-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName ?? t('user_fallback')}</span>
            {userIsVerified && <IconRosetteDiscountCheck size={15} color={accent} />}
          </div>
          <div style={{ color: 'var(--sk-muted)', fontSize: 12, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {userSubtitle}
          </div>
        </div>
      </div>

      {/* Nav sections */}
      {sections.map((sec) => (
        <div key={sec.sectionKey}>
          <div style={{ color: 'var(--sk-faint)', fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', padding: '14px 10px 6px' }}>
            {t(`sections.${sec.sectionKey}` as 'sections.main')}
          </div>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {sec.items.map((item) => {
              const Icon = ICONS[item.iconKey] ?? IconLayoutDashboard
              const active = isItemActive(item.href)
              const badge =
                item.badgeSource === 'messages' ? (badges.messages_unread ?? 0)
                : item.badgeSource === 'candidatures' ? (badges.candidatures_unread ?? 0)
                : item.badgeSource === 'candidatures_org' ? (badges.candidatures_org_unread ?? 0)
                : item.badgeSource === 'missions' ? (badges.missions_unread ?? 0)
                : 0
              const isLink = item.variant === 'link'
              // Non cliquable : verrou métier (locked) OU fonctionnalité à venir (soon).
              const disabled = item.locked || item.soon
              return (
                <Link
                  key={item.key}
                  href={disabled ? '#' : item.href}
                  aria-disabled={disabled || undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 11,
                    padding: '9px 10px',
                    borderRadius: 9,
                    color: disabled ? 'var(--sk-faint)' : active ? 'var(--sk-accent-ink)' : isLink ? accent : '#33414F',
                    background: active ? 'var(--sk-accent-soft)' : 'transparent',
                    textDecoration: 'none',
                    fontSize: 14,
                    fontWeight: 500,
                    pointerEvents: disabled ? 'none' : undefined,
                    opacity: disabled ? 0.55 : 1,
                    position: 'relative',
                    transition: 'background .12s',
                  }}
                  onClick={(e) => { if (disabled) e.preventDefault() }}
                >
                  <Icon size={18} stroke={1.8} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {/* SC5 correctif — libellé CDI : "missions" devient "Offres"
                        côté cdi. Route /dashboard/cdi/missions, key item.key
                        et badgeSource INCHANGÉS — seul le label change. */}
                    {item.key === 'missions' && side === 'cdi'
                      ? t('nav.offres')
                      : t(`nav.${item.key}` as 'nav.dashboard')}
                  </span>
                  {/* Verrou métier (profil non vérifié) → cadenas. */}
                  {item.locked && <span aria-hidden style={{ fontSize: 11 }}>🔒</span>}
                  {/* Fonctionnalité à venir → puce « Bientôt disponible ». */}
                  {item.soon && (
                    <span
                      style={{
                        fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
                        color: 'var(--sk-faint)', background: 'var(--sk-surface-2, #f1f5f9)',
                        border: '1px solid var(--sk-border, #e2e8f0)',
                        padding: '2px 7px', borderRadius: 999,
                      }}
                    >
                      {t('nav_soon')}
                    </span>
                  )}
                  {!disabled && badge > 0 && (
                    <span
                      aria-label={`${badge}`}
                      style={{
                        background: '#EF4D58', color: '#fff',
                        fontSize: 11, fontWeight: 600,
                        minWidth: 18, height: 18, borderRadius: 9,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        padding: '0 5px', lineHeight: 1,
                      }}
                    >
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>
        </div>
      ))}

      {/* Footer : logout */}
      <div style={{ marginTop: 'auto', paddingTop: 14 }}>
        <button
          type="button"
          onClick={() => void secureLogout({ redirectTo: '/' })}
          style={{
            display: 'flex', alignItems: 'center', gap: 11,
            width: '100%', padding: '9px 10px',
            background: 'transparent', border: 'none',
            color: '#EF4D58', fontSize: 14, fontWeight: 500,
            cursor: 'pointer', borderRadius: 9, fontFamily: 'inherit',
            textAlign: 'left',
          }}
        >
          <IconPower size={18} stroke={1.8} />
          {t('nav.logout')}
        </button>
      </div>
    </aside>
  )
}
