'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { IconCircleCheck, IconChevronDown, IconChevronUp } from '@tabler/icons-react'
import PublicationSynthesisLine, { type PublicationSynthesisData } from './PublicationSynthesisLine'

/**
 * MessageContextPanel — 3ᵉ zone de la messagerie (Lot refonte UX commit B/C,
 * enrichi SC4 du Lot synthèse parlante : la mission/offre s'affiche EN
 * ENTIER inline dans le panneau — description complète + chips de synthèse +
 * skills + indicateur "Profil débloqué". Plus de bouton "Voir la mission" :
 * tout est consultable sans quitter la messagerie).
 *
 * Composant partagé entre les 3 sides (freelance / cdi / entreprise).
 *
 * Scope strict : la conv est forcément unlocked + non expirée (RLS +
 * /api/me/conversations filtre). Aucune fuite de messagerie libre.
 */

export type MessageContextPublication = PublicationSynthesisData & {
  description: string | null
  skills_required: string[] | null
  expires_at: string | null
}

function formatDate(iso: string | null, locale: string): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

export default function MessageContextPanel({
  publication,
  side,
  locale,
}: {
  publication: MessageContextPublication | null
  side: 'freelance' | 'entreprise' | 'cdi'
  locale?: string
}) {
  const t = useTranslations('messages.context')
  const tPub = useTranslations('publications')
  const [descExpanded, setDescExpanded] = useState(false)

  if (!publication) {
    return (
      <aside style={{ background: 'var(--sk-surface)', borderLeft: '1px solid var(--sk-border)', padding: '20px 18px', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>
        <div style={{ textAlign: 'center', color: 'var(--sk-muted)', fontSize: 13 }}>
          {t('no_publication')}
        </div>
      </aside>
    )
  }

  const skills = (publication.skills_required ?? []).filter((s) => typeof s === 'string' && s.trim().length > 0)
  const expiresText = formatDate(publication.expires_at, locale ?? 'fr-FR')

  return (
    <aside style={{ background: 'var(--sk-surface)', borderLeft: '1px solid var(--sk-border)', padding: '20px 18px', overflowY: 'auto', minWidth: 0 }}>
      <div style={{ color: 'var(--sk-faint)', fontSize: 11, fontWeight: 600, letterSpacing: '0.4px', textTransform: 'uppercase', marginBottom: 12 }}>
        {t('about_label')}
      </div>

      <div style={{ border: '1px solid var(--sk-border)', borderRadius: 'var(--sk-r-lg)', padding: 18, background: 'var(--sk-surface)' }}>
        {/* Header : titre + type */}
        <div style={{ fontWeight: 700, fontSize: 17, lineHeight: 1.3, letterSpacing: '-0.2px', color: 'var(--sk-text)' }}>
          {publication.title}
        </div>
        <div style={{ color: 'var(--sk-muted)', fontSize: 12.5, marginTop: 5 }}>
          {tPub(`type.${publication.type}`)}
          {(publication.branch_label || publication.speciality_label) && (
            <> · {[publication.branch_label, publication.speciality_label].filter(Boolean).join(' · ')}</>
          )}
        </div>

        {/* Chips synthèse (budget, contrat, lieu, mode, durée, démarrage, séniorité) */}
        <div style={{ marginTop: 14 }}>
          <PublicationSynthesisLine pub={publication} size="md" />
        </div>

        {/* Description (mission/offre inline) — accordéon line-clamp 3 +
            bouton "Afficher les détails / Réduire". AUCUNE navigation. */}
        {publication.description && (() => {
          const isLong = publication.description.length > 220
          return (
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--sk-border)' }}>
              <div style={{ fontSize: 11, color: 'var(--sk-faint)', fontWeight: 600, letterSpacing: '0.3px', textTransform: 'uppercase', marginBottom: 8 }}>
                {t('description_label')}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--sk-text)',
                  lineHeight: 1.65,
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  display: '-webkit-box',
                  WebkitBoxOrient: 'vertical' as const,
                  WebkitLineClamp: descExpanded ? 'unset' : (3 as unknown as string),
                  overflow: descExpanded ? 'visible' : 'hidden',
                }}
              >
                {publication.description}
              </div>
              {isLong && (
                <button
                  type="button"
                  onClick={() => setDescExpanded((v) => !v)}
                  aria-expanded={descExpanded}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    marginTop: 8,
                    padding: '5px 0',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--sk-accent-ink)',
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    letterSpacing: '-0.1px',
                  }}
                >
                  {descExpanded ? t('show_less_details') : t('show_more_details')}
                  {descExpanded ? <IconChevronUp size={14} stroke={2} /> : <IconChevronDown size={14} stroke={2} />}
                </button>
              )}
            </div>
          )
        })()}

        {/* Compétences requises */}
        {skills.length > 0 && (
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--sk-border)' }}>
            <div style={{ fontSize: 11, color: 'var(--sk-faint)', fontWeight: 600, letterSpacing: '0.3px', textTransform: 'uppercase', marginBottom: 8 }}>
              {t('skills_label')}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {skills.map((s) => (
                <span
                  key={s}
                  style={{
                    fontSize: 11.5,
                    padding: '4px 9px',
                    borderRadius: 999,
                    background: 'var(--sk-surface-2)',
                    color: 'var(--sk-muted)',
                    border: '1px solid var(--sk-border)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Échéance (expires_at) — utile pour rappeler la fenêtre d'échange */}
        {expiresText && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--sk-border)', fontSize: 12, color: 'var(--sk-muted)' }}>
            {t('expires_at_label', { date: expiresText })}
          </div>
        )}

        {/* Indicateur RÉSERVÉ AU CÔTÉ ORGANISATION.
            Il annonçait « Profil débloqué » à l'EXPERT : une mécanique
            commerciale de déverrouillage qui décrit l'accès obtenu par
            l'entreprise, pas un état que l'expert a demandé ni sur lequel il
            peut agir. Un indicateur qui ne concerne pas celui qui le lit n'a
            pas à occuper son écran, quel que soit l'état de la conversation.
            Le panneau étant partagé par les trois côtés, c'est un rendu
            conditionnel — pas une suppression : côté org le badge dit
            « Échange ouvert », ce qui la regarde bien. */}
        {side === 'entreprise' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--sk-border)', fontSize: 13, fontWeight: 600, color: 'var(--sk-success)' }}>
            <IconCircleCheck size={16} stroke={2} />
            {t('exchange_open_org')}
          </div>
        )}
      </div>
    </aside>
  )
}
