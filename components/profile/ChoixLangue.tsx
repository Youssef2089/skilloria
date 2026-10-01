'use client'

import { useLocale, useTranslations } from 'next-intl'
import { NIVEAUX_LANGUE, nomDeLangue, type LangueProposee } from '@/lib/profil/langues'

/**
 * LE CHOIX D'UNE LANGUE ET DE SON NIVEAU — une LISTE FERMÉE, jamais une saisie libre
 * (recette staging du 01/10/2026, point 3 ; décision de Youssef). Partagé par les deux
 * écrans de validation, freelance et CDI : deux copies divergeraient (§E.20).
 *
 *  · la langue se choisit dans la liste servie par /api/taxonomy (table `langues`), nommée
 *    dans la langue de l'écran ; une langue déjà choisie sur une autre ligne n'est pas
 *    proposée deux fois ;
 *  · AUCUN niveau n'est choisi d'office : « Choisir le niveau » tant que l'expert n'a rien dit ;
 *  · une ligne HÉRITÉE (texte libre d'avant la liste fermée, qu'aucun code ne reconnaît) est
 *    montrée avec la demande de la choisir dans la liste — elle n'est jamais effacée en silence.
 *    Un CODE hors de la liste (« la ») est NOMMÉ dans la langue de l'écran (« Latin »), jamais
 *    montré brut (relecture du 01/10/2026, point 12) ; un texte libre l'est tel qu'il est écrit.
 */
export function ChoixLangue({
  valeur,
  langues,
  dejaChoisies,
  onChange,
  style,
}: {
  valeur: string
  langues: readonly LangueProposee[]
  /** Les codes choisis sur les AUTRES lignes. */
  dejaChoisies: ReadonlySet<string>
  onChange: (code: string) => void
  style: React.CSSProperties
}) {
  const t = useTranslations('langues')
  const locale = useLocale()
  const connue = langues.some((l) => l.code === valeur)
  const heritee = valeur.trim() !== '' && !connue
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <select
        aria-label={t('choisir_langue')}
        value={connue ? valeur : ''}
        onChange={(e) => onChange(e.target.value)}
        style={style}
      >
        <option value="" disabled>
          {t('choisir_langue')}
        </option>
        {langues.map((l) => (
          <option key={l.code} value={l.code} disabled={dejaChoisies.has(l.code)}>
            {l.nom}
          </option>
        ))}
      </select>
      {heritee ? (
        <span role="note" style={{ fontSize: 12, color: 'var(--sk-amber)' }}>
          {t('heritee', { valeur: nomDeLangue(valeur, locale) })}
        </span>
      ) : null}
    </div>
  )
}

export function ChoixNiveauLangue({
  valeur,
  libelles,
  onChange,
  style,
}: {
  valeur: string
  /** Les libellés du CECR de l'écran (« B2 — Avancé »…). */
  libelles: Readonly<Record<string, string>>
  onChange: (niveau: string) => void
  style: React.CSSProperties
}) {
  const t = useTranslations('langues')
  return (
    <select aria-label={t('choisir_niveau')} value={valeur} onChange={(e) => onChange(e.target.value)} style={style}>
      <option value="" disabled>
        {t('choisir_niveau')}
      </option>
      {NIVEAUX_LANGUE.map((n) => (
        <option key={n} value={n}>
          {libelles[n] ?? n}
        </option>
      ))}
    </select>
  )
}
