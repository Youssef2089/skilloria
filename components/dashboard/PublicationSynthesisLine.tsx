'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { PublicationSynthesis } from '@/lib/publication-synthesis'
import {
  libelleBudget,
  libelleDuree,
  libellesModesTravail,
  libellesTempsTravail,
} from '@/lib/annonces/mise-en-forme'
import {
  IconCoin,
  IconMapPin,
  IconClock,
  IconCalendarEvent,
  IconBriefcase,
  IconHomeBolt,
  IconBuildingSkyscraper,
  IconArrowsExchange,
  IconFileCertificate,
} from '@tabler/icons-react'

/**
 * <PublicationSynthesisLine> — chips de synthèse cohérents pour les surfaces
 * cartes (MissionCard, AnnonceCard, candidature expert inline) et pour le
 * panneau messagerie. Source de vérité visuelle unique.
 *
 * Reçoit le DTO bâti par buildPublicationSynthesis(). Affiche un chip par
 * champ non-null, dans cet ordre :
 *   1. Budget (€/jour ou €/an — l'unité suit le TYPE, `budgetUnitForAnnonce`)
 *   2. Lieu
 *   3. Modes de travail (multiples ; « Hybride » porte sa répartition, §D.39)
 *   4. Temps de travail (plein, partiel)
 *   5. Durée, AVEC son unité (une offre CDI n'en a pas)
 *   6. Démarrage (date)
 *   7. Séniorité
 *   8. Label contrat (pour offre CDI : "CDI" — dérivé du type, pas de colonne)
 *
 * Les mots viennent de lib/annonces/mise-en-forme.ts : la même écriture que le détail, le suivi et l'administration.
 *
 * Aucune couleur en dur — utilise var(--sk-*) et useDomain via le parent.
 * Mobile-first : flex-wrap natif.
 */

export type PublicationSynthesisData = PublicationSynthesis

/**
 * Formate le budget d'une publication avec son unité. Source unique partagée — réutilisée par les cartes casting pour
 * un pied de carte budget cohérent avec les chips de synthèse. L'unité ET la mise en forme viennent de
 * `libelleBudget` (lib/annonces/mise-en-forme.ts) : le type de l'annonce décide de l'unité, jamais l'appelant.
 */
export function formatPublicationBudget(
  pub: Pick<PublicationSynthesisData, 'budget_min' | 'budget_max' | 'type'>,
  tPub: (cle: string) => string,
  locale: string,
): string | null {
  return libelleBudget(pub, tPub, locale)
}

function formatDate(iso: string | null, locale: string): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

export default function PublicationSynthesisLine({
  pub,
  size = 'md',
  omit = [],
}: {
  pub: PublicationSynthesisData
  /** 'sm' réduit la taille des chips pour les listes denses. */
  size?: 'sm' | 'md'
  /**
   * Clés de chips à ne pas afficher (ex. ['budget'] pour reléguer le budget
   * ailleurs). Défaut [] → comportement inchangé (pages dédiées non impactées).
   * Clés : budget | contract | work_zones | work_mode | temps_travail | duration | start | seniority.
   */
  omit?: string[]
}) {
  const tPub = useTranslations('publications')
  const tSyn = useTranslations('publications.synthesis')
  const tCrit = useTranslations('criteres')
  const locale = useLocale()

  const isCdi = pub.type === 'offre'
  // L'unité suit le TYPE (`budgetUnitForAnnonce`, dans la mise en forme) — plus jamais « offre ? an : jour » ici.
  const budgetText = libelleBudget(pub, tPub, locale)
  const startText = formatDate(pub.start_date, locale)

  // Plusieurs modes possibles : un seul chip, les modes séparés comme le reste de la ligne. L'icône dit le mode quand
  // il n'y en a qu'un.
  const modes = libellesModesTravail(pub, tCrit)
  const workModeLabel = modes.length > 0 ? modes.join(' · ') : null
  const workModeIcon = (() => {
    if (pub.work_modes.length !== 1) return <IconBriefcase size={13} stroke={1.8} />
    const key = pub.work_modes[0]
    if (key === 'remote') return <IconHomeBolt size={13} stroke={1.8} />
    if (key === 'onsite') return <IconBuildingSkyscraper size={13} stroke={1.8} />
    if (key === 'hybrid') return <IconArrowsExchange size={13} stroke={1.8} />
    return <IconBriefcase size={13} stroke={1.8} />
  })()
  const tempsLabel = (() => {
    const t = libellesTempsTravail(pub, tCrit)
    return t.length > 0 ? t.join(' · ') : null
  })()
  // Une offre CDI n'a pas de durée (contrainte publications_offre_sans_duree) : rien ne s'affiche.
  const dureeLabel = isCdi ? null : libelleDuree(pub, tCrit)

  const seniorityLabel = (() => {
    if (!pub.seniorities || pub.seniorities.length === 0) return null
    const traduire = (v: string) => {
      const key = v.toLowerCase()
      try { return tPub(`form.seniority_options.${key}` as 'form.seniority_options.junior') }
      catch { return v }
    }
    // Une mission peut viser « Confirmé OU Senior » : on affiche les deux,
    // séparés comme le reste de la ligne de synthèse.
    return pub.seniorities.map(traduire).join(' · ')
  })()

  // Contrat dérivé : 'offre' → "CDI" (pas de colonne contract_type, décision
  // produit — l'i18n cdi sert d'étiquette unique).
  const contractLabel = isCdi ? tSyn('contract_label_cdi') : null

  const chipPad = size === 'sm' ? '3px 8px' : '4px 10px'
  const chipFont = size === 'sm' ? 11 : 12
  const iconSize = size === 'sm' ? 12 : 13

  const chips: Array<{ key: string; icon: React.ReactNode; label: string }> = []
  if (budgetText) chips.push({ key: 'budget', icon: <IconCoin size={iconSize} stroke={1.8} />, label: budgetText })
  if (contractLabel) chips.push({ key: 'contract', icon: <IconFileCertificate size={iconSize} stroke={1.8} />, label: contractLabel })
  const zoneLabel = pub.work_zone_labels.length > 0
    ? [pub.work_zone_labels.join(' · '), pub.location_note].filter(Boolean).join(' — ')
    : pub.location_note
  if (zoneLabel) chips.push({ key: 'work_zones', icon: <IconMapPin size={iconSize} stroke={1.8} />, label: zoneLabel })
  if (workModeLabel) chips.push({ key: 'work_mode', icon: workModeIcon, label: workModeLabel })
  if (tempsLabel) chips.push({ key: 'temps_travail', icon: <IconBriefcase size={iconSize} stroke={1.8} />, label: tempsLabel })
  if (dureeLabel) chips.push({ key: 'duration', icon: <IconClock size={iconSize} stroke={1.8} />, label: dureeLabel })
  if (startText) chips.push({ key: 'start', icon: <IconCalendarEvent size={iconSize} stroke={1.8} />, label: startText })
  if (seniorityLabel) chips.push({ key: 'seniority', icon: <IconBriefcase size={iconSize} stroke={1.8} />, label: seniorityLabel })

  const visibleChips = omit.length > 0 ? chips.filter((c) => !omit.includes(c.key)) : chips
  if (visibleChips.length === 0) return null

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {visibleChips.map((c) => (
        <span
          key={c.key}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: chipPad,
            borderRadius: 999,
            background: 'var(--sk-surface-2)',
            color: 'var(--sk-text)',
            border: '1px solid var(--sk-border)',
            fontSize: chipFont,
            fontWeight: 500,
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ color: 'var(--sk-muted)', display: 'inline-flex' }}>{c.icon}</span>
          {c.label}
        </span>
      ))}
    </div>
  )
}
