'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useNavBadges } from '@/hooks/useNavBadges'

/**
 * MessagesTopbarIcon — icône messagerie topbar (Point 6 finitions UX).
 *
 * Affichée à côté de la NotificationBell, côté expert ET côté org.
 * Badge unread = somme des unread_count des conversations (déjà strict :
 * /api/me/conversations ne retourne que les conversations unlocked + non
 * expirées). Aucune messagerie libre.
 *
 * Clic → /dashboard/{freelance,entreprise}/messages (layout 2 panneaux).
 */

export default function MessagesTopbarIcon({ side }: { side: 'freelance' | 'entreprise' }) {
  const t = useTranslations('messages.topbar')
  const domain = useDomain()
  const badges = useNavBadges()
  const unread = badges.messages_unread ?? 0
  const basePath = side === 'freelance' ? '/dashboard/freelance' : '/dashboard/entreprise'

  return (
    <Link
      href={`${basePath}/messages`}
      aria-label={t('aria_label')}
      style={{
        position: 'relative', width: 38, height: 38, borderRadius: 10,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: '#475569', textDecoration: 'none', transition: 'background .15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      {unread > 0 && (
        <span
          aria-hidden
          style={{
            position: 'absolute', top: 4, right: 4,
            minWidth: 16, height: 16, padding: '0 4px',
            background: domain.primaryColor, color: '#fff',
            fontSize: 10, fontWeight: 700, lineHeight: '16px',
            textAlign: 'center', borderRadius: 999,
            boxSizing: 'border-box',
          }}
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  )
}
