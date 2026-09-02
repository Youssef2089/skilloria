'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { PublicationSynthesis } from '@/lib/publication-synthesis'
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
 *   1. Budget (TJM €/jour ou €/an dérivé du type)
 *   2. Lieu
 *   3. Mode de travail (remote / sur site / hybride)
 *   4. Durée (mission)
 *   5. Démarrage (date)
 *   6. Séniorité
 *   7. Label contrat (pour offre CDI : "CDI" — dérivé du type, pas de colonne)
 *
 * Aucune couleur en dur — utilise var(--sk-*) et useDomain via le parent.
 * Mobile-first : flex-wrap natif.
 */

export type PublicationSynthesisData = PublicationSynthesis

function formatBudget(min: number | null, max: number | null, unit: string): string | null {
  if (min == null && max == null) return null
  const fmt = (v: number) => `${Math.round(v).toLocaleString('fr-FR')} €`
  if (min != null && max != null && min !== max) return `${fmt(min)}–${fmt(max)}${unit}`
  const v = (min ?? max) as number
  return `${fmt(v)}${unit}`
}

/**
 * Formate le budget d'une publication avec son unité (€/jour ou €/an déjà
 * fournie). Source unique partagée — réutilisée par les cartes casting pour
 * un pied de carte budget cohérent avec les chips de synthèse.
 */
export function formatPublicationBudget(
  pub: Pick<PublicationSynthesisData, 'budget_min' | 'budget_max'>,
  budgetUnitLabel: string,
): string | null {
  return formatBudget(pub.budget_min, pub.budget_max, ` ${budgetUnitLabel}`)
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
   * Clés : budget | contract | location | work_mode | duration | start | seniority.
   */
  omit?: string[]
}) {
  const tPub = useTranslations('publications')
  const tSyn = useTranslations('publications.synthesis')
  const locale = useLocale()

  const isCdi = pub.type === 'offre'
  const budgetUnitLabel = isCdi ? tPub('budget_unit.year') : tPub('budget_unit.day')
  const budgetText = formatBudget(pub.budget_min, pub.budget_max, ` ${budgetUnitLabel}`)
  const startText = formatDate(pub.start_date, locale)

  const workModeLabel = (() => {
    if (!pub.work_mode) return null
    const key = pub.work_mode.toLowerCase()
    try { return tPub(`form.work_mode_options.${key}` as 'form.work_mode_options.remote') }
    catch { return pub.work_mode }
  })()
  const workModeIcon = (() => {
    if (!pub.work_mode) return <IconBriefcase size={13} stroke={1.8} />
    const key = pub.work_mode.toLowerCase()
    if (key === 'remote') return <IconHomeBolt size={13} stroke={1.8} />
    if (key === 'onsite') return <IconBuildingSkyscraper size={13} stroke={1.8} />
    if (key === 'hybrid') return <IconArrowsExchange size={13} stroke={1.8} />
    return <IconBriefcase size={13} stroke={1.8} />
  })()

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
  if (pub.duration) chips.push({ key: 'duration', icon: <IconClock size={iconSize} stroke={1.8} />, label: pub.duration })
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
          <span style={{ color: 'var(--sk-faint)', display: 'inline-flex' }}>{c.icon}</span>
          {c.label}
        </span>
      ))}
    </div>
  )
}
