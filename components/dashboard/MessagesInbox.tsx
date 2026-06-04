'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch } from '@/lib/secure-fetch'
import ConversationView from '@/components/dashboard/ConversationView'

/**
 * Inbox messagerie LAYOUT 2 PANNEAUX (Point 6 finitions UX).
 *
 *   ┌───────────────┬──────────────────────────────────┐
 *   │ Liste (gauche)│ Fil sélectionné (droite)         │
 *   │  groupée par  │  ou empty state "Choisissez…"    │
 *   │  mission/annon│                                  │
 *   └───────────────┴──────────────────────────────────┘
 *
 * Scope strict : /api/me/conversations ne retourne QUE les conversations
 * unlocked + non expirées (RLS core_loop). Pas de messagerie libre.
 *
 * Comportement :
 *   - `selectedConvId` (prop optionnel) pré-sélectionne une conv à droite
 *     (cas /messages/[id] : page délègue ici avec l'id de l'URL).
 *   - Sinon : empty state à droite, l'utilisateur choisit dans la liste.
 *   - Mobile (< 768px) : empilement, le panneau actif occupe tout l'écran.
 *     Sur clic d'une conv, on navigate vers /messages/[id] pour basculer
 *     en plein écran sur mobile.
 *
 * Regroupement : par `publication.id`. Côté expert un groupe = en général
 * 1 conv (1 candidature unique par publi par expert). Côté org, plusieurs
 * candidatures sur la même annonce → plusieurs convs dans le même groupe.
 *
 * Polling 30s aligné cloche + focus + bump.
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

type Group = { publication: { id: string; type: string; title: string } | null; conversations: Conversation[] }

function groupByPublication(convs: Conversation[]): Group[] {
  const map = new Map<string, Group>()
  for (const c of convs) {
    const key = c.publication?.id ?? '__no_pub__'
    let g = map.get(key)
    if (!g) { g = { publication: c.publication, conversations: [] }; map.set(key, g) }
    g.conversations.push(c)
  }
  // Tri : groupes par last_message_at de leur conv la plus récente
  const groups = Array.from(map.values())
  for (const g of groups) {
    g.conversations.sort((a, b) => {
      const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
      const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
      return tb - ta
    })
  }
  groups.sort((a, b) => {
    const ta = a.conversations[0]?.last_message_at ? new Date(a.conversations[0].last_message_at!).getTime() : 0
    const tb = b.conversations[0]?.last_message_at ? new Date(b.conversations[0].last_message_at!).getTime() : 0
    return tb - ta
  })
  return groups
}

export default function MessagesInbox({ side, selectedConvId }: { side: 'freelance' | 'entreprise'; selectedConvId?: string | null }) {
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
    const intervalId = window.setInterval(() => { void load() }, 30_000)
    const onFocus = () => { void load() }
    const onNotifBump = () => { void load() }
    window.addEventListener('focus', onFocus)
    window.addEventListener('skilloria:notif-bump', onNotifBump)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('skilloria:notif-bump', onNotifBump)
    }
  }, [load])

  const groups = useMemo(() => state.kind === 'ready' ? groupByPublication(state.conversations) : [], [state])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 24px 40px', fontFamily: 'Inter, sans-serif' }}>
      <button
        type="button"
        onClick={() => router.push(basePath)}
        style={{ background: 'transparent', border: 'none', color: domain.primaryColor, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0, marginBottom: 14 }}
      >
        {t('back_to_dashboard')}
      </button>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', lineHeight: 1.3, letterSpacing: '-0.2px', marginBottom: 4 }}>
        {t('title')}
      </h1>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>{t('subtitle')}</p>

      {/* Layout 2 panneaux */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(280px, 360px) 1fr',
          gap: 18,
          minHeight: 480,
          alignItems: 'stretch',
        }}
        className="messages-2col"
        data-conv-selected={selectedConvId ? 'true' : 'false'}
      >
        {/* Inline responsive : sur mobile, on cache la colonne non-active */}
        <style>{`
          @media (max-width: 768px) {
            .messages-2col { grid-template-columns: 1fr !important; }
            .messages-2col[data-conv-selected="true"] .inbox-list-col { display: none; }
            .messages-2col[data-conv-selected="false"] .inbox-detail-col { display: none; }
          }
        `}</style>

        {/* Colonne gauche : liste */}
        <div
          className="inbox-list-col"
          style={{
            background: '#fff',
            border: '0.5px solid #e5e7eb',
            borderRadius: 12,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {state.kind === 'loading' && (
            <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 13 }}>{t('loading')}</div>
          )}
          {state.kind === 'error' && (
            <div role="alert" style={{ padding: 16, color: '#b91c1c', fontSize: 13 }}>{state.message}</div>
          )}
          {state.kind === 'ready' && groups.length === 0 && (
            <div style={{ padding: '40px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>{t('empty_title')}</div>
              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.55 }}>{t('empty_subtitle')}</div>
            </div>
          )}
          {state.kind === 'ready' && groups.length > 0 && (
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {groups.map((g) => (
                <div key={g.publication?.id ?? '__no_pub__'}>
                  {/* En-tête groupe : titre de la mission/annonce */}
                  <div style={{ padding: '12px 14px 6px', background: '#f8fafc', borderBottom: '0.5px solid #e5e7eb' }}>
                    <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#94a3b8', marginBottom: 2 }}>
                      {g.publication ? tPub(`type.${g.publication.type}`) : t('group_no_publication')}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {g.publication?.title ?? t('group_no_publication_title')}
                    </div>
                  </div>
                  {/* Conversations du groupe */}
                  {g.conversations.map((c) => {
                    const active = selectedConvId === c.id
                    return (
                      <Link
                        key={c.id}
                        href={`${basePath}/messages/${c.id}`}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 10,
                          padding: '12px 14px',
                          background: active ? `${domain.primaryColor}0F` : 'transparent',
                          borderBottom: '0.5px solid #f1f5f9',
                          borderLeft: active ? `3px solid ${domain.primaryColor}` : '3px solid transparent',
                          textDecoration: 'none', color: 'inherit',
                          opacity: c.is_expired ? 0.7 : 1,
                          transition: 'background .15s',
                        }}
                      >
                        {c.correspondant.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.correspondant.avatar_url} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                        ) : (
                          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f1f5f9', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, flexShrink: 0 }}>
                            {c.correspondant.name ? c.correspondant.name[0]?.toUpperCase() ?? '?' : '?'}
                          </div>
                        )}
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: c.unread_count > 0 ? 700 : 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {c.correspondant.name ?? t('unknown_correspondant')}
                            </span>
                            {c.last_message?.created_at && (
                              <span style={{ fontSize: 10, color: '#94a3b8', flexShrink: 0 }}>{relativeFromNow(c.last_message.created_at, locale)}</span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: c.unread_count > 0 ? '#0f172a' : '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: c.unread_count > 0 ? 600 : 400 }}>
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
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
                          {c.unread_count > 0 && (
                            <span style={{ background: domain.primaryColor, color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 9 }}>
                              {c.unread_count}
                            </span>
                          )}
                          {c.is_expired && (
                            <span style={{ background: '#f1f5f9', color: '#64748b', fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 9, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                              {t('expired_badge')}
                            </span>
                          )}
                        </div>
                      </Link>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Colonne droite : fil sélectionné ou empty state */}
        <div
          className="inbox-detail-col"
          style={{
            background: '#fff',
            border: '0.5px solid #e5e7eb',
            borderRadius: 12,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 480,
          }}
        >
          {selectedConvId ? (
            <ConversationView convId={selectedConvId} side={side} embedded />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }} aria-hidden>💬</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>{t('detail_empty_title')}</div>
              <div style={{ fontSize: 13, color: '#64748b', maxWidth: 340, lineHeight: 1.55 }}>{t('detail_empty_subtitle')}</div>
            </div>
          )}
        </div>

        {/* Indicateur pour le CSS responsive : conv sélectionnée OU pas */}
        <style>{`.messages-2col { }`}</style>
      </div>
    </div>
  )
}
