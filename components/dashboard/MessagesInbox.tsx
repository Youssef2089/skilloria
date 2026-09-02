'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRelativeTime } from '@/lib/use-relative-time'
import { useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import ConversationView from '@/components/dashboard/ConversationView'
import MessageContextPanel from '@/components/dashboard/MessageContextPanel'
import type { PublicationSynthesis } from '@/lib/publication-synthesis'
import CorrespondantAvatar from '@/components/dashboard/CorrespondantAvatar'
import { useLiveResource } from '@/hooks/useLiveResource'
import NewItemsPill from '@/components/ui/NewItemsPill'
import type { CandidatureLifecycle } from '@/lib/candidatures/lifecycle'
import { useCandidatureLifecycleLabel } from '@/lib/candidatures/use-lifecycle-label'

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
 * adossées à une candidature qui ouvre un échange (unlocked | selected).
 * Pas de messagerie libre.
 *
 * FILTRE (lot état de vie) : deux buckets, Actives et Archivées, ACTIVES PAR
 * DÉFAUT — les MÊMES que le menu Candidatures, dérivés par le MÊME helper
 * serveur. Un échange rangé « Archivé » ici l'est aussi là-bas ; l'expert et
 * l'org voient le même fait. Le client passe `?filter=` et rend ce qu'on lui
 * donne : il ne calcule aucun état. Une conversation archivée reste LISIBLE
 * en lecture seule — aucun historique n'est effacé.
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

type Correspondant = {
  kind: 'expert' | 'org'
  name: string | null
  /** SERVI PAR LE SERVEUR : `name` est-il un code de masquage (« YCH ») ?
   *  Le client ne le devine JAMAIS au motif de la chaine (point 20). */
  is_masked?: boolean
  avatar_url: string | null
}
// SC4 Lot synthèse parlante : publication = PublicationSynthesis + champs
// supplémentaires consommés par MessageContextPanel inline complet
// (description, skills_required, expires_at).
type ConvPublication = PublicationSynthesis & {
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
  /** État de vie dérivé serveur — bucket + raison + fin de fenêtre. */
  lifecycle?: CandidatureLifecycle | null
  publication: ConvPublication | null
  correspondant: Correspondant
  last_message: { content: string; created_at: string; sender_is_me: boolean } | null
  unread_count: number
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
  const tLifecycle = useTranslations('candidature_lifecycle')
  // Le correspondant décide du point de vue : l'org côté expert, l'expert
  // côté org. L'inbox d'un expert PUBLIANT mêle les deux — d'où la résolution
  // par conversation, pas par page.
  const lifecycleLabelExpert = useCandidatureLifecycleLabel('expert')
  const lifecycleLabelOrg = useCandidatureLifecycleLabel('org')
  const locale = useLocale()
  const relTime = useRelativeTime()
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
  /**
   * Bucket CHOISI PAR L'UTILISATEUR via les chips. `null` = il n'a rien choisi
   * encore ; c'est alors le SERVEUR qui décide (cf. `focus` plus bas).
   *
   * Ce n'est PAS le bucket affiché — celui-ci est `bucket`, plus bas, lu dans
   * la réponse. Le client ne calcule jamais le bucket : il l'obéit.
   */
  const [bucketOverride, setBucketOverride] = useState<'active' | 'archived' | null>(null)

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
  /**
   * `focus` n'est joint QUE tant que l'utilisateur n'a pas cliqué de chip, et
   * seulement si une conversation nous est imposée (arrivée par lien externe :
   * détail de candidature, notification). Le serveur répond alors avec le
   * bucket RÉEL de cette conversation.
   *
   * Il disparaît dès le premier clic sur une chip — sinon le serveur
   * écraserait le choix de l'utilisateur à chaque poll.
   *
   * ENTRÉE PAR LE MENU (`selectedConvId` absent) : `focusParam` est vide et
   * `requestedFilter` vaut 'active' → l'URL est identique au caractère près à
   * celle d'avant ce lot.
   */
  //   ⚠️ On lit la PROP `selectedConvId`, JAMAIS `localSelectedConvId`.
  //   `localSelectedConvId` bouge à chaque clic dans la liste : l'utiliser
  //   ajouterait `&focus=` après le premier clic sur l'entrée MENU, changerait
  //   la clé SWR et provoquerait un refetch inutile à chaque sélection — en
  //   plus de modifier la requête de l'entrée menu, ce qui est proscrit.
  //   La prop, elle, ne vaut quelque chose que sur /messages/[id] : c'est
  //   exactement le signal « une conversation m'est imposée de l'extérieur ».
  const focusParam = selectedConvId && bucketOverride === null
    ? `&focus=${encodeURIComponent(selectedConvId)}`
    : ''
  const requestedFilter = bucketOverride ?? 'active'

  const live = useLiveResource<
    {
      conversations: Conversation[]
      counts?: { active: number; archived: number }
      /** Bucket EFFECTIVEMENT servi. Fait autorité côté client. */
      filter?: string
    },
    Conversation
  >({
    url: `/api/me/conversations?locale=${encodeURIComponent(locale)}&filter=${requestedFilter}${focusParam}`,
    itemsOf: (d) => d.conversations ?? [],
    identityOf: (c) => c.id,
    // La raison entre dans la version : un fil qui bascule archivé (fenêtre
    // 15 j écoulée) doit se rafraîchir sans intervention.
    versionOf: (c) => `${c.last_message_at ?? ''}|${c.unread_count}|${c.status}|${c.lifecycle?.reason ?? ''}`,
    holdNewItems: true,
  })

  const conversations: Conversation[] = live.data?.conversations ?? []
  const counts = live.data?.counts ?? { active: 0, archived: 0 }
  /**
   * BUCKET AFFICHÉ — annoncé par le serveur, jamais déduit ici.
   * Repli sur le choix utilisateur (ou 'active') tant que la réponse n'est pas
   * là : c'est ce qui fait réagir la chip au clic sans attendre le réseau.
   */
  const servedFilter = live.data?.filter
  const bucket: 'active' | 'archived' =
    servedFilter === 'archived' || servedFilter === 'active'
      ? servedFilter
      : requestedFilter
  const groups = useMemo(() => groupByPublication(conversations), [conversations])

  // Conv sélectionnée (pour panneau ctx mission)
  const selectedConv = localSelectedConvId
    ? conversations.find((c) => c.id === localSelectedConvId) ?? null
    : null

  /**
   * L'échange est-il RÉELLEMENT ouvert ? Consommé par le badge côté org du
   * panneau de contexte, qui l'affirmait jusqu'ici sans rien vérifier.
   *
   * Trois faits SERVIS PAR LE SERVEUR, aucun recalcul, aucune requête :
   *   - `lifecycle.bucket` : la candidature est-elle encore vivante ;
   *   - `is_expired`       : la fenêtre de 15 j est-elle passée ;
   *   - `status === 'open'`: le fil n'a-t-il pas été clos explicitement.
   *
   * Le bucket seul ne suffirait PAS : une candidature `selected` reste
   * `active` sans limite de temps alors que sa conversation, elle, expire au
   * bout de 15 j — le badge aurait continué de mentir sur une mission
   * remportée. C'est exactement le prédicat dont ConversationView tire son
   * droit d'écriture : le badge dit désormais la même chose que le bandeau du
   * fil et que le champ de saisie.
   */
  const selectedExchangeOpen =
    selectedConv?.lifecycle?.bucket === 'active' &&
    !selectedConv.is_expired &&
    selectedConv.status === 'open'

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
          {/* Deux buckets, actives par défaut. Le clic re-demande au serveur —
              le client ne re-trie rien localement. */}
          <div style={{ display: 'flex', gap: 8, padding: '12px 14px', borderBottom: '0.5px solid #e5e7eb', flexShrink: 0 }}>
            {/* Pendant un chargement, `counts` n'est pas connu : libellé SANS
                nombre plutôt qu'un « (0) » faux. Un libellé nu ne ment pas.
                Les chips, elles, restent en place — elles sont hors des
                branches loading/empty, c'est ce qui permet de rebasculer
                d'onglet sans attendre. */}
            {([
              {
                key: 'active' as const,
                label: state.kind === 'loading'
                  ? tLifecycle('filters.active')
                  : tLifecycle('filters.active_count', { count: counts.active }),
              },
              {
                key: 'archived' as const,
                label: state.kind === 'loading'
                  ? tLifecycle('filters.archived')
                  : tLifecycle('filters.archived_count', { count: counts.archived }),
              },
            ]).map((b) => {
              const on = bucket === b.key
              return (
                <button
                  key={b.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setBucketOverride(b.key)}
                  style={{
                    fontSize: 12, fontWeight: 600, padding: '5px 12px',
                    borderRadius: 999,
                    color: on ? 'var(--sk-accent-ink)' : 'var(--sk-muted)',
                    background: on ? 'var(--sk-accent-soft)' : 'var(--sk-surface)',
                    border: on ? '1px solid transparent' : '1px solid var(--sk-border)',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {b.label}
                </button>
              )
            })}
          </div>
          {state.kind === 'loading' && (
            <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 13 }}>{t('loading')}</div>
          )}
          {state.kind === 'error' && (
            <div role="alert" style={{ padding: 16, color: '#b91c1c', fontSize: 13 }}>{state.message}</div>
          )}
          {state.kind === 'ready' && groups.length === 0 && (
            <div style={{ padding: '40px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>
                {tLifecycle(bucket === 'archived' ? 'messages_empty_archived_title' : 'messages_empty_active_title')}
              </div>
              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.55 }}>
                {tLifecycle(bucket === 'archived' ? 'messages_empty_archived_body' : 'messages_empty_active_body')}
              </div>
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
                    // Point de vue : correspondant='org' ⇒ je suis l'expert ;
                    // correspondant='expert' ⇒ je suis l'org. Même fait, deux
                    // vocabulaires — résolu par conversation, pas par page.
                    const label = c.correspondant.kind === 'org'
                      ? lifecycleLabelExpert(c.lifecycle, c.publication?.type)
                      : lifecycleLabelOrg(c.lifecycle, c.publication?.type)
                    const isArchived = c.lifecycle?.bucket === 'archived'
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
                          opacity: isArchived ? 0.7 : 1,
                          cursor: 'pointer',
                          transition: 'background .15s',
                        }}
                      >
                        <CorrespondantAvatar
                          name={c.correspondant.name}
                          isMasked={c.correspondant.is_masked === true}
                          avatarUrl={c.correspondant.avatar_url}
                          size={36}
                        />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                            <span style={{ minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                              <span style={{ fontSize: 13, fontWeight: c.unread_count > 0 ? 700 : 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {c.correspondant.name ?? t('unknown_correspondant')}
                              </span>
                              {/* A5 : étiquette de rôle SOBRE dérivée de correspondant.kind.
                                  kind='expert' ⇒ le correspondant est un expert ⇒ JE recrute.
                                  kind='org'    ⇒ le correspondant est une org  ⇒ JE candidate.
                                  Utile pour l'expert publiant dont l'inbox mêle les deux rôles. */}
                              <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#64748b', background: '#f1f5f9', border: '0.5px solid #e2e8f0', borderRadius: 6, padding: '1px 6px', lineHeight: 1.6 }}>
                                {c.correspondant.kind === 'expert' ? t('role_recruiter') : t('role_applicant')}
                              </span>
                            </span>
                            {c.last_message?.created_at && (
                              <span style={{ fontSize: 10, color: '#94a3b8', flexShrink: 0 }}>{relTime(c.last_message.created_at)}</span>
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
                          {/* ÉTAT DE VIE, en clair, sur chaque ligne. C'est
                              ici que l'utilisateur apprend qu'il a 15 jours :
                              « Échange ouvert jusqu'au … » rend la fenêtre
                              visible AVANT qu'elle se ferme. Et une fois
                              close, la ligne dit POURQUOI, jamais « Archivée »
                              tout court. */}
                          {label && (
                            <div
                              style={{
                                fontSize: 10.5,
                                marginTop: 3,
                                color: isArchived ? '#94a3b8' : '#166534',
                                fontWeight: 600,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {label}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
                          {c.unread_count > 0 && (
                            <span style={{ background: domain.primaryColor, color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 9 }}>
                              {c.unread_count}
                            </span>
                          )}
                          {/* Le badge « Expiré » nu a disparu : la ligne d'état
                              ci-dessus porte la raison complète. */}
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
            <MessageContextPanel
              publication={selectedConv?.publication ?? null}
              side={side}
              locale={locale}
              exchangeOpen={selectedExchangeOpen}
            />
          </div>
        )}
      </div>
    </div>
  )
}
