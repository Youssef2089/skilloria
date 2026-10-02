'use client'

import { useTranslations } from 'next-intl'
import {
  DUREE_MAX,
  DUREE_MIN,
  JOURS_PAR_SEMAINE,
  MODES_TRAVAIL,
  TEMPS_TRAVAIL,
  UNITES_DUREE,
  type ModeTravail,
  type TempsTravail,
  type UniteDuree,
} from '@/lib/criteres/communs'

/**
 * LES CRITÈRES COMMUNS, SAISIS PAR LES MÊMES COMPOSANTS SUR LES QUATRE ÉCRANS (lot « critères des annonces »,
 * 03/10/2026, §D.39) — la validation du profil (freelance et CDI), l'annonce d'une organisation, le besoin de
 * sous-traitance. Les valeurs viennent de lib/criteres/communs.ts (la liste des contraintes de base), les mots de
 * l'espace `criteres`, dans les quatre langues. Un écran qui recopierait sa liste fait rougir `diag-criteres-communs`.
 *
 * Cases natives (le clavier et les lecteurs d'écran les connaissent), en pastilles de 44 px de haut au moins.
 */

const pastille = (actif: boolean, invalide: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 44,
  padding: '10px 14px',
  border: `1.5px solid ${actif ? 'var(--sk-accent)' : invalide ? 'var(--sk-red)' : 'var(--sk-border)'}`,
  borderRadius: 10,
  background: actif ? 'color-mix(in srgb, var(--sk-accent) 6%, transparent)' : 'var(--sk-surface)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  color: actif ? 'var(--sk-accent)' : 'var(--sk-muted)',
  boxSizing: 'border-box',
})

const champ: React.CSSProperties = {
  width: '100%',
  minHeight: 44,
  padding: '10px 12px',
  fontSize: 14,
  border: '1px solid var(--sk-border)',
  borderRadius: 10,
  fontFamily: 'inherit',
  background: 'var(--sk-surface)',
  color: 'var(--sk-text)',
  boxSizing: 'border-box',
}

function basculer<T extends string>(liste: readonly T[], ordre: readonly T[], v: T): T[] {
  const s = new Set(liste)
  if (s.has(v)) s.delete(v)
  else s.add(v)
  // L'ORDRE DE LA LISTE FERMÉE, toujours : une même sélection s'écrit de la même façon (rien ne « change » à tort).
  return ordre.filter((x) => s.has(x))
}

/** Les modes de travail — choix MULTIPLES, les valeurs de l'expert. */
export function ChoixModesTravail({
  valeur,
  onChange,
  invalide = false,
  idGroupe,
}: {
  valeur: readonly ModeTravail[]
  onChange: (next: ModeTravail[]) => void
  invalide?: boolean
  idGroupe?: string
}) {
  const t = useTranslations('criteres')
  return (
    <div role="group" aria-labelledby={idGroupe} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {MODES_TRAVAIL.map((m) => {
        const actif = valeur.includes(m)
        return (
          <label key={m} style={pastille(actif, invalide)}>
            <input
              type="checkbox"
              checked={actif}
              onChange={() => onChange(basculer(valeur, MODES_TRAVAIL, m))}
              style={{ accentColor: 'var(--sk-accent)' }}
            />
            {t(`modes_travail.${m}`)}
          </label>
        )
      })}
    </div>
  )
}

/** Temps plein ou temps partiel — un champ à part, choix multiples, les valeurs de l'expert. */
export function ChoixTempsTravail({
  valeur,
  onChange,
  invalide = false,
  idGroupe,
}: {
  valeur: readonly TempsTravail[]
  onChange: (next: TempsTravail[]) => void
  invalide?: boolean
  idGroupe?: string
}) {
  const t = useTranslations('criteres')
  return (
    <div role="group" aria-labelledby={idGroupe} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {TEMPS_TRAVAIL.map((v) => {
        const actif = valeur.includes(v)
        return (
          <label key={v} style={pastille(actif, invalide)}>
            <input
              type="checkbox"
              checked={actif}
              onChange={() => onChange(basculer(valeur, TEMPS_TRAVAIL, v))}
              style={{ accentColor: 'var(--sk-accent)' }}
            />
            {t(`temps_travail.${v}`)}
          </label>
        )
      })}
    </div>
  )
}

/** « Hybride » : combien de jours sur site, combien en télétravail, par semaine. Saisie en texte, lue par la route. */
export function RepartitionHybride({
  surSite,
  teletravail,
  onChange,
  erreur,
}: {
  surSite: string
  teletravail: string
  onChange: (next: { surSite: string; teletravail: string }) => void
  erreur?: string | null
}) {
  const t = useTranslations('criteres')
  const options = Array.from({ length: JOURS_PAR_SEMAINE - 1 }, (_, i) => String(i + 1))
  return (
    <div
      style={{
        marginTop: 10,
        padding: '12px 14px',
        border: `1px solid ${erreur ? 'var(--sk-red)' : 'var(--sk-border)'}`,
        borderRadius: 10,
        background: 'var(--sk-surface-2)',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sk-text)', marginBottom: 4 }}>{t('champs.repartition')}</div>
      <div style={{ fontSize: 12, color: 'var(--sk-muted)', marginBottom: 10 }}>{t('aides.repartition')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--sk-muted)' }}>
          {t('champs.jours_sur_site')}
          <select
            value={surSite}
            onChange={(e) => onChange({ surSite: e.target.value, teletravail })}
            aria-invalid={!!erreur}
            style={{ ...champ, marginTop: 4 }}
          >
            <option value="">{t('choisir')}</option>
            {options.map((n) => <option key={n} value={n}>{t('jours', { n: Number(n) })}</option>)}
          </select>
        </label>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--sk-muted)' }}>
          {t('champs.jours_teletravail')}
          <select
            value={teletravail}
            onChange={(e) => onChange({ surSite, teletravail: e.target.value })}
            aria-invalid={!!erreur}
            style={{ ...champ, marginTop: 4 }}
          >
            <option value="">{t('choisir')}</option>
            {options.map((n) => <option key={n} value={n}>{t('jours', { n: Number(n) })}</option>)}
          </select>
        </label>
      </div>
      {erreur ? <div role="alert" style={{ fontSize: 12, color: 'var(--sk-red)', marginTop: 6 }}>{erreur}</div> : null}
    </div>
  )
}

/** La durée d'une mission : un nombre et une unité (jours, semaines, mois, années). Jamais pour une offre CDI. */
export function ChoixDuree({
  valeur,
  unite,
  onChange,
  erreur,
}: {
  valeur: string
  unite: UniteDuree | ''
  onChange: (next: { valeur: string; unite: UniteDuree | '' }) => void
  erreur?: string | null
}) {
  const t = useTranslations('criteres')
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 1fr) minmax(140px, 2fr)', gap: 8 }}>
        <input
          type="number"
          inputMode="numeric"
          min={DUREE_MIN}
          max={DUREE_MAX}
          step={1}
          value={valeur}
          aria-label={t('champs.duree_valeur')}
          aria-invalid={!!erreur}
          onChange={(e) => onChange({ valeur: e.target.value, unite })}
          style={{ ...champ, ...(erreur ? { border: '1px solid var(--sk-red)' } : null) }}
        />
        <select
          value={unite}
          aria-label={t('champs.duree_unite')}
          aria-invalid={!!erreur}
          onChange={(e) => onChange({ valeur, unite: e.target.value as UniteDuree | '' })}
          style={{ ...champ, ...(erreur ? { border: '1px solid var(--sk-red)' } : null) }}
        >
          <option value="">{t('choisir_unite')}</option>
          {UNITES_DUREE.map((u) => <option key={u} value={u}>{t(`unites_duree.${u}`)}</option>)}
        </select>
      </div>
      {erreur ? <div role="alert" style={{ fontSize: 12, color: 'var(--sk-red)', marginTop: 4 }}>{erreur}</div> : null}
    </div>
  )
}
