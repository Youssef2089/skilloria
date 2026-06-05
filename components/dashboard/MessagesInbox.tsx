'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import ConversationView from '@/components/dashboard/ConversationView'
import MessageContextPanel from '@/components/dashboard/MessageContextPanel'
import { useLiveResource } from '@/hooks/useLiveResource'
import NewItemsPill from '@/components/ui/NewItemsPill'

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
// SC4 Lot synthèse parlante : publication = PublicationSynthesis + champs
// supplémentaires consommés par MessageContextPanel inline complet
// (description, skills_required, expires_at).
type ConvPublication = {
  id: string
  type: 'mission' | 'offre'
  title: string
  budget_min: number | null
  budget_max: number | null
  budget_unit: 'day' | 'year'
  location: string | null
  work_mode: string | null
  duration: string | null
  start_date: string | null
  seniority: string | null
  branch_label: string | null
  speciality_label: string | null
  confidential: boolean
  description: string | null
  skills_required: string[] | null
  expires_at: string | null
}
type Conversation = {
  id: string
  candidature_id: string
  status: string
  last_message_at: string | null
  expires_at: string | null
  is_expired: boolean
  publication: ConvPublication | null
  correspondant: Correspondant
  last_message: { content: string; created_at: string; sender_is_me: boolean } | null
  unread_count: number
}

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

type Group = { publication: ConvPublication | null; conversations: Conversation[] }

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

export default function MessagesInbox({
  side,
  selectedConvId,
}: {
  /** SC7b : 'cdi' utilise les mêmes endpoints que freelance — l'expert
   *  est unique côté DB ; seule la base path d'URL diffère. */
  side: 'freelance' | 'entreprise' | 'cdi'
  /** Pré-sélection au mount (deep-link /messages/[id] ou nav notif). */
  selectedConvId?: string | null
}) {
  const t = useTranslations('messages.inbox')
  const tPub = useTranslations('publications')
  const locale = useLocale()
  const router = useRouter()
  const domain = useDomain()

  const basePath = side === 'entreprise' ? '/dashboard/entreprise' : `/dashboard/${side}`

  // Lot polish UX SC3 — sélection sans remount :
  //  La conv sélectionnée est state LOCAL. Le clic sur une conv ne navigue
  //  PAS (le <Link> précédent forçait un remount complet de la page
  //  /messages → /messages/[id], re-fetchant tout). À la place :
  //    1. setLocalSelectedConvId(id) → seul <ConversationView> change de
  //       convId. La liste, le panneau et la topbar ne ré-mountent pas.
  //    2. window.history.replaceState met à jour l'URL → deep-link et
  //       partage URL toujours fonctionnels, mais sans navigation.
  //  Le prop selectedConvId reste lu au mount (initial state) pour
  //  préserver la chaîne notif → /messages/[id].
  const [localSelectedConvId, setLocalSelectedConvId] = useState<string | null>(selectedConvId ?? null)

  useEffect(() => {
    if (selectedConvId !== undefined && selectedConvId !== null) {
      setLocalSelectedConvId(selectedConvId)
    }
  }, [selectedConvId])

  const handleSelectConv = (convId: string) => {
    if (convId === localSelectedConvId) return
    setLocalSelectedConvId(convId)
    if (typeof window !== 'undefined') {
      // Synchronise l'URL sans naviguer (deep-link OK, retour navigateur sain).
      const target = `${basePath}/messages/${convId}`
      // useRouter().push provoquerait un nouveau render serveur ; replaceState
      // garde le history propre.
      const localePrefix = window.location.pathname.startsWith(`/${locale}/`) ? `/${locale}` : ''
      window.history.replaceState(null, '', `${localePrefix}${target}`)
    }
  }

  // useLiveResource : SWR + hold new items. Pour les conversations on
  // retient les NOUVELLES convs (pastille "N nouvelle(s)") pour ne pas
  // faire bouger la liste pendant que l'user lit. Les updates en place
  // (last_message_at, unread_count) sont appliqués directement (clés
  // stables = conv.id).
  const live = useLiveResource<{ conversations: Conversation[] }, Conversation>({
    url: `/api/me/conversations?locale=${encodeURIComponent(locale)}`,
    itemsOf: (d) => d.conversations ?? [],
    identityOf: (c) => c.id,
    versionOf: (c) => `${c.last_message_at ?? ''}|${c.unread_count}|${c.status}`,
    holdNewItems: true,
  })

  const conversations: Conversation[] = live.data?.conversations ?? []
  const groups = useMemo(() => groupByPublication(conversations), [conversations])

  // Conv sélectionnée (pour panneau ctx mission)
  const selectedConv = localSelectedConvId
    ? conversations.find((c) => c.id === localSelectedConvId) ?? null
    : null

  // Force le suivi de l'état dérivé pour state-based rendering ci-dessous.
  const state = live.state

  // ── Render ────────────────────────────────────────────────────────────────
  //  Lot refonte UX commit B/C : 3 zones (liste + fil + ctx mission).
  //  Si pas de conv sélectionnée → liste seule + empty state à droite.
  void router; void domain
  return (
    <div style={{ padding: '0', fontFamily: 'inherit', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Layout 3 zones */}
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: localSelectedConvId
            ? 'minmax(280px, 320px) 1fr minmax(260px, 320px)'
            : 'minmax(280px, 360px) 1fr',
          minHeight: 0,
          alignItems: 'stretch',
        }}
        className="messages-cols"
        data-conv-selected={localSelectedConvId ? 'true' : 'false'}
      >
        {/* Responsive : tablette → 2 zones (cache ctx), mobile → 1 zone */}
        <style>{`
          @media (max-width: 1279px) {
            .messages-cols[data-conv-selected="true"] { grid-template-columns: minmax(280px, 320px) 1fr !important; }
            .messages-cols .inbox-ctx-col { display: none !important; }
          }
          @media (max-width: 768px) {
            .messages-cols { grid-template-columns: 1fr !important; }
            .messages-cols[data-conv-selected="true"] .inbox-list-col { display: none; }
            .messages-cols[data-conv-selected="false"] .inbox-detail-col { display: none; }
          }
        `}</style>

        {/* Colonne gauche : liste */}
        <div
          className="inbox-list-col"
          style={{
            background: 'var(--sk-surface)',
            borderRight: '1px solid var(--sk-border)',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
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
              {/* Pastille "N nouvelles conversations" si holdNewItems a retenu des nouveautés. */}
              <NewItemsPill
                count={live.pendingCount}
                onApply={live.applyPending}
                variant="conversations"
              />
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
                    const active = localSelectedConvId === c.id
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleSelectConv(c.id)}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 10,
                          padding: '12px 14px',
                          width: '100%',
                          background: active ? `${domain.primaryColor}0F` : 'transparent',
                          borderTop: 'none', borderRight: 'none',
                          borderBottom: '0.5px solid #f1f5f9',
                          borderLeft: active ? `3px solid ${domain.primaryColor}` : '3px solid transparent',
                          textDecoration: 'none', color: 'inherit',
                          textAlign: 'left',
                          fontFamily: 'inherit',
                          opacity: c.is_expired ? 0.7 : 1,
                          cursor: 'pointer',
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
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Colonne milieu : fil sélectionné ou empty state */}
        <div
          className="inbox-detail-col"
          style={{
            background: 'var(--sk-bg)',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          {localSelectedConvId ? (
            <ConversationView convId={localSelectedConvId} side={side} embedded />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }} aria-hidden>💬</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--sk-text)', marginBottom: 6 }}>{t('detail_empty_title')}</div>
              <div style={{ fontSize: 13, color: 'var(--sk-muted)', maxWidth: 340, lineHeight: 1.55 }}>{t('detail_empty_subtitle')}</div>
            </div>
          )}
        </div>

        {/* Colonne droite : ctx mission (3ᵉ zone — n'apparaît que si conv sélectionnée) */}
        {localSelectedConvId && (
          <div className="inbox-ctx-col" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <MessageContextPanel publication={selectedConv?.publication ?? null} side={side} locale={locale} />
          </div>
        )}
      </div>
    </div>
  )
}
