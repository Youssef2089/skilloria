'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { IconCircleCheck, IconExternalLink } from '@tabler/icons-react'

/**
 * MessageContextPanel — 3ᵉ zone de la messagerie (Lot refonte UX commit B/C).
 *
 * Affiche les méta de la mission/annonce associée à la conversation
 * sélectionnée + lien "Voir la mission". Reçoit la publication en prop depuis
 * MessagesInbox (qui dispose déjà de publication.{id,type,title} via
 * /api/me/conversations).
 *
 * Scope strict : la conv est forcément unlocked + non expirée (RLS +
 * /api/me/conversations filtre). Aucune fuite de messagerie libre.
 */

export default function MessageContextPanel({
  publication,
  side,
}: {
  publication: { id: string; type: string; title: string } | null
  side: 'freelance' | 'entreprise'
}) {
  const t = useTranslations('messages.context')
  const tPub = useTranslations('publications')

  if (!publication) {
    return (
      <aside style={{ background: 'var(--sk-surface)', borderLeft: '1px solid var(--sk-border)', padding: '20px 18px', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>
        <div style={{ textAlign: 'center', color: 'var(--sk-muted)', fontSize: 13 }}>
          {t('no_publication')}
        </div>
      </aside>
    )
  }

  const missionHref = side === 'freelance'
    ? `/dashboard/freelance/missions/${publication.id}`
    : `/dashboard/entreprise/annonces/${publication.id}/candidatures`

  return (
    <aside style={{ background: 'var(--sk-surface)', borderLeft: '1px solid var(--sk-border)', padding: '20px 18px', overflowY: 'auto', minWidth: 0 }}>
      <div style={{ color: 'var(--sk-faint)', fontSize: 11, fontWeight: 600, letterSpacing: '0.4px', textTransform: 'uppercase', marginBottom: 12 }}>
        {t('about_label')}
      </div>

      <div style={{ border: '1px solid var(--sk-border)', borderRadius: 'var(--sk-r-lg)', padding: 16, background: 'var(--sk-surface)' }}>
        <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.35, letterSpacing: '-0.2px', color: 'var(--sk-text)' }}>
          {publication.title}
        </div>
        <div style={{ color: 'var(--sk-muted)', fontSize: 12.5, marginTop: 5 }}>
          {tPub(`type.${publication.type}`)}
        </div>

        {/* Indicateur "Profil débloqué" — toute conv visible ici est forcément
            issue d'une candidature unlocked (RLS scope strict). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontSize: 13, fontWeight: 600, color: 'var(--sk-success)' }}>
          <IconCircleCheck size={16} stroke={2} />
          {side === 'freelance' ? t('exchange_open_expert') : t('exchange_open_org')}
        </div>

        <Link
          href={missionHref}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            marginTop: 14, width: '100%', textAlign: 'center',
            padding: '11px 0', borderRadius: 11,
            background: 'var(--sk-accent)', color: '#fff', textDecoration: 'none',
            fontSize: 13.5, fontWeight: 600,
          }}
        >
          <IconExternalLink size={15} stroke={2} />
          {side === 'freelance' ? t('view_mission') : t('view_annonce')}
        </Link>
      </div>
    </aside>
  )
}
