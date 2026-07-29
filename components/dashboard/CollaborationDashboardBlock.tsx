'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch } from '@/lib/secure-fetch'
import type { Annonce } from '@/types/annonce'

/**
 * CollaborationDashboardBlock — bloc « Collaboration experts » du tableau de
 * bord, REFONTE C9 : n'affiche plus les besoins REÇUS (doublon des Missions)
 * mais MES BESOINS PUBLIÉS et leur activité — miroir du bloc « Mes annonces »
 * côté entreprise. Réutilise `GET /api/publications` (filtré sous_traitance).
 *
 * Verrou « profil non vérifié » CONSERVÉ (déjà correct) : pas de fetch, message
 * explicatif + puce verrouillée. Parité freelance/CDI (seul `basePath` diffère).
 */

type Props = { basePath: string; isVerified: boolean }

export default function CollaborationDashboardBlock({ basePath, isVerified }: Props) {
  const t = useTranslations('collaboration_dashboard')
  const tList = useTranslations('collaboration.list')
  const tPub = useTranslations('publications')
  const locale = useLocale()
  const domain = useDomain()
  const secureFetch = useSecureFetch()

  const [needs, setNeeds] = useState<Annonce[] | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await secureFetch(`/api/publications?locale=${encodeURIComponent(locale)}`, { method: 'GET' })
      if (!res.ok) { setNeeds([]); return }
      const payload = (await res.json().catch(() => ({}))) as { publications?: Annonce[] }
      setNeeds((payload.publications ?? []).filter((p) => p.type === 'sous_traitance'))
    } catch {
      setNeeds([])
    }
  }, [secureFetch, locale])

  useEffect(() => {
    // Fetch UNIQUEMENT si vérifié (un non-vérifié n'a pas d'org perso ni de besoin).
    if (isVerified) void load()
  }, [isVerified, load])

  const card: React.CSSProperties = {
    width: '100%',
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: '20px 22px',
    marginBottom: 0,
    opacity: isVerified ? 1 : 0.6,
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>{t('title')}</span>
        {!isVerified ? (
          <span style={{ background: '#f3f4f6', color: '#9ca3af', fontSize: 12, padding: '4px 10px', borderRadius: 20 }}>{t('locked_chip')}</span>
        ) : (
          <Link href={`${basePath}/sous-traitance`} style={{ color: domain.primaryColor, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
            {t('see_all')}
          </Link>
        )}
      </div>

      {!isVerified ? (
        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 22, textAlign: 'center', fontSize: 14, color: '#9ca3af', lineHeight: 1.8 }}>
          {t('locked_message')}
        </div>
      ) : needs === null ? (
        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 22, textAlign: 'center', fontSize: 14, color: '#9ca3af' }}>
          {tList('loading')}
        </div>
      ) : needs.length === 0 ? (
        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '24px 22px', textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: '#64748b', lineHeight: 1.7, marginBottom: 14 }}>{t('empty_body')}</div>
          <Link href={`${basePath}/sous-traitance/nouveau`} style={{ display: 'inline-flex', padding: '10px 16px', background: domain.primaryColor, color: '#fff', borderRadius: 10, fontSize: 13.5, fontWeight: 700, textDecoration: 'none' }}>
            + {t('publish_cta')}
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {needs.slice(0, 3).map((n) => {
            const total = n.candidatures?.total ?? 0
            const toReview = n.candidatures?.to_review ?? 0
            return (
              <Link
                key={n.id}
                href={`${basePath}/sous-traitance/${n.id}`}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', border: '1px solid #e5e7eb', borderRadius: 12, textDecoration: 'none', color: 'inherit' }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 999, background: '#f1f5f9', color: '#64748b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                      {tPub(`status.${n.status}` as 'status.published')}
                    </span>
                    {toReview > 0 && (
                      <span style={{ padding: '2px 8px', borderRadius: 999, background: `${domain.primaryColor}18`, color: domain.primaryColor, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        {tList('new_badge')}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</div>
                </div>
                <span style={{ fontSize: 13, color: '#64748b', flexShrink: 0 }}>{tList('candidatures_count', { count: total })}</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
