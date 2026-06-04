'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * NotificationBell — cloche + dropdown du centre de notifications.
 *
 * Réutilisable côté expert (topbar /dashboard/freelance) et côté org
 * (intégrée dans OrganisationSidebar).
 *
 * Fonctions :
 *   - Affiche un badge avec le nombre de notifications non lues
 *   - Clic ouvre un dropdown listant les 50 dernières notifs (ordre antéchrono)
 *   - Clic sur une notif → POST /api/me/notifications/[id]/read + navigate link_url
 *   - Bouton « Tout marquer lu » → POST /api/me/notifications
 *   - Polling 30s en arrière-plan, sans interrompre l'utilisateur
 */

type Notification = {
  id: string
  type: string
  title: string | null
  body: string | null
  link_url: string | null
  entity_id: string | null
  status: string
  channel: string
  read_at: string | null
  created_at: string
}

const POLL_MS = 30_000

function relativeFromNow(iso: string, locale: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffMs = Math.max(0, now - then)
  const sec = Math.round(diffMs / 1000)
  const min = Math.round(sec / 60)
  const hr = Math.round(min / 60)
  const day = Math.round(hr / 24)
  const labels =
    locale === 'fr' ? { d: 'j', h: 'h', m: 'min' }
    : locale === 'es' ? { d: 'd', h: 'h', m: 'min' }
    : locale === 'de' ? { d: 'T', h: 'h', m: 'min' }
    : { d: 'd', h: 'h', m: 'min' }
  if (day >= 1) return `${day}${labels.d}`
  if (hr >= 1) return `${hr}${labels.h}`
  if (min >= 1) return `${min}${labels.m}`
  return locale === 'fr' ? "à l'instant" : 'just now'
}

function emoji(type: string): string {
  switch (type) {
    case 'new_match_opportunity':  return '🎯'
    case 'new_candidature_received': return '👤'
    case 'candidature_unlocked':    return '🔓'
    case 'new_message':             return '💬'
    case 'verification_result':     return '✓'
    default:                        return '🔔'
  }
}

export default function NotificationBell({ ariaLabel }: { ariaLabel?: string }) {
  const t = useTranslations('notifications')
  const locale = useLocale()
  const router = useRouter()
  const domain = useDomain()
  const secureFetch = useSecureFetch()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[] | null>(null)
  const [unread, setUnread] = useState(0)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  const load = useCallback(async (silent: boolean) => {
    try {
      const res = await secureFetch('/api/me/notifications', { method: 'GET' })
      if (!res.ok) return
      const payload = (await res.json()) as { notifications?: Notification[]; unread_count?: number }
      setItems(payload.notifications ?? [])
      setUnread(payload.unread_count ?? 0)
    } catch (err) {
      if (!silent) console.error('[NotificationBell] load threw', err)
    }
  }, [secureFetch])

  // Initial + polling
  useEffect(() => {
    void load(false)
    const id = setInterval(() => void load(true), POLL_MS)
    return () => clearInterval(id)
  }, [load])

  // Click outside dropdown → close
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current?.contains(e.target as Node)) return
      if (buttonRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleNotifClick = async (n: Notification) => {
    // Mark read + navigate (best-effort sur read, non bloquant)
    if (n.read_at === null) {
      void secureFetch(`/api/me/notifications/${n.id}/read`, { method: 'POST' })
      setItems(prev => prev?.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x) ?? null)
      setUnread(u => Math.max(0, u - 1))
    }
    setOpen(false)
    if (n.link_url) router.push(n.link_url)
  }

  const handleReadAll = async () => {
    setUnread(0)
    setItems(prev => prev?.map(x => x.read_at === null ? { ...x, read_at: new Date().toISOString() } : x) ?? null)
    void secureFetch('/api/me/notifications', { method: 'POST' })
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={ariaLabel ?? t('aria_label_bell')}
        aria-expanded={open}
        style={{
          position: 'relative', width: 38, height: 38, borderRadius: 10,
          background: 'transparent', border: 'none', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: '#475569', transition: 'background .15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span
            aria-hidden
            style={{
              position: 'absolute', top: 4, right: 4,
              minWidth: 16, height: 16, padding: '0 4px',
              background: '#DC2626', color: '#fff',
              fontSize: 10, fontWeight: 700, lineHeight: '16px',
              textAlign: 'center', borderRadius: 999,
              boxSizing: 'border-box',
            }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={dropdownRef}
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            width: 360, maxHeight: 480, overflowY: 'auto',
            background: '#fff', border: '0.5px solid #e5e7eb',
            borderRadius: 12, boxShadow: '0 10px 25px rgba(0,0,0,0.08)',
            zIndex: 50, fontFamily: 'Inter, sans-serif',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '0.5px solid #e5e7eb' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{t('title')}</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void handleReadAll()}
                style={{ background: 'transparent', border: 'none', color: domain.primaryColor, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
              >
                {t('read_all')}
              </button>
            )}
          </div>
          {items === null ? (
            <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: '#94a3b8' }}>{t('loading')}</div>
          ) : items.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 6 }} aria-hidden>🔔</div>
              <div style={{ fontSize: 13, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>{t('empty_title')}</div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>{t('empty_body')}</div>
            </div>
          ) : (
            <div>
              {items.map((n) => {
                const isUnread = n.read_at === null
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => void handleNotifClick(n)}
                    style={{
                      width: '100%', textAlign: 'left',
                      display: 'flex', gap: 12, alignItems: 'flex-start',
                      padding: '12px 14px',
                      background: isUnread ? `${domain.primaryColor}0A` : 'transparent',
                      borderTop: '0.5px solid #f1f5f9',
                      border: 'none', borderLeft: isUnread ? `3px solid ${domain.primaryColor}` : '3px solid transparent',
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    <span aria-hidden style={{ fontSize: 18, flexShrink: 0, marginTop: 2 }}>{emoji(n.type)}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      {n.title && <div style={{ fontSize: 13, fontWeight: isUnread ? 700 : 600, color: '#0f172a', lineHeight: 1.35 }}>{n.title}</div>}
                      {n.body && <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.5, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{n.body}</div>}
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{relativeFromNow(n.created_at, locale)}</div>
                    </div>
                    {isUnread && (
                      <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: domain.primaryColor, flexShrink: 0, marginTop: 6 }} />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
