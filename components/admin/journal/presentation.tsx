'use client'

import type { CSSProperties } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import StatusPill, { type StatusPillKind } from '@/components/ui/StatusPill'
import type { LigneJournal } from '@/lib/journal/lecture'

/**
 * L'AFFICHAGE D'UNE ÉCRITURE DU GRAND LIVRE — partagé par la liste
 * (/admin/journal) et la pièce (/admin/journal/[piece]). Une seule façon de
 * dire qui, quoi, combien : deux écrans qui divergent finissent par ne plus
 * dire la même chose (§E.20).
 *
 * ⚠️ AUCUNE COULEUR LITTÉRALE (§D.12) : jetons `--sk-*` et `StatusPill`.
 * ⚠️ L'IDENTIFIANT DE LIGNE N'EST JAMAIS AFFICHÉ (il a des trous normaux) ; la
 *    pièce, oui — c'est elle qui relie.
 */

export type Ligne = Omit<LigneJournal, 'curseur_id'> & { curseur_id?: number }

/** Réussi / échoué / refusé — la pastille partagée, jamais une couleur posée ici. */
export function PastilleStatut({ statut }: { statut: Ligne['statut'] }) {
  const t = useTranslations('journal.statuts')
  const kind: StatusPillKind = statut === 'reussi' ? 'open' : statut === 'refuse' ? 'wait' : 'refused'
  return <StatusPill kind={kind} size="sm">{t(statut)}</StatusPill>
}

/** Qui a agi : le nom rejoint à la lecture, « compte supprimé », ou le système. */
export function Acteur({ ligne, lien = true }: { ligne: Ligne; lien?: boolean }) {
  const t = useTranslations('admin_back_office.journal')
  const tActeur = useTranslations('journal.acteurs')
  if (!ligne.acteur_id) return <span style={{ color: 'var(--sk-muted)' }}>{t('acteur_systeme')}</span>
  const type = ligne.acteur_type ? tActeur(ligne.acteur_type as 'admin') : null
  if (ligne.acteur_supprime) {
    return (
      <span style={{ color: 'var(--sk-muted)' }}>
        {t('acteur_supprime')}{type ? ` · ${type}` : ''}
      </span>
    )
  }
  const nom = ligne.acteur_nom ?? t('acteur_sans_nom')
  return (
    <span>
      {lien ? (
        <Link href={`/admin/utilisateurs/${ligne.acteur_id}`} style={{ color: 'var(--sk-accent)' }}>{nom}</Link>
      ) : nom}
      {type ? <span style={{ color: 'var(--sk-muted)' }}>{` · ${type}`}</span> : null}
    </span>
  )
}

/**
 * Le lien vers l'OBJET d'une écriture, quand un écran d'administration le montre.
 * Un objet sans écran (une candidature, un message, un match) n'a pas de lien —
 * on n'invente pas une destination qui rendrait un 404 (§E.32).
 */
export function lienObjet(l: Ligne): string | null {
  const d = l.detail ?? {}
  switch (l.sujet_type) {
    case 'users': return l.sujet_id ? `/admin/utilisateurs/${l.sujet_id}` : null
    case 'organizations': return l.sujet_id ? `/admin/organisations/${l.sujet_id}` : null
    case 'profiles': return l.sujet_id ? `/admin/experts/${l.sujet_id}` : null
    case 'branches': return l.sujet_id ? `/admin/taxonomie/${l.sujet_id}` : null
    case 'specialities': return typeof d.branch_id === 'string' ? `/admin/taxonomie/${d.branch_id}` : '/admin/taxonomie'
    case 'domains': return '/admin/ecosystemes'
    case 'packages': return l.sujet_id ? `/admin/packages/${l.sujet_id}` : null
    case 'stripe_events': return '/admin/facturation'
    case 'cron_job': return typeof d.tache === 'string' ? `/admin/taches-planifiees/${encodeURIComponent(d.tache)}` : '/admin/taches-planifiees'
    default: return null
  }
}

/** Ce que l'écriture a coûté (IA, en $) ou encaissé (commerce, dans SA devise). */
export function Montant({ ligne }: { ligne: Ligne }) {
  const t = useTranslations('admin_back_office.journal')
  const locale = useLocale()
  if (ligne.cout_usd != null) {
    const montant = new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(Number(ligne.cout_usd))
    return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{t('cout_ia', { montant, unite: ligne.unite_facturee ?? '' })}</span>
  }
  const d = ligne.detail ?? {}
  if (ligne.type_action === 'paiement_recu' && d.montant != null && typeof d.devise === 'string') {
    // Une devise que le navigateur ne connaît pas s'affiche telle quelle — jamais une erreur d'écran.
    let texte: string
    try {
      texte = new Intl.NumberFormat(locale, { style: 'currency', currency: d.devise.toUpperCase() }).format(Number(d.montant))
    } catch {
      texte = `${String(d.montant)} ${d.devise}`
    }
    return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{texte}</span>
  }
  return null
}

/**
 * LE DÉTAIL D'UNE ÉCRITURE, LISIBLE (recette staging, 30/09/2026).
 *
 * Deux écritures d'un même geste se distinguaient par leur détail — que l'écran ne
 * montrait pas (liste) ou vidait en JSON brut (pièce). « Compte créé » et « Inscription
 * d'un expert » semblaient identiques. Le détail est désormais rendu clé par clé : la clé
 * est un CODE du grand livre (liste blanche, §D.26 — les codes restent en français), la
 * valeur est formatée ; un identifiant long est raccourci, jamais un texte n'est inventé.
 */
type Valeur = unknown
function formater(v: Valeur, oui: string, non: string, locale: string): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? oui : non
  if (typeof v === 'number') return new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(v)
  if (typeof v === 'string') return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v) ? `${v.slice(0, 8)}…` : v
  if (Array.isArray(v)) return v.length === 0 ? '—' : v.map((x) => formater(x, oui, non, locale)).join(', ')
  return JSON.stringify(v)
}

const monoCle: CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, color: 'var(--sk-muted)' }

/** Le détail complet, clé par clé — la pièce. */
export function DetailEcriture({ detail }: { detail: Ligne['detail'] }) {
  const t = useTranslations('admin_back_office.journal')
  const locale = useLocale()
  const entrees = Object.entries(detail ?? {})
  if (entrees.length === 0) return <p style={{ fontSize: 13, color: 'var(--sk-muted)', margin: 0 }}>{t('detail_vide')}</p>
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, max-content) 1fr', gap: '6px 16px', margin: 0 }}>
      {entrees.map(([cle, valeur]) => (
        <div key={cle} style={{ display: 'contents' }}>
          <dt style={monoCle}>{cle}</dt>
          <dd style={{ margin: 0, fontSize: 13, color: 'var(--sk-text)', overflowWrap: 'anywhere' }} title={typeof valeur === 'string' ? valeur : undefined}>
            {formater(valeur, t('oui'), t('non'), locale)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Le résumé, sur une ligne — la liste et la colonne de la pièce : l'objet, puis les premiers détails. */
export function ResumeEcriture({ ligne, max = 4 }: { ligne: Ligne; max?: number }) {
  const t = useTranslations('admin_back_office.journal')
  const locale = useLocale()
  const entrees = Object.entries(ligne.detail ?? {})
  const vus = entrees.slice(0, max)
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', fontSize: 12, color: 'var(--sk-muted)' }}>
      {ligne.sujet_type && <span style={monoCle}>{t('resume_objet', { objet: ligne.sujet_type })}</span>}
      {vus.map(([cle, valeur]) => (
        <span key={cle}>
          <span style={monoCle}>{cle}</span> {formater(valeur, t('oui'), t('non'), locale)}
        </span>
      ))}
      {entrees.length > vus.length && <span>{t('resume_plus', { n: entrees.length - vus.length })}</span>}
    </span>
  )
}

/** La date et l'heure, dans la langue de l'administrateur. */
export function Quand({ iso }: { iso: string }) {
  const locale = useLocale()
  return (
    <time dateTime={iso} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(iso))}
    </time>
  )
}
