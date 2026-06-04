'use client'

import LanguageSwitcher from '@/components/LanguageSwitcher'
import NotificationBell from '@/components/NotificationBell'
import MessagesTopbarIcon from '@/components/MessagesTopbarIcon'

/**
 * DashboardTopbar — barre supérieure 60px (Lot refonte UX).
 *
 * Côté gauche : titre de page (dérivé du sub-layout ou pris en prop).
 * Côté droit : LanguageSwitcher · NotificationBell · MessagesTopbarIcon ·
 *              statut "Disponible" (expert) / placeholder.
 *
 * Le titre est passé en prop ; chaque sub-layout le résout via usePathname()
 * ou les pages individuelles peuvent l'override via un store partagé. V1
 * pragmatique : la prop suffit.
 */
export default function DashboardTopbar({
  side,
  title,
  statusPill,
}: {
  side: 'freelance' | 'entreprise' | 'cdi'
  title: string
  /** Pill statut à droite (ex. "Disponible" expert vérifié). Optionnel. */
  statusPill?: React.ReactNode
}) {
  // SC7b : 'cdi' passe son propre side à l'icône messages → base path /dashboard/cdi/messages.
  const messagesSide: 'freelance' | 'entreprise' | 'cdi' = side
  return (
    <header
      style={{
        height: 60,
        flexShrink: 0,
        background: 'var(--sk-surface)',
        borderBottom: '1px solid var(--sk-border)',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '0 22px',
      }}
    >
      <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.3px', color: 'var(--sk-text)' }}>
        {title}
      </span>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
        <LanguageSwitcher />
        <NotificationBell />
        <MessagesTopbarIcon side={messagesSide} />
        {statusPill}
      </div>
    </header>
  )
}
