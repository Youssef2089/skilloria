'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { AnnonceType } from '@/types/annonce'
import MultiSelectChips from '@/components/ui/MultiSelectChips'
import WorkZoneSelector from '@/components/ui/WorkZoneSelector'
import { ChoixDuree, ChoixModesTravail, ChoixTempsTravail, RepartitionHybride } from '@/components/criteres/ChoixCriteres'
import type { WorkZone } from '@/lib/work-zones'
import { SENIORITES, type Seniorite } from '@/lib/criteres/communs'
import { optionsSpecialites, type SpecialiteDuReferentiel } from '@/lib/criteres/specialites'
import { SPECIALITY_OTHER } from '@/lib/taxonomie/specialite-autre'
import { budgetUnitForAnnonce } from '@/lib/annonces/audience'
import type { ChampAnnonce, ValeursAnnonce } from '@/lib/annonces/formulaire'

/**
 * LES CHAMPS D'UNE ANNONCE — UN COMPOSANT, DEUX ÉCRANS (lot « critères des annonces », 03/10/2026, §D.39).
 *
 * L'annonce d'une organisation (client, cabinet, ESN — components/dashboard/PublicationForm.tsx) et le besoin de
 * sous-traitance entre experts (components/collaboration/SousTraitanceView.tsx) rendent CE composant : exactement les
 * mêmes champs (décision de Youssef). Les critères communs avec le profil de l'expert — branche, spécialités,
 * séniorités, zones, modes de travail, temps de travail — ont les MÊMES valeurs que lui (lib/criteres/communs.ts,
 * lib/criteres/specialites.ts, /api/taxonomy). `diag-criteres-communs` (BLOQUANT) compare les trois écrans.
 *
 * Contrôlé : l'état et la validation vivent dans lib/annonces/formulaire.ts ; les messages d'erreur arrivent traduits.
 * Pleine largeur : les sections occupent la largeur de la page, leurs grilles se replient d'elles-mêmes.
 */

export type ReferentielAnnonce = {
  branches: Array<{ id: string; name: string }>
  specialities: SpecialiteDuReferentiel[]
  work_zones: WorkZone[]
}

type Props = {
  type: AnnonceType
  valeurs: ValeursAnnonce
  changer: <K extends keyof ValeursAnnonce>(k: K, v: ValeursAnnonce[K]) => void
  erreurs: Partial<Record<ChampAnnonce, string>>
  referentiel: ReferentielAnnonce | null
}

const section: React.CSSProperties = {
  background: 'var(--sk-surface)',
  border: '1px solid var(--sk-border)',
  borderRadius: 14,
  padding: '22px 24px',
  marginBottom: 18,
}
const titreSection: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
  color: 'var(--sk-muted)',
  marginBottom: 14,
}
const libelle: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--sk-text)', marginBottom: 6 }
const aide: React.CSSProperties = { fontSize: 12, color: 'var(--sk-muted)', marginTop: 4 }
const erreurTexte: React.CSSProperties = { fontSize: 12, color: 'var(--sk-red)', marginTop: 4 }
const grille: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 16,
  marginBottom: 18,
}
const saisie = (invalide: boolean): React.CSSProperties => ({
  width: '100%',
  minHeight: 44,
  padding: '11px 14px',
  fontSize: 14,
  border: invalide ? '1px solid var(--sk-red)' : '1px solid var(--sk-border)',
  borderRadius: 8,
  outline: 'none',
  fontFamily: 'inherit',
  background: 'var(--sk-surface)',
  color: 'var(--sk-text)',
  boxSizing: 'border-box',
})

export default function ChampsAnnonce({ type, valeurs: v, changer, erreurs, referentiel }: Props) {
  const tPub = useTranslations('publications')
  const t = useTranslations('criteres')
  const [competence, setCompetence] = useState('')

  const ajouterCompetence = () => {
    const c = competence.trim()
    if (!c) return
    if (!v.skills_required.includes(c) && v.skills_required.length < 50) changer('skills_required', [...v.skills_required, c])
    setCompetence('')
  }

  const options = optionsSpecialites(referentiel?.specialities ?? [], v.branch_id, tPub('form.field_speciality_other_option'))
  const hybride = v.work_modes.includes('hybrid')

  return (
    <>
      {/* ── L'ESSENTIEL ─────────────────────────────────────────────────────────── */}
      <div style={section}>
        <div style={titreSection}>{tPub('form.section_essentials')}</div>
        <label htmlFor="sk-annonce-titre" style={libelle}>{tPub('form.field_title')} *</label>
        <input
          id="sk-annonce-titre"
          type="text"
          value={v.title}
          onChange={(e) => changer('title', e.target.value)}
          placeholder={tPub('form.field_title_placeholder')}
          maxLength={200}
          aria-invalid={!!erreurs.title}
          style={saisie(!!erreurs.title)}
        />
        {erreurs.title ? <div style={erreurTexte}>{erreurs.title}</div> : null}

        <label htmlFor="sk-annonce-description" style={{ ...libelle, marginTop: 18 }}>{tPub('form.field_description')} *</label>
        <textarea
          id="sk-annonce-description"
          value={v.description}
          onChange={(e) => changer('description', e.target.value)}
          placeholder={tPub('form.field_description_placeholder')}
          maxLength={10_000}
          rows={8}
          aria-invalid={!!erreurs.description}
          style={{ ...saisie(!!erreurs.description), resize: 'vertical', lineHeight: 1.55 }}
        />
        {erreurs.description ? <div style={erreurTexte}>{erreurs.description}</div> : null}
        <div style={aide}>{tPub('form.field_description_help')}</div>
      </div>

      {/* ── QUI VOUS CHERCHEZ — les critères qui filtrent la mise en relation ─────── */}
      <div style={section}>
        <div style={titreSection}>{t('sections.criteres')}</div>
        <div style={aide}>{t('aides.criteres')}</div>

        <div style={{ ...grille, marginTop: 14 }}>
          <div>
            <label htmlFor="sk-annonce-branche" style={libelle}>{tPub('form.field_branch')} *</label>
            <select
              id="sk-annonce-branche"
              value={v.branch_id}
              onChange={(e) => changer('branch_id', e.target.value)}
              disabled={!referentiel}
              aria-invalid={!!erreurs.branch_id}
              style={saisie(!!erreurs.branch_id)}
            >
              <option value="">{tPub('form.field_branch_placeholder')}</option>
              {(referentiel?.branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {erreurs.branch_id ? <div style={erreurTexte}>{erreurs.branch_id}</div> : null}
          </div>
          <div>
            {/* AU MOINS UNE SPÉCIALITÉ (décision de Youssef, 03/10/2026) — les valeurs de l'expert, filtrées par branche. */}
            <span style={libelle}>{t('champs.specialites')} *</span>
            <MultiSelectChips
              ariaLabel={t('champs.specialites')}
              options={options}
              selected={v.speciality_ids}
              onChange={(next) => {
                changer('speciality_ids', next)
                if (!next.includes(SPECIALITY_OTHER)) changer('speciality_other', '')
              }}
              invalid={!!erreurs.speciality_ids}
              emptyLabel={
                !v.branch_id
                  ? tPub('form.field_speciality_select_branch_first')
                  : options.length <= 1
                    ? tPub('form.field_speciality_none_in_branch')
                    : tPub('form.field_speciality_placeholder')
              }
            />
            {erreurs.speciality_ids ? <div style={erreurTexte}>{erreurs.speciality_ids}</div> : null}
            {v.speciality_ids.includes(SPECIALITY_OTHER) && (
              <div style={{ marginTop: 10 }}>
                <label htmlFor="sk-annonce-autre" style={libelle}>{tPub('form.field_speciality_other_label')} *</label>
                <input
                  id="sk-annonce-autre"
                  type="text"
                  value={v.speciality_other}
                  onChange={(e) => changer('speciality_other', e.target.value)}
                  maxLength={100}
                  placeholder={tPub('form.field_speciality_other_placeholder')}
                  aria-invalid={!!erreurs.speciality_other}
                  style={saisie(!!erreurs.speciality_other)}
                />
                {erreurs.speciality_other ? <div style={erreurTexte}>{erreurs.speciality_other}</div> : null}
              </div>
            )}
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <span style={libelle}>{tPub('form.field_seniority')}</span>
          <MultiSelectChips
            ariaLabel={tPub('form.field_seniority')}
            options={SENIORITES.map((s) => ({ value: s, label: tPub(`form.seniority_options.${s}`) }))}
            selected={v.seniorities}
            onChange={(next) => changer('seniorities', next as Seniorite[])}
            emptyLabel={tPub('form.option_not_specified')}
          />
        </div>

        <div style={{ marginBottom: 18 }}>
          <span style={libelle}>{tPub('form.field_work_zones')} *</span>
          <div style={{ ...aide, marginTop: 0, marginBottom: 8 }}>{tPub('form.field_work_zones_help')}</div>
          <WorkZoneSelector
            zones={referentiel?.work_zones ?? []}
            selected={v.work_zone_ids}
            onChange={(next) => changer('work_zone_ids', next)}
            invalid={!!erreurs.work_zone_ids}
          />
          {erreurs.work_zone_ids ? <div style={erreurTexte}>{erreurs.work_zone_ids}</div> : null}
        </div>

        <label htmlFor="sk-annonce-competence" style={libelle}>{tPub('form.field_skills')}</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <input
            id="sk-annonce-competence"
            type="text"
            value={competence}
            onChange={(e) => setCompetence(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ajouterCompetence() } }}
            placeholder={tPub('form.field_skills_placeholder')}
            maxLength={100}
            style={{ ...saisie(false), flex: '1 1 240px', width: 'auto' }}
          />
          <button
            type="button"
            onClick={ajouterCompetence}
            style={{ minHeight: 44, padding: '0 18px', background: 'var(--sk-accent)', color: 'var(--sk-sur-accent)', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {tPub('form.field_skills_add')}
          </button>
        </div>
        {v.skills_required.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {v.skills_required.map((c) => (
              <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--sk-surface-2)', color: 'var(--sk-text)', padding: '4px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500 }}>
                {c}
                <button
                  type="button"
                  onClick={() => changer('skills_required', v.skills_required.filter((x) => x !== c))}
                  aria-label={tPub('form.field_skills_remove_aria', { skill: c })}
                  style={{ background: 'transparent', border: 'none', color: 'var(--sk-muted)', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}
                >×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── LES CONDITIONS — décrites, elles ne filtrent pas la mise en relation ─────── */}
      <div style={section}>
        <div style={titreSection}>{t('sections.conditions')}</div>

        <div style={{ marginBottom: 18 }}>
          <span id="sk-annonce-modes" style={libelle}>{tPub('form.field_work_mode')}</span>
          <ChoixModesTravail
            idGroupe="sk-annonce-modes"
            valeur={v.work_modes}
            onChange={(next) => {
              changer('work_modes', next)
              if (!next.includes('hybrid')) { changer('jours_sur_site', ''); changer('jours_teletravail', '') }
            }}
          />
          {hybride && (
            <RepartitionHybride
              surSite={v.jours_sur_site}
              teletravail={v.jours_teletravail}
              onChange={({ surSite, teletravail }) => { changer('jours_sur_site', surSite); changer('jours_teletravail', teletravail) }}
              erreur={erreurs.repartition_hybride ?? null}
            />
          )}
        </div>

        <div style={{ marginBottom: 18 }}>
          <span id="sk-annonce-temps" style={libelle}>{t('champs.temps_travail')}</span>
          <ChoixTempsTravail idGroupe="sk-annonce-temps" valeur={v.temps_travail} onChange={(next) => changer('temps_travail', next)} />
        </div>

        <div style={grille}>
          {/* UNE OFFRE CDI N'A PAS DE DURÉE (décision de Youssef, 03/10/2026). */}
          {type !== 'offre' && (
            <div>
              <span style={libelle}>{tPub('form.field_duration')}</span>
              <ChoixDuree
                valeur={v.duree_valeur}
                unite={v.duree_unite}
                onChange={({ valeur, unite }) => { changer('duree_valeur', valeur); changer('duree_unite', unite) }}
                erreur={erreurs.duree ?? null}
              />
            </div>
          )}
          <div>
            <label htmlFor="sk-annonce-debut" style={libelle}>{tPub('form.field_start_date')}</label>
            <input
              id="sk-annonce-debut"
              type="date"
              value={v.start_date}
              onChange={(e) => changer('start_date', e.target.value)}
              aria-invalid={!!erreurs.start_date}
              style={saisie(!!erreurs.start_date)}
            />
            {erreurs.start_date ? <div style={erreurTexte}>{erreurs.start_date}</div> : null}
          </div>
          <div>
            {/* Le champ libre DIT qu'il ne sert pas à la mise en relation : ce sont les zones qui la décident. */}
            <label htmlFor="sk-annonce-precision" style={libelle}>{tPub('form.field_location_note')}</label>
            <input
              id="sk-annonce-precision"
              type="text"
              value={v.location_note}
              onChange={(e) => changer('location_note', e.target.value)}
              placeholder={tPub('form.field_location_note_placeholder')}
              style={saisie(false)}
            />
            <div style={aide}>{tPub('form.field_location_note_help')}</div>
          </div>
        </div>

        <div style={{ ...grille, marginBottom: 0 }}>
          <div>
            <label htmlFor="sk-annonce-bmin" style={libelle}>{tPub('form.field_budget_min')}</label>
            <input
              id="sk-annonce-bmin"
              type="number"
              inputMode="numeric"
              min={0}
              value={v.budget_min}
              onChange={(e) => changer('budget_min', e.target.value)}
              aria-invalid={!!erreurs.budget_min}
              style={saisie(!!erreurs.budget_min)}
            />
            {erreurs.budget_min ? <div style={erreurTexte}>{erreurs.budget_min}</div> : null}
          </div>
          <div>
            <label htmlFor="sk-annonce-bmax" style={libelle}>{tPub('form.field_budget_max')}</label>
            <input
              id="sk-annonce-bmax"
              type="number"
              inputMode="numeric"
              min={0}
              value={v.budget_max}
              onChange={(e) => changer('budget_max', e.target.value)}
              aria-invalid={!!erreurs.budget_max}
              style={saisie(!!erreurs.budget_max)}
            />
            {erreurs.budget_max ? <div style={erreurTexte}>{erreurs.budget_max}</div> : null}
          </div>
        </div>
        {/* L'unité suit le TYPE d'annonce (budgetUnitForAnnonce) : salaire annuel pour une offre CDI, tarif journalier sinon. */}
        <div style={{ ...aide, marginTop: 6 }}>
          {budgetUnitForAnnonce(type) === 'year' ? tPub('form.field_budget_help_offre') : tPub('form.field_budget_help_mission')}
        </div>
      </div>

      {/* ── AVANCÉ ──────────────────────────────────────────────────────────────── */}
      <div style={section}>
        <div style={titreSection}>{tPub('form.section_advanced')}</div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer', marginBottom: 14 }}>
          <input
            type="checkbox"
            checked={v.confidential}
            onChange={(e) => changer('confidential', e.target.checked)}
            style={{ marginTop: 3, accentColor: 'var(--sk-accent)' }}
          />
          <span style={{ fontSize: 13, color: 'var(--sk-text)', lineHeight: 1.55 }}>
            <strong>{tPub('form.field_confidential')}</strong>
            <span style={{ display: 'block', color: 'var(--sk-muted)', marginTop: 4 }}>{tPub('form.field_confidential_help')}</span>
          </span>
        </label>
        <div style={{ fontSize: 12, color: 'var(--sk-muted)', lineHeight: 1.5 }}>{tPub('form.completion_hint')}</div>
      </div>
    </>
  )
}
