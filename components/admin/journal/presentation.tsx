'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import StatusPill, { type StatusPillKind } from '@/components/ui/StatusPill'
import type { LigneJournal } from '@/lib/journal/lecture'
import { phraseLisible, quiLisible, type NomsJournal, type Traducteur } from '@/lib/journal/phrase'

/**
 * L'AFFICHAGE D'UNE ÉCRITURE DU GRAND LIVRE — partagé par la liste
 * (/admin/journal) et les écritures liées (/admin/journal/[piece]). Une seule façon de
 * dire qui, quoi, combien : deux écrans qui divergent finissent par ne plus
 * dire la même chose (§E.20).
 *
 * CHAQUE ÉCRITURE SE LIT COMME UNE PHRASE (décision de Youssef, 01/10/2026, ARRÊT 22, §D.33) : `PhraseEcriture`
 * rend `lib/journal/phrase.ts` — qui, quoi, sur quoi (nommé), le résultat — dans la langue de l'écran. Plus aucune
 * clé ni aucun code à l'écran : l'ancien détail « clé par clé » (DetailEcriture, ResumeEcriture) a disparu.
 * « Qui » se dit UNE fois : le nom, ou « La plateforme », « Une tâche automatique » — jamais « Système Système »
 * (l'acteur absent ET l'origine, côte à côte).
 *
 * ⚠️ AUCUNE COULEUR LITTÉRALE (§D.12) : jetons `--sk-*` et `StatusPill`.
 * ⚠️ L'IDENTIFIANT DE LIGNE N'EST JAMAIS AFFICHÉ (il a des trous normaux).
 */

export type Ligne = Omit<LigneJournal, 'curseur_id'> & { curseur_id?: number }

/** Le traducteur des phrases : l'espace `journal`, et sa question « cette clé existe-t-elle ? ». */
function useTraducteur(): Traducteur {
  const t = useTranslations('journal')
  return {
    t: (cle, valeurs) => t(cle as 'statuts.reussi', valeurs),
    has: (cle) => t.has(cle as 'statuts.reussi'),
  }
}

/** LA PHRASE d'une écriture — ce que la personne lit d'abord. */
export function PhraseEcriture({ ligne, noms, nomsDisponibles }: { ligne: Ligne; noms: NomsJournal; nomsDisponibles: boolean }) {
  const tr = useTraducteur()
  const locale = useLocale()
  return <>{phraseLisible({ ligne, noms, nomsDisponibles, locale, tr })}</>
}

/** Réussi / échoué / refusé — la pastille partagée, jamais une couleur posée ici. */
export function PastilleStatut({ statut }: { statut: Ligne['statut'] }) {
  const t = useTranslations('journal.statuts')
  const kind: StatusPillKind = statut === 'reussi' ? 'open' : statut === 'refuse' ? 'wait' : 'refused'
  return <StatusPill kind={kind} size="sm">{t(statut)}</StatusPill>
}

/** Qui a agi : le nom (avec un lien vers son compte), « Un compte supprimé », ou la plateforme — une fois. */
export function Acteur({ ligne, lien = true }: { ligne: Ligne; lien?: boolean }) {
  const tr = useTraducteur()
  const tActeur = useTranslations('journal.acteurs')
  const nom = quiLisible(ligne, tr)
  if (!ligne.acteur_id || ligne.acteur_supprime) return <span style={{ color: 'var(--sk-muted)' }}>{nom}</span>
  const type = ligne.acteur_type && tActeur.has(ligne.acteur_type as 'admin') ? tActeur(ligne.acteur_type as 'admin') : null
  return (
    <span>
      {lien ? <Link href={`/admin/utilisateurs/${ligne.acteur_id}`} style={{ color: 'var(--sk-accent)' }}>{nom}</Link> : nom}
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
    const montant = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(Number(ligne.cout_usd))
    // §D.24 : un coût calculé au minimum facturable (le fournisseur n'a pas dit ses unités) est ESTIMÉ, et le dit.
    const estime = (ligne.detail ?? {}).unites_source === 'plancher'
    return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{t(estime ? 'cout_ia_estime' : 'cout_ia', { montant })}</span>
  }
  const d = ligne.detail ?? {}
  if (ligne.type_action === 'paiement_recu' && d.montant != null && typeof d.devise === 'string') {
    // Une devise que le navigateur ne connaît pas s'affiche en nombre — jamais une erreur d'écran.
    let texte: string
    try {
      texte = new Intl.NumberFormat(locale, { style: 'currency', currency: d.devise.toUpperCase() }).format(Number(d.montant))
    } catch {
      texte = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Number(d.montant))
    }
    return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{texte}</span>
  }
  return null
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

/** LES MOTS DU JOURNAL, expliqués — un mot propre à la plateforme ne s'affiche jamais sans son explication. */
export function Glossaire() {
  const t = useTranslations('journal.glossaire')
  const mots = ['ecriture', 'geste', 'famille', 'ecosysteme'] as const
  return (
    <details style={{ fontSize: 13, color: 'var(--sk-text)', background: 'var(--sk-surface)', border: '1px solid var(--sk-border)', borderRadius: 12, padding: '10px 14px' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{t('titre')}</summary>
      <dl style={{ margin: '10px 0 0', display: 'grid', gap: 8 }}>
        {mots.map((m) => (
          <div key={m}>
            <dt style={{ fontWeight: 600 }}>{t(`${m}.mot`)}</dt>
            <dd style={{ margin: '2px 0 0', color: 'var(--sk-muted)' }}>{t(`${m}.explication`)}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
