'use client'

import { useTranslations } from 'next-intl'
import { useRelativeTime } from '@/lib/use-relative-time'
import { Link } from '@/i18n/navigation'
import {
  IconSend,
  IconSparkles,
  IconLockOpen,
  IconClock,
  IconX,
  IconMessage2,
  IconExternalLink,
  IconTrophy,
} from '@tabler/icons-react'
import TimelineStep from '@/components/ui/TimelineStep'
import PublicationSynthesisLine, { type PublicationSynthesisData } from '@/components/dashboard/PublicationSynthesisLine'
import type { CandidatureLifecycle, CandidatureLifecycleReason } from '@/lib/candidatures/lifecycle'
import { useCandidatureLifecycleLabel } from '@/lib/candidatures/use-lifecycle-label'

/**
 * CandidatureDetailPanel — détail d'UNE candidature côté expert.
 *
 * SOURCE UNIQUE : utilisé À LA FOIS comme panneau de droite du master-detail
 * (/dashboard/{side}/candidatures) ET comme contenu de la page de détail dédiée
 * (/dashboard/{side}/candidatures/[id]). Aucune duplication.
 *
 * Composant présentationnel auto-suffisant : il résout lui-même i18n + locale
 * (plus de prop-drilling). Contenu : en-tête (titre + type + statut), bandeau
 * 🏆 'selected', chips synthèse, timeline SUIVI, message de motivation, et les
 * actions « Ouvrir la conversation » / « Voir la mission ».
 */

export type Candidature = {
  id: string
  publication_id: string
  publication:
    | (PublicationSynthesisData & {
        status: string | null
        /**
         * L'annonce est-elle encore CONSULTABLE ? Dérivé SERVEUR par
         * `isActivePublished` (règle 30 j, source unique). Optionnel au type
         * près : un call-site qui ne le sert pas encore laisse le lien actif
         * plutôt que de griser à tort.
         */
        is_available?: boolean
      })
    | null
  status: string
  status_reason: string | null
  ai_match_score: number | null
  unlocked_at: string | null
  selected_at: string | null
  cover_message: string | null
  created_at: string
  conversation_id: string | null
  viewed_by_me?: boolean
  /**
   * État de vie DÉRIVÉ SERVEUR (/api/me/candidatures). Source unique du
   * libellé et de la teinte de la pastille — `status` ne sert plus à
   * fabriquer un mot. Optionnel au type près pour rester tolérant aux
   * call-sites qui n'ont pas encore la donnée ; le rendu retombe alors
   * silencieusement sur rien plutôt que sur un libellé menteur.
   */
  lifecycle?: CandidatureLifecycle | null
}

export default function CandidatureDetailPanel({
  candidature: c,
  side,
}: {
  candidature: Candidature
  side: 'freelance' | 'cdi'
}) {
  const t = useTranslations('candidatures_tracking')
  const tPub = useTranslations('publications')
  const relTime = useRelativeTime()

  // SITE DE RENDU 1/5 — le libellé d'état passe par la RAISON dérivée.
  const lifecycleLabel = useCandidatureLifecycleLabel('expert')
  const reason = c.lifecycle?.reason ?? null
  /**
   * L'ANNONCE est-elle encore consultable ?
   *
   * Deux horloges DISTINCTES, à ne jamais confondre :
   *   - la fenêtre d'ÉCHANGE (15 j)  → `exchange_expired`
   *   - la vie de l'ANNONCE (30 j)   → `publication_expired` / `_closed`
   *
   * Seule la seconde condamne « Voir la mission ». Un échange clos sur une
   * annonce toujours en ligne laisse le bouton ACTIF — griser sur `isArchived`
   * serait trop large et priverait l'expert d'une annonce parfaitement lisible.
   */
  const publicationUnavailable = c.publication?.is_available === false
  /**
   * Motif du grisage — indexé sur le FAIT, jamais sur `lifecycle.reason`.
   * `status !== 'published'` ⇒ l'org l'a retirée ; sinon les 30 j sont passés.
   * On réutilise les libellés d'état de vie (présents en 4 langues) : ils
   * décrivent exactement ces deux faits, pas besoin d'un vocabulaire de plus.
   */
  const unavailableReason: CandidatureLifecycleReason =
    c.publication?.status !== 'published' ? 'publication_closed' : 'publication_expired'
  const isSelected = c.status === 'selected'
  const isMission = c.publication?.type === 'mission'
  const isArchived = c.lifecycle?.bucket === 'archived'
  return (
    <div style={{ background: 'var(--sk-surface)', border: '1px solid var(--sk-border)', borderRadius: 'var(--sk-r-lg)', padding: '24px 26px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
      {/* Pastille d'état RETIRÉE d'ici. Le libellé apparaissait TROIS fois sur
          le même écran : sur la carte de la liste, ici, et en clôture de la
          frise. Cette occurrence-ci est le doublon pur — à quelques centimètres
          de la carte sélectionnée sur le master-detail, et redondante avec la
          frise sur la page autonome. Les deux autres ont chacune un rôle que
          celle-ci n'a pas : la carte renseigne TOUS les items pour le balayage,
          la frise CLÔT la chronologie (sans elle, elle s'arrêterait sur
          « Échange ouvert par l'entreprise » et laisserait croire l'échange
          vivant — un mensonge par omission, pire qu'une répétition). */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px', lineHeight: 1.25, color: 'var(--sk-text)' }}>
          {c.publication?.title ?? '—'}
        </div>
        <div style={{ color: 'var(--sk-muted)', fontSize: 13, marginTop: 5 }}>
          {c.publication ? tPub(`type.${c.publication.type}`) : '—'}
        </div>
      </div>

      {/* Lot état 'selected' : bandeau triomphal côté expert. */}
      {isSelected && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginTop: 16,
            background: '#FEF3C7',
            border: '1.5px solid #F59E0B',
            borderRadius: 'var(--sk-r-lg)',
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <div style={{ fontSize: 24, lineHeight: 1 }} aria-hidden>🏆</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#92400E', letterSpacing: '-0.2px' }}>
              {t(isMission ? 'selected_banner_title_mission' : 'selected_banner_title_offre')}
            </div>
            <div style={{ fontSize: 13, color: '#92400E', marginTop: 4, lineHeight: 1.55 }}>
              {t(isMission ? 'selected_banner_body_mission' : 'selected_banner_body_offre')}
            </div>
          </div>
        </div>
      )}

      {/* Lot synthèse parlante : chips publication inline. */}
      {c.publication && (
        <div style={{ marginTop: 14 }}>
          <PublicationSynthesisLine pub={c.publication} size="md" />
        </div>
      )}

      <div style={{ color: 'var(--sk-faint)', fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', margin: '24px 0 12px' }}>
        {t('section_timeline')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <TimelineStep
          icon={<IconSend size={16} />}
          label={t('timeline.sent')}
          sub={t('candidated_ago', { time: relTime(c.created_at) })}
          state="done"
        />
        {c.ai_match_score != null && (
          <TimelineStep
            icon={<IconSparkles size={16} />}
            label={t('timeline.ai_proposed', { score: Math.round(c.ai_match_score) })}
            state="done"
          />
        )}
        {(c.status === 'unlocked' || c.status === 'selected') && c.unlocked_at && (
          <TimelineStep
            icon={<IconLockOpen size={16} />}
            label={t('timeline.unlocked')}
            sub={t('unlocked_since', { time: relTime(c.unlocked_at) })}
            state="done"
            isLast={reason === 'exchange_open'}
          />
        )}
        {c.status === 'selected' && c.selected_at && (
          <TimelineStep
            icon={<IconTrophy size={16} />}
            label={t(isMission ? 'timeline.selected_mission' : 'timeline.selected_offre')}
            sub={t('selected_since', { time: relTime(c.selected_at) })}
            state="done"
            isLast
          />
        )}
        {c.status === 'rejected' && (
          <TimelineStep
            icon={<IconX size={16} />}
            label={t('timeline.rejected')}
            sub={c.status_reason ?? undefined}
            state="failed"
            isLast
          />
        )}
        {/* Dernière étape : elle aussi dérive de la RAISON. Sans ça la
            timeline continuait d'annoncer « En attente de l'entreprise » sur
            une candidature dont l'annonce a expiré depuis 30 jours. */}
        {reason === 'awaiting_review' && (
          <TimelineStep
            icon={<IconClock size={16} />}
            label={t('timeline.waiting')}
            sub={lifecycleLabel(c.lifecycle, c.publication?.type)}
            state="pending"
            isLast
          />
        )}
        {isArchived && reason !== 'rejected' && (
          <TimelineStep
            icon={<IconClock size={16} />}
            label={lifecycleLabel(c.lifecycle, c.publication?.type)}
            state="failed"
            isLast
          />
        )}
      </div>

      {c.cover_message && (
        <>
          <div style={{ color: 'var(--sk-faint)', fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', margin: '24px 0 12px' }}>
            {t('section_cover_message')}
          </div>
          <div style={{ background: 'var(--sk-surface-2)', border: '1px solid var(--sk-border-soft)', borderRadius: 'var(--sk-r-lg)', padding: '14px 16px', fontSize: 14, lineHeight: 1.6, color: 'var(--sk-text)', whiteSpace: 'pre-wrap' }}>
            {c.cover_message}
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 11, marginTop: 26, paddingTop: 20, borderTop: '1px solid var(--sk-border-soft)' }}>
        {(c.status === 'unlocked' || c.status === 'selected') && c.conversation_id && (
          <Link
            href={`/dashboard/${side}/messages/${c.conversation_id}`}
            style={{
              padding: '11px 20px', borderRadius: 11,
              background: 'var(--sk-accent)', color: '#fff',
              border: 'none', fontWeight: 600, fontSize: 14,
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
              textDecoration: 'none',
            }}
          >
            <IconMessage2 size={16} stroke={2} />
            {t('open_conversation')}
          </Link>
        )}
        {c.publication?.id && (
          publicationUnavailable ? (
            /* GRISÉ, pas retiré : l'expert doit comprendre POURQUOI le lien ne
               mène nulle part. /api/me/missions/[id] refuse volontairement une
               annonce expirée (règle 30 j du lot A) — c'est le bouton qui avait
               tort, pas la route. Le motif est le libellé DÉRIVÉ, pas une
               phrase en dur : « Cette annonce a expiré » / « … a été retirée ».
               Affiché sous le libellé plutôt qu'en infobulle : une infobulle
               n'existe pas au doigt (mobile-first).

               Le grisage suit `publication.is_available` — LE FAIT servi par le
               serveur — et NON `lifecycle.reason`, qui est un résumé
               d'affichage : sur une candidature débloquée il vaut toujours
               `exchange_*` et masque totalement l'état de l'annonce. */
            <span
              aria-disabled="true"
              style={{
                padding: '11px 20px', borderRadius: 11,
                background: 'var(--sk-surface-sunken, var(--sk-surface))',
                color: 'var(--sk-faint)',
                border: '1px dashed var(--sk-border)', fontWeight: 600, fontSize: 14,
                cursor: 'not-allowed', display: 'inline-flex',
                flexDirection: 'column', alignItems: 'flex-start', gap: 2,
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <IconExternalLink size={16} stroke={2} />
                {t('view_mission')}
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 500, lineHeight: 1.3 }}>
                {/* On passe la raison du FAIT, pas `c.lifecycle` — qui dirait
                    « Échange terminé sans suite », hors sujet pour un bouton
                    qui parle de l'ANNONCE. Le rendu reste centralisé dans
                    use-lifecycle-label, seul point de rendu des libellés
                    d'état : aucune clé n'est lue en direct ici. */}
                {lifecycleLabel(
                  { bucket: 'archived', reason: unavailableReason, until: null },
                  c.publication?.type,
                )}
              </span>
            </span>
          ) : (
            <Link
              href={`/dashboard/${side}/missions/${c.publication.id}`}
              style={{
                padding: '11px 20px', borderRadius: 11,
                background: 'var(--sk-surface)', color: 'var(--sk-text)',
                border: '1px solid var(--sk-border)', fontWeight: 600, fontSize: 14,
                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
                textDecoration: 'none',
              }}
            >
              <IconExternalLink size={16} stroke={2} />
              {t('view_mission')}
            </Link>
          )
        )}
      </div>
    </div>
  )
}
