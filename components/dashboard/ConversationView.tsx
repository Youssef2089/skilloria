'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch } from '@/lib/secure-fetch'
import CorrespondantAvatar from '@/components/dashboard/CorrespondantAvatar'
import type { CandidatureLifecycle } from '@/lib/candidatures/lifecycle'

/**
 * Vue d'une conversation (Lot 3).
 *
 * Polling 5s sur les messages (la route GET marque read_at sur les messages
 * REÇUS uniquement, jamais ceux de l'utilisateur courant).
 *
 * Bandeau "lecture seule" + input désactivé dès qu'on ne peut plus écrire.
 * Le bandeau dit POURQUOI, en suivant l'état de vie DÉRIVÉ PAR LE SERVEUR
 * (`lifecycle`, lib/candidatures/lifecycle.ts) — la même source que le bucket
 * Actives/Archivées de l'inbox. Aucun état n'est recalculé ici.
 */

type Correspondant = {
  kind: 'expert' | 'org'
  name: string | null
  /** SERVI PAR LE SERVEUR : `name` est-il un code de masquage (« YCH ») ?
   *  Le client ne le devine JAMAIS au motif de la chaine (point 20). */
  is_masked?: boolean
  avatar_url: string | null
}
type Message = {
  id: string
  sender_id: string
  sender_is_me: boolean
  content: string
  read_at: string | null
  created_at: string
}
type ConvHeader = {
  conversation: { id: string; candidature_id: string; status: string; last_message_at: string | null; expires_at: string | null; is_expired: boolean }
  /** État de vie dérivé serveur. Optionnel : réponse d'une version antérieure. */
  lifecycle?: CandidatureLifecycle | null
  publication: { id: string; type: string; title: string } | null
  correspondant: Correspondant
  me: { user_id: string; role: 'expert' | 'org' }
  messages: Message[]
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: ConvHeader }

function formatTime(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

function formatDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' })
  } catch {
    return iso
  }
}

/**
 * Props :
 *   - convId   : id de la conversation à afficher
 *   - side     : freelance | entreprise (pour les URLs back)
 *   - embedded : true quand le composant est intégré dans le layout 2 panneaux
 *                de MessagesInbox (Point 6 finitions UX). Dans ce mode :
 *                  • pas de wrapper plein écran (maxWidth/padding réduits)
 *                  • pas de bouton "Retour à l'inbox" (la liste est à gauche)
 *                Par défaut false → comportement Lot 3 (plein écran).
 */
export default function ConversationView({ convId, side, embedded = false }: { convId: string; side: 'freelance' | 'entreprise' | 'cdi'; embedded?: boolean }) {
  const t = useTranslations('messages.view')
  const tPub = useTranslations('publications')
  // Les phrases qui décrivent l'ÉTAT DE VIE vivent toutes dans le même
  // namespace que les libellés dérivés du lot — une seule source de vocabulaire.
  const tLifecycle = useTranslations('candidature_lifecycle')
  const locale = useLocale()
  const router = useRouter()
  const domain = useDomain()
  const secureFetch = useSecureFetch()

  const [state, setState] = useState<State>({ kind: 'loading' })
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const lastMsgCountRef = useRef<number>(0)

  // SC7b : 'cdi' partage la même base path pattern que 'freelance' (just /dashboard/{side}).
  const basePath = side === 'entreprise' ? '/dashboard/entreprise' : `/dashboard/${side}`

  const load = useCallback(async (silent: boolean) => {
    if (!silent) setState({ kind: 'loading' })
    try {
      // `locale` : le serveur en a besoin pour les libellés de repli du
      // masquage d'identité (« Expert », « Utilisateur supprimé »…), qui sont
      // choisis CÔTÉ SERVEUR et non traduits ici.
      const res = await secureFetch(
        `/api/conversations/${convId}/messages?locale=${encodeURIComponent(locale)}`,
        { method: 'GET' },
      )
      const payload = (await res.json().catch(() => ({} as { code?: string }))) as { code?: string } & Partial<ConvHeader>
      if (!res.ok) {
        if (!silent) setState({ kind: 'error', message: payload.code === 'not_found' ? t('error_not_found') : t('error_generic') })
        return
      }
      setState({ kind: 'ready', data: payload as ConvHeader })
    } catch (err) {
      if (!silent) {
        console.error('[conv view] fetch threw', err)
        setState({ kind: 'error', message: t('error_generic') })
      }
    }
    // `locale` fait partie des dépendances : elle est envoyée au serveur, qui
    // s'en sert pour choisir les libellés de repli du masquage. L'omettre
    // figerait le fil dans la langue du premier rendu après un changement de
    // langue.
  }, [convId, secureFetch, t, locale])

  // Initial + polling 5s
  useEffect(() => {
    void load(false)
    const id = setInterval(() => { void load(true) }, 5_000)
    return () => clearInterval(id)
  }, [load])

  // Auto-scroll bas quand de nouveaux messages arrivent
  useEffect(() => {
    if (state.kind === 'ready') {
      const count = state.data.messages.length
      if (count !== lastMsgCountRef.current) {
        lastMsgCountRef.current = count
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
      }
    }
  }, [state])

  const handleSend = async () => {
    const content = draft.trim()
    if (!content) return
    if (content.length > 5000) {
      setSendError(t('error_too_long'))
      return
    }
    setSending(true)
    setSendError(null)
    try {
      const res = await secureFetch(`/api/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const payload = (await res.json().catch(() => ({} as { code?: string }))) as { code?: string }
      if (!res.ok) {
        if (payload.code === 'expired') setSendError(t('error_expired'))
        else if (payload.code === 'closed') setSendError(t('error_closed'))
        else if (payload.code === 'invalid_content') setSendError(t('error_invalid_content'))
        else setSendError(t('error_generic'))
        return
      }
      setDraft('')
      await load(true)
    } catch (err) {
      console.error('[conv view] send threw', err)
      setSendError(t('error_generic'))
    } finally {
      setSending(false)
    }
  }

  if (state.kind === 'loading') {
    return <div style={{ padding: 48, textAlign: 'center', color: '#64748b', fontFamily: 'Inter, sans-serif' }}>{t('loading')}</div>
  }
  if (state.kind === 'error') {
    return (
      <div style={{ maxWidth: 560, margin: '60px auto', padding: '0 24px', textAlign: 'center', fontFamily: 'Inter, sans-serif' }}>
        <p style={{ fontSize: 14, color: '#b91c1c', marginBottom: 18 }}>{state.message}</p>
        <button
          type="button"
          onClick={() => router.push(`${basePath}/messages`)}
          style={{ padding: '10px 18px', background: domain.primaryColor, color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {t('back_to_inbox')}
        </button>
      </div>
    )
  }

  const { conversation, publication, correspondant, messages, lifecycle } = state.data
  const isExpired = conversation.is_expired
  const isClosed = conversation.status !== 'open'
  // ARCHIVÉE au sens état de vie, dérivé SERVEUR. Intégré à `canWrite` pour
  // que l'input ne puisse jamais rester ouvert sur un fil que le serveur range
  // dans Archivées — cas legacy d'une conversation sans `expires_at`, dont la
  // fenêtre est pourtant calculable depuis `unlocked_at` (repli de
  // effectiveConversationExpiry). Sans ça, l'inbox dirait « Archivé » pendant
  // que cette vue laisserait écrire.
  const isArchived = lifecycle?.bucket === 'archived'
  const canWrite = !isExpired && !isClosed && !isArchived
  /**
   * Phrase du bandeau — dit TOUJOURS pourquoi, jamais seulement que.
   * Elle suit le bucket dérivé, pas une horloge relue ici :
   *   • archivée              → « Cet échange est archivé … »
   *   • fenêtre 15 j écoulée mais candidature encore ACTIVE ('selected' :
   *     mission remportée / poste décroché) → on ne peut pas dire « archivé »
   *     sans contredire le serveur : on dit que la fenêtre est close.
   *   • fil explicitement fermé → fait propre à la CONVERSATION, distinct de
   *     l'état de vie de la candidature : libellé messages.view d'origine.
   */
  const bannerText = isArchived
    ? tLifecycle('read_only_notice')
    : isExpired
      ? tLifecycle('read_only_window_closed')
      : t('banner_closed')

  // Group messages by day for header separators
  const dayKey = (iso: string) => {
    const d = new Date(iso)
    return d.toISOString().slice(0, 10)
  }
  const groups: { day: string; items: Message[] }[] = []
  for (const m of messages) {
    const k = dayKey(m.created_at)
    let g = groups[groups.length - 1]
    if (!g || g.day !== k) { g = { day: k, items: [] }; groups.push(g) }
    g.items.push(m)
  }

  return (
    <div
      style={
        embedded
          ? { padding: '14px 16px', fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }
          : { maxWidth: 880, margin: '0 auto', padding: '20px 24px 60px', fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 40px)' }
      }
    >
      {!embedded && (
        <button
          type="button"
          onClick={() => router.push(`${basePath}/messages`)}
          style={{ background: 'transparent', border: 'none', color: domain.primaryColor, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0, marginBottom: 12 }}
        >
          {t('back_to_inbox')}
        </button>
      )}

      {/* Header conv : correspondant + publication */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 14, borderBottom: '0.5px solid #e5e7eb', marginBottom: 14 }}>
        <CorrespondantAvatar
          name={correspondant.name}
          isMasked={correspondant.is_masked === true}
          avatarUrl={correspondant.avatar_url}
          size={44}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{correspondant.name ?? t('unknown_correspondant')}</div>
          {publication && (
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              {tPub(`type.${publication.type}`)} · {publication.title}
            </div>
          )}
        </div>
      </header>

      {/* Bandeau lecture seule — affiché exactement quand l'envoi est bloqué */}
      {!canWrite && (
        <div
          role="status"
          style={{
            background: '#FEF9C3', border: '1px solid #FACC15', color: '#854D0E',
            padding: '10px 14px', borderRadius: 10, fontSize: 13, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          <span aria-hidden>🔒</span>
          <span>{bannerText}</span>
        </div>
      )}

      {/* Fil de messages */}
      <div
        ref={listRef}
        style={{
          flex: 1, overflowY: 'auto', minHeight: 320, maxHeight: 'calc(100vh - 320px)',
          background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: 12, padding: '14px 16px',
          display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12,
        }}
      >
        {messages.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 14, fontStyle: 'italic' }}>
            {t('empty_no_messages')}
          </div>
        )}
        {groups.map((g) => (
          <div key={g.day} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ alignSelf: 'center', fontSize: 11, color: '#94a3b8', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.06em', padding: '4px 0' }}>
              {formatDate(g.day, locale)}
            </div>
            {g.items.map((m) => {
              const me = m.sender_is_me
              return (
                <div key={m.id} style={{ display: 'flex', justifyContent: me ? 'flex-end' : 'flex-start' }}>
                  <div
                    style={{
                      maxWidth: '70%',
                      background: me ? domain.primaryColor : '#f1f5f9',
                      color: me ? '#fff' : '#0f172a',
                      padding: '9px 13px',
                      borderRadius: me ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                      fontSize: 13.5,
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {m.content}
                    <div style={{ fontSize: 10, color: me ? 'rgba(255,255,255,0.78)' : '#94a3b8', marginTop: 4, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
                      <span>{formatTime(m.created_at, locale)}</span>
                      {me && (
                        <span aria-hidden title={m.read_at ? t('read_at_tooltip') : t('sent_tooltip')}>
                          {m.read_at ? '✓✓' : '✓'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Input */}
      <div style={{ background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: 12, padding: '10px 12px' }}>
        {sendError && (
          <div role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '8px 12px', borderRadius: 8, fontSize: 12, marginBottom: 8 }}>
            {sendError}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={canWrite ? t('input_placeholder') : t('input_disabled_placeholder')}
            disabled={!canWrite || sending}
            rows={2}
            maxLength={5000}
            style={{
              flex: 1, resize: 'vertical', padding: '10px 12px',
              fontSize: 14, lineHeight: 1.5,
              border: '1px solid #cbd5e1', borderRadius: 10,
              outline: 'none', fontFamily: 'inherit',
              background: canWrite ? '#fff' : '#f8fafc',
              color: canWrite ? '#0f172a' : '#94a3b8',
              cursor: canWrite ? 'text' : 'not-allowed',
              boxSizing: 'border-box',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canWrite && !sending) {
                e.preventDefault()
                void handleSend()
              }
            }}
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!canWrite || sending || draft.trim().length === 0}
            style={{
              padding: '10px 18px',
              background: !canWrite || draft.trim().length === 0 ? '#cbd5e1' : domain.primaryColor,
              color: '#fff', border: 'none', borderRadius: 10,
              fontSize: 13, fontWeight: 700,
              cursor: (canWrite && draft.trim().length > 0 && !sending) ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit', opacity: sending ? 0.6 : 1, flexShrink: 0,
            }}
          >
            {sending ? t('sending') : t('send')}
          </button>
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
          <span>{t('input_hint')}</span>
          <span>{draft.length} / 5000</span>
        </div>
      </div>
    </div>
  )
}
