'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useDomain } from '@/context/DomainContext'
import {
  buildWorkZoneTree,
  continentsOf,
  countryCountOf,
  dedupeCoveredZones,
  expandToCountryCodes,
  worldZoneOf,
  type WorkZone,
} from '@/lib/work-zones'

const fontJakarta = 'var(--font-jakarta), system-ui, sans-serif'

/**
 * SÉLECTEUR DE ZONES DE TRAVAIL — continents et pays.
 *
 * Trois exigences, et chacune répond à un défaut observé :
 *
 *  ① SAISIE RAPIDE PAR CONTINENT, en un clic. Demander à un expert de cocher
 *    46 pays pour dire « l'Europe » garantit qu'il ne le fera pas, et un champ
 *    obligatoire qu'on n'a pas envie de remplir se remplit mal. Un clic sur
 *    « Europe » suffit et couvre les 46.
 *
 *  ② PRÉ-SÉLECTION NON VALIDANTE. On peut SUGGÉRER une zone (le continent du
 *    pays de résidence, par exemple), mais elle ne compte pas tant que
 *    l'utilisateur ne l'a pas confirmée : `selected` reste vide, donc le
 *    serveur refuse toujours. Une valeur par défaut qui validerait ferait
 *    déclarer à des milliers d'experts une zone que personne n'a choisie —
 *    exactement ce que la migration a dû faire aux annonces existantes, et
 *    qu'on ne veut pas reproduire à la saisie.
 *
 *  ③ L'ÉTENDUE EST DITE, PAS DEVINÉE. « Europe · 46 pays », et un décompte
 *    total sous la sélection. Un utilisateur qui coche « Monde entier » doit
 *    voir ce que cela recouvre avant de valider.
 *
 * Cocher un continent PUIS un de ses pays ne veut rien dire de plus : la
 * sélection est dédoublonnée (`dedupeCoveredZones`), sans jamais retirer le
 * choix le plus large, qui est celui que l'utilisateur a fait explicitement.
 *
 * AUCUNE bibliothèque : cases à cocher natives, styles en ligne, pleine largeur
 * alignée gauche, repliable par continent pour rester lisible sur mobile.
 */

type Props = {
  zones: readonly WorkZone[]
  selected: readonly string[]
  onChange: (next: string[]) => void
  /**
   * Zone SUGGÉRÉE, non validante. Tant qu'elle n'est pas confirmée, elle
   * n'entre pas dans `selected` et le champ reste incomplet.
   */
  suggestedZoneId?: string | null
  invalid?: boolean
}

export default function WorkZoneSelector({
  zones,
  selected,
  onChange,
  suggestedZoneId = null,
  invalid = false,
}: Props) {
  const domain = useDomain()
  const t = useTranslations('work_zones')
  const [ouverts, setOuverts] = useState<Set<string>>(new Set())

  const liste = useMemo(() => zones as WorkZone[], [zones])
  const monde = useMemo(() => worldZoneOf(liste), [liste])
  const continents = useMemo(() => continentsOf(liste), [liste])
  const arbre = useMemo(() => buildWorkZoneTree(liste), [liste])

  const paysCouverts = useMemo(
    () => expandToCountryCodes(liste, selected),
    [liste, selected],
  )

  const suggestion = useMemo(
    () =>
      suggestedZoneId && selected.length === 0
        ? liste.find((z) => z.id === suggestedZoneId) ?? null
        : null,
    [liste, selected.length, suggestedZoneId],
  )

  const appliquer = (next: string[]) => onChange(dedupeCoveredZones(liste, next))

  const basculer = (id: string) =>
    appliquer(selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id])

  const basculerOuvert = (id: string) =>
    setOuverts((prec) => {
      const suivant = new Set(prec)
      if (suivant.has(id)) suivant.delete(id)
      else suivant.add(id)
      return suivant
    })

  const styleBouton = (actif: boolean): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    border: `1.5px solid ${actif ? domain.primaryColor : invalid ? '#dc2626' : '#e2e8f0'}`,
    borderRadius: 10,
    background: actif ? `${domain.primaryColor}10` : '#fff',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    color: actif ? domain.primaryColor : '#374151',
    fontFamily: fontJakarta,
  })

  if (liste.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: '#64748b', fontFamily: fontJakarta }}>
        {t('empty')}
      </p>
    )
  }

  return (
    <div style={{ fontFamily: fontJakarta }}>
      {/* ── ② La suggestion, explicitement NON retenue tant qu'on ne confirme pas ── */}
      {suggestion ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            marginBottom: 12,
            border: '1px dashed #cbd5e1',
            borderRadius: 10,
            background: '#f8fafc',
          }}
        >
          <span style={{ fontSize: 13, color: '#475569' }}>
            {t('suggestion_label', { zone: suggestion.name })}
          </span>
          <button
            type="button"
            onClick={() => appliquer([suggestion.id])}
            style={{ ...styleBouton(false), padding: '6px 12px', fontSize: 12 }}
          >
            {t('suggestion_confirm')}
          </button>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>{t('suggestion_not_applied')}</span>
        </div>
      ) : null}

      {/* ── ① Saisie rapide : monde entier, puis un clic par continent ── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        {monde ? (
          <button
            type="button"
            onClick={() => basculer(monde.id)}
            aria-pressed={selected.includes(monde.id)}
            style={styleBouton(selected.includes(monde.id))}
          >
            {monde.name}
          </button>
        ) : null}
        {continents.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => basculer(c.id)}
            aria-pressed={selected.includes(c.id)}
            style={styleBouton(selected.includes(c.id))}
          >
            {c.name}
            <span style={{ color: '#94a3b8', fontWeight: 400 }}>
              · {t('country_count', { count: countryCountOf(liste, c.id) })}
            </span>
          </button>
        ))}
      </div>

      {/* ── Détail par pays, replié par défaut : lisible sur mobile ── */}
      {arbre.flatMap((racine) => (racine.zone.kind === 'world' ? racine.children : [racine])).map(
        (noeud) => {
          const ouvert = ouverts.has(noeud.zone.id)
          const couvertParLeContinent = selected.includes(noeud.zone.id)
          return (
            <div key={noeud.zone.id} style={{ marginBottom: 6 }}>
              <button
                type="button"
                onClick={() => basculerOuvert(noeud.zone.id)}
                aria-expanded={ouvert}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '8px 0',
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#475569',
                  fontFamily: fontJakarta,
                  textAlign: 'left',
                }}
              >
                <span aria-hidden>{ouvert ? '▾' : '▸'}</span>
                {t('detail_by_country', { continent: noeud.zone.name })}
              </button>

              {ouvert ? (
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    flexWrap: 'wrap',
                    padding: '4px 0 10px 18px',
                  }}
                >
                  {couvertParLeContinent ? (
                    <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
                      {t('covered_by_continent', { continent: noeud.zone.name })}
                    </p>
                  ) : (
                    noeud.children.map((enfant) => {
                      const actif = selected.includes(enfant.zone.id)
                      return (
                        <label
                          key={enfant.zone.id}
                          style={{ ...styleBouton(actif), padding: '6px 10px', fontSize: 12 }}
                        >
                          <input
                            type="checkbox"
                            checked={actif}
                            onChange={() => basculer(enfant.zone.id)}
                            style={{ accentColor: domain.primaryColor }}
                          />
                          {enfant.zone.name}
                        </label>
                      )
                    })
                  )}
                </div>
              ) : null}
            </div>
          )
        },
      )}

      {/* ── ③ Ce que la sélection recouvre, dit et non deviné ── */}
      <p
        style={{
          margin: '10px 0 0',
          fontSize: 12,
          color: selected.length === 0 ? '#dc2626' : '#64748b',
        }}
      >
        {selected.length === 0
          ? t('none_selected')
          : t('coverage', { count: paysCouverts.length })}
      </p>
    </div>
  )
}
