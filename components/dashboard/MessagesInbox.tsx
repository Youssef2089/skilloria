'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * Inbox messagerie partagé (Lot 3).
 *
 * Utilisé par /dashboard/freelance/messages et /dashboard/entreprise/messages.
 * basePath détermine l'URL des conversations (le côté freelance et le côté org
 * pointent vers leurs propres /messages/[id]).
 *
 * Polling : 15s (rafraîchit la liste sans interrompre l'utilisateur).
 */

type Correspondant = { kind: 'expert' | 'org'; name: string | null; avatar_url: string | null }
type Conversation = {
  id: string
  candidature_id: string
  status: string
  last_message_at: string | null
  expires_at: string | null
  is_expired: boolean
  publication: { id: string; type: string; title: string } | null
  correspondant: Correspondant
  last_message: { content: string; created_at: string; sender_is_me: boolean } | null
  unread_count: number
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; conversations: Conversation[] }

function relativeFromNow(iso: string | null, locale: string): string {
  if (!iso) return ''
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

export default function MessagesInbox({ side }: { side: 'freelance' | 'entreprise' }) {
  const t = useTranslations('messages.inbox')
  const tPub = useTranslations('publications')
  const locale = useLocale()
  const router = useRouter()
  const domain = useDomain()
  const secureFetch = useSecureFetch()
  const [state, setState] = useState<State>({ kind: 'loading' })

  const basePath = side === 'freelance' ? '/dashboard/freelance' : '/dashboard/entreprise'

  const load = useCallback(async () => {
    try {
      const res = await secureFetch('/api/me/conversations', { method: 'GET' })
      if (!res.ok) {
        setState({ kind: 'error', message: t('error_generic') })
        return
      }
      const payload = (await res.json().catch(() => ({}))) as { conversations?: Conversation[] }
      setState({ kind: 'ready', conversations: payload.conversations ?? [] })
    } catch (err) {
      console.error('[inbox] fetch threw', err)
      setState({ kind: 'error', message: t('error_generic') })
    }
  }, [secureFetch, t])

  useEffect(() => {
    void load()
    const id = setInterval(() => { void load() }, 15_000)
    return () => clearInterval(id)
  }, [load])

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '28px 24px 60px', fontFamily: 'Inter, sans-serif' }}>
      <button
        type="button"
        onClick={() => router.push(basePath)}
        style={{
          background: 'transparent', border: 'none',
          color: domain.primaryColor, fontSize: 13, fontWeight: 600,
          cursor: 'pointer', padding: 0, marginBottom: 16,
        }}
      >
        {t('back_to_dashboard')}
      </button>

      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', lineHeight: 1.3, letterSpacing: '-0.2px', marginBottom: 6 }}>
        {t('title')}
      </h1>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 24 }}>{t('subtitle')}</p>

      {state.kind === 'loading' && (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 14 }}>{t('loading')}</div>
      )}
      {state.kind === 'error' && (
        <div role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '12px 16px', borderRadius: 10, fontSize: 13 }}>
          {state.message}
        </div>
      )}

      {state.kind === 'ready' && state.conversations.length === 0 && (
        <div
          style={{
            background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: 14,
            padding: '40px 24px', textAlign: 'center', color: '#64748b', fontSize: 14, lineHeight: 1.6,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>{t('empty_title')}</div>
          <div>{t('empty_subtitle')}</div>
        </div>
      )}

      {state.kind === 'ready' && state.conversations.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {state.conversations.map((c) => (
            <Link
              key={c.id}
              href={`${basePath}/messages/${c.id}`}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 14,
                background: '#fff',
                border: c.unread_count > 0 ? `1.5px solid ${domain.primaryColor}` : '0.5px solid #e5e7eb',
                borderRadius: 12, padding: '14px 16px',
                textDecoration: 'none', color: 'inherit',
                opacity: c.is_expired ? 0.7 : 1,
              }}
            >
              {/* Avatar */}
              {c.correspondant.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.correspondant.avatar_url} alt="" style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
              ) : (
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#f1f5f9', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 600, flexShrink: 0 }}>
                  {c.correspondant.name ? c.correspondant.name[0]?.toUpperCase() ?? '?' : '?'}
                </div>
              )}

              {/* Texte */}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: c.unread_count > 0 ? 700 : 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.correspondant.name ?? t('unknown_correspondant')}
                  </span>
                  {c.last_message?.created_at && (
                    <span style={{ fontSize: 11, color: '#94a3b8', flexShrink: 0 }}>{relativeFromNow(c.last_message.created_at, locale)}</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.publication && <span style={{ fontWeight: 500 }}>{tPub(`type.${c.publication.type}`)} · {c.publication.title}</span>}
                </div>
                <div style={{ fontSize: 13, color: c.unread_count > 0 ? '#0f172a' : '#64748b', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: c.unread_count > 0 ? 600 : 400 }}>
                  {c.last_message ? (
                    <>
                      {c.last_message.sender_is_me && <span style={{ color: '#94a3b8' }}>{t('sender_me')} </span>}
                      {c.last_message.content}
                    </>
                  ) : (
                    <span style={{ fontStyle: 'italic', color: '#94a3b8' }}>{t('no_messages_yet')}</span>
                  )}
                </div>
              </div>

              {/* Right meta : badges */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                {c.unread_count > 0 && (
                  <span style={{ background: domain.primaryColor, color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>
                    {c.unread_count}
                  </span>
                )}
                {c.is_expired && (
                  <span style={{ background: '#f1f5f9', color: '#64748b', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                    {t('expired_badge')}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
