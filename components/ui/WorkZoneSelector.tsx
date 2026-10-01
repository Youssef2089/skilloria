'use client'

import { useId, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  ajouterZone,
  continentsOf,
  countryCountOf,
  dedupeCoveredZones,
  expandToCountryCodes,
  modeDeSelection,
  normaliserRecherche,
  retirerZone,
  worldZoneOf,
  zoneCouvrante,
  type WorkZone,
} from '@/lib/work-zones'

const fontJakarta = 'var(--font-jakarta), system-ui, sans-serif'

/**
 * SÉLECTEUR DE ZONES DE TRAVAIL — où l'expert ACCEPTE de travailler, où l'annonce a besoin
 * de quelqu'un. Refait à la recette staging du 01/10/2026 (point 2).
 *
 * ┌─ LE DÉFAUT ──────────────────────────────────────────────────────────────┐
 * │ « Monde entier » était un bouton parmi les continents. Coché, il         │
 * │ absorbait tout : un clic sur « Europe » l'ajoutait puis le retirait      │
 * │ aussitôt (couvert par le monde). L'écran restait figé sur « Monde        │
 * │ entier », il fallait cliquer deux fois, et personne ne comprenait.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * LA SAISIE, prise sur les plateformes comparables (le choix et sa raison :
 * docs/reprise-s1.md) — DEUX TEMPS, chacun sans piège :
 *
 *  ① UNE QUESTION FERMÉE, aucune réponse cochée d'avance : « partout dans le
 *    monde » OU « dans certaines zones ». Le monde n'est plus jamais un bouton
 *    parmi les autres : aucun clic ne peut être absorbé en silence.
 *
 *  ② SEULEMENT SI « certaines zones » : les continents en un clic (« Europe ·
 *    46 pays » — l'étendue est dite, pas devinée), une RECHERCHE de pays (on
 *    tape « Maroc », on choisit), et la sélection montrée en étiquettes qu'une
 *    croix retire. Un pays déjà couvert par un continent choisi le dit au lieu
 *    de s'ajouter ; un continent ajouté absorbe ses pays (`dedupeCoveredZones`).
 *
 * PRÉ-SÉLECTION NON VALIDANTE (inchangé) : une zone peut être SUGGÉRÉE, elle ne
 * compte pas tant que l'utilisateur ne l'a pas confirmée — `selected` reste vide,
 * le serveur refuse toujours. Une valeur par défaut qui validerait ferait déclarer
 * une zone que personne n'a choisie.
 *
 * AUCUNE bibliothèque : boutons et champ natifs, styles en ligne, pleine largeur
 * alignée à gauche. Chaque contrôle se joue au clavier (relecture du 01/10/2026, point 13) :
 *  · la question fermée suit le motif « groupe de boutons radio » — une seule tabulation, les
 *    flèches passent d'un choix à l'autre ET le choisissent ;
 *  · la recherche suit le motif « combobox » — les flèches parcourent les pays, l'option active
 *    est annoncée (`aria-activedescendant`), Entrée choisit, Échap ferme, et la liste se FERME
 *    quand le champ perd le focus ;
 *  · une zone que le référentiel ne propose plus (désactivée) reste VISIBLE dans la sélection,
 *    nommée comme telle, avec sa croix — jamais un « 0 pays couverts » sans explication.
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

/** Combien de pays la recherche propose à la fois : assez pour choisir, assez peu pour lire. */
const SUGGESTIONS_MAX = 8

export default function WorkZoneSelector({
  zones,
  selected,
  onChange,
  suggestedZoneId = null,
  invalid = false,
}: Props) {
  const t = useTranslations('work_zones')
  const locale = useLocale()
  const idRecherche = useId()
  const idListe = useId()
  const [recherche, setRecherche] = useState('')
  const [actif, setActif] = useState(0)
  // La liste des pays n'est ouverte que tant que le champ a le focus (point 13).
  const [ouverte, setOuverte] = useState(false)
  const radios = useRef<Array<HTMLButtonElement | null>>([])
  // Le mode « certaines zones » choisi alors que rien n'est encore coché : la sélection seule
  // ne peut pas le dire (elle est vide), l'écran le retient.
  const [zonesChoisiesVides, setZonesChoisiesVides] = useState(false)

  const liste = useMemo(() => zones as WorkZone[], [zones])
  const monde = useMemo(() => worldZoneOf(liste), [liste])
  // Un continent dont aucun pays n'est proposé ne couvrirait rien : il n'est pas offert (point 13).
  const continents = useMemo(() => continentsOf(liste).filter((c) => countryCountOf(liste, c.id) > 0), [liste])
  const pays = useMemo(
    () =>
      liste
        .filter((z) => z.kind === 'country')
        .map((z) => ({ zone: z, cle: normaliserRecherche(z.name) }))
        .sort((a, b) => a.zone.name.localeCompare(b.zone.name, locale)),
    [liste, locale],
  )
  const parId = useMemo(() => new Map(liste.map((z) => [z.id, z])), [liste])

  const paysCouverts = useMemo(() => expandToCountryCodes(liste, selected), [liste, selected])
  const modeSelection = modeDeSelection(liste, selected)
  const mode = modeSelection ?? (zonesChoisiesVides ? 'zones' : null)

  const suggestion = useMemo(
    () =>
      suggestedZoneId && selected.length === 0
        ? liste.find((z) => z.id === suggestedZoneId) ?? null
        : null,
    [liste, selected.length, suggestedZoneId],
  )

  const choisirMonde = () => {
    if (!monde) return
    setZonesChoisiesVides(false)
    onChange([monde.id])
  }
  const choisirZones = () => {
    setZonesChoisiesVides(true)
    // Quitter « partout » vide la sélection : on va dire OÙ, et le monde n'en fait plus partie.
    if (modeSelection === 'monde') onChange([])
  }
  // Toute action dans « certaines zones » RETIENT ce mode : retirer la dernière étiquette ne doit
  // pas faire disparaître la saisie sous les doigts de l'utilisateur.
  const changerZones = (next: string[]) => {
    setZonesChoisiesVides(true)
    onChange(next)
  }
  const ajouter = (id: string) => changerZones(ajouterZone(liste, selected, id))
  const retirer = (id: string) => changerZones(retirerZone(selected, id))
  const basculerContinent = (id: string) => (selected.includes(id) ? retirer(id) : ajouter(id))

  const resultats = useMemo(() => {
    const q = normaliserRecherche(recherche)
    if (!q) return []
    const commence = pays.filter((p) => p.cle.startsWith(q))
    const contient = pays.filter((p) => !p.cle.startsWith(q) && p.cle.includes(q))
    return [...commence, ...contient].slice(0, SUGGESTIONS_MAX).map((p) => p.zone)
  }, [recherche, pays])

  // LE GROUPE RADIO AU CLAVIER : une tabulation pour le groupe (le choix fait, sinon le premier), les flèches
  // déplacent ET choisissent — le motif WAI-ARIA, sans bibliothèque.
  const choix = [...(monde ? [{ cle: 'monde' as const, choisir: choisirMonde }] : []), { cle: 'zones' as const, choisir: choisirZones }]
  const rangChoisi = Math.max(0, choix.findIndex((c) => c.cle === mode))
  const clavierRadio = (e: React.KeyboardEvent) => {
    const pas = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (pas === 0) return
    e.preventDefault()
    const i = (rangChoisi + pas + choix.length) % choix.length
    choix[i].choisir()
    radios.current[i]?.focus()
  }

  const listeOuverte = ouverte && resultats.length > 0
  const idOption = (i: number) => `${idListe}-option-${i}`

  const choisirPays = (z: WorkZone) => {
    if (selected.includes(z.id) || zoneCouvrante(liste, selected, z.id)) return
    ajouter(z.id)
    setRecherche('')
    setActif(0)
  }

  const styleCarte = (choisie: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    flex: '1 1 240px',
    padding: '12px 14px',
    border: `1.5px solid ${choisie ? 'var(--sk-accent)' : invalid ? 'var(--sk-red)' : 'var(--sk-border)'}`,
    borderRadius: 12,
    background: choisie ? 'color-mix(in srgb, var(--sk-accent) 6%, transparent)' : 'var(--sk-surface)',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: fontJakarta,
  })

  const styleEtiquette = (actifE: boolean): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    border: `1.5px solid ${actifE ? 'var(--sk-accent)' : 'var(--sk-border)'}`,
    borderRadius: 10,
    background: actifE ? 'color-mix(in srgb, var(--sk-accent) 6%, transparent)' : 'var(--sk-surface)',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    color: actifE ? 'var(--sk-accent)' : 'var(--sk-muted)',
    fontFamily: fontJakarta,
  })

  if (liste.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: 'var(--sk-muted)', fontFamily: fontJakarta }}>
        {t('empty')}
      </p>
    )
  }

  return (
    <div style={{ fontFamily: fontJakarta }}>
      {/* ── La suggestion, explicitement NON retenue tant qu'on ne confirme pas ── */}
      {suggestion ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            marginBottom: 12,
            border: '1px dashed var(--sk-border)',
            borderRadius: 10,
            background: 'var(--sk-surface-2)',
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--sk-muted)' }}>
            {t('suggestion_label', { zone: suggestion.name })}
          </span>
          <button
            type="button"
            onClick={() => onChange(dedupeCoveredZones(liste, [suggestion.id]))}
            style={{ ...styleEtiquette(false), padding: '6px 12px', fontSize: 12 }}
          >
            {t('suggestion_confirm')}
          </button>
          <span style={{ fontSize: 12, color: 'var(--sk-muted)' }}>{t('suggestion_not_applied')}</span>
        </div>
      ) : null}

      {/* ── ① La question fermée : partout, ou certaines zones. Rien de coché d'avance. ── */}
      <div role="radiogroup" aria-label={t('label')} onKeyDown={clavierRadio} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        {monde ? (
          <button
            type="button"
            role="radio"
            ref={(el) => { radios.current[0] = el }}
            tabIndex={rangChoisi === 0 ? 0 : -1}
            aria-checked={mode === 'monde'}
            onClick={choisirMonde}
            style={styleCarte(mode === 'monde')}
          >
            <Puce choisie={mode === 'monde'} />
            <span>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: 'var(--sk-text)' }}>{t('mode_monde')}</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--sk-muted)', marginTop: 2 }}>
                {t('mode_monde_aide', { count: countryCountOf(liste, monde.id) })}
              </span>
            </span>
          </button>
        ) : null}
        <button
          type="button"
          role="radio"
          ref={(el) => { radios.current[monde ? 1 : 0] = el }}
          tabIndex={rangChoisi === (monde ? 1 : 0) ? 0 : -1}
          aria-checked={mode === 'zones'}
          onClick={choisirZones}
          style={styleCarte(mode === 'zones')}
        >
          <Puce choisie={mode === 'zones'} />
          <span>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: 'var(--sk-text)' }}>{t('mode_zones')}</span>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--sk-muted)', marginTop: 2 }}>{t('mode_zones_aide')}</span>
          </span>
        </button>
      </div>

      {/* ── ② Seulement pour « certaines zones » : continents, recherche, sélection ── */}
      {mode === 'zones' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sk-muted)', marginBottom: 6 }}>{t('continents_label')}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {continents.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => basculerContinent(c.id)}
                  aria-pressed={selected.includes(c.id)}
                  style={styleEtiquette(selected.includes(c.id))}
                >
                  {c.name}
                  <span style={{ color: 'var(--sk-muted)', fontWeight: 400 }}>
                    · {t('country_count', { count: countryCountOf(liste, c.id) })}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ position: 'relative' }}>
            <label htmlFor={idRecherche} style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--sk-muted)', marginBottom: 6 }}>
              {t('recherche_label')}
            </label>
            <input
              id={idRecherche}
              type="text"
              role="combobox"
              aria-expanded={listeOuverte}
              aria-controls={idListe}
              aria-autocomplete="list"
              aria-activedescendant={listeOuverte && resultats[actif] ? idOption(actif) : undefined}
              autoComplete="off"
              value={recherche}
              placeholder={t('recherche_placeholder')}
              onFocus={() => setOuverte(true)}
              onBlur={() => setOuverte(false)}
              onChange={(e) => { setRecherche(e.target.value); setActif(0); setOuverte(true) }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' && resultats.length > 0) { e.preventDefault(); setOuverte(true); setActif((a) => Math.min(a + 1, resultats.length - 1)) }
                else if (e.key === 'ArrowUp' && resultats.length > 0) { e.preventDefault(); setOuverte(true); setActif((a) => Math.max(a - 1, 0)) }
                else if (e.key === 'Home' && listeOuverte) { e.preventDefault(); setActif(0) }
                else if (e.key === 'End' && listeOuverte) { e.preventDefault(); setActif(resultats.length - 1) }
                else if (e.key === 'Enter' && listeOuverte && resultats[actif]) { e.preventDefault(); choisirPays(resultats[actif]) }
                else if (e.key === 'Escape') { if (listeOuverte) setOuverte(false); else setRecherche('') }
              }}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px 12px',
                border: '1.5px solid var(--sk-border)',
                borderRadius: 10,
                background: 'var(--sk-surface)',
                color: 'var(--sk-text)',
                fontSize: 14,
                fontFamily: fontJakarta,
              }}
            />
            {normaliserRecherche(recherche) && resultats.length === 0 ? (
              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--sk-muted)' }}>{t('recherche_aucun')}</p>
            ) : null}
            {listeOuverte ? (
              <ul
                id={idListe}
                role="listbox"
                aria-label={t('recherche_label')}
                style={{
                  listStyle: 'none',
                  margin: '6px 0 0',
                  padding: 4,
                  border: '1px solid var(--sk-border)',
                  borderRadius: 10,
                  background: 'var(--sk-surface)',
                }}
              >
                {resultats.map((z, i) => {
                  const couvrante = selected.includes(z.id) ? z : zoneCouvrante(liste, selected, z.id)
                  return (
                    <li
                      key={z.id}
                      id={idOption(i)}
                      role="option"
                      aria-selected={i === actif}
                      aria-disabled={couvrante ? true : undefined}
                      onMouseDown={(e) => { e.preventDefault(); choisirPays(z) }}
                      onMouseEnter={() => setActif(i)}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 10,
                        padding: '8px 10px',
                        borderRadius: 8,
                        cursor: couvrante ? 'default' : 'pointer',
                        background: i === actif ? 'var(--sk-surface-2)' : 'transparent',
                        color: couvrante ? 'var(--sk-muted)' : 'var(--sk-text)',
                        fontSize: 14,
                      }}
                    >
                      <span>{z.name}</span>
                      {couvrante ? (
                        <span style={{ fontSize: 12 }}>
                          {couvrante.id === z.id ? t('deja_choisi') : t('deja_couvert', { zone: couvrante.name })}
                        </span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>

          {selected.length > 0 ? (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sk-muted)', marginBottom: 6 }}>{t('selection_label')}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {selected.map((id) => {
                  const z = parId.get(id)
                  // Une zone que le référentiel ne propose plus : NOMMÉE comme telle, retirable — jamais cachée.
                  if (!z) {
                    return (
                      <span key={id} style={{ ...styleEtiquette(false), cursor: 'default', borderStyle: 'dashed' }}>
                        {t('zone_retiree')}
                        <button
                          type="button"
                          onClick={() => retirer(id)}
                          aria-label={t('retirer', { zone: t('zone_retiree') })}
                          style={{ border: 'none', background: 'transparent', color: 'var(--sk-muted)', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 0 }}
                        >
                          ×
                        </button>
                      </span>
                    )
                  }
                  return (
                    <span key={id} style={{ ...styleEtiquette(true), cursor: 'default' }}>
                      {z.name}
                      <button
                        type="button"
                        onClick={() => retirer(id)}
                        aria-label={t('retirer', { zone: z.name })}
                        style={{ border: 'none', background: 'transparent', color: 'var(--sk-accent)', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 0 }}
                      >
                        ×
                      </button>
                    </span>
                  )
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Ce que la sélection recouvre, dit et non deviné ── */}
      <p
        style={{
          margin: '10px 0 0',
          fontSize: 12,
          color: paysCouverts.length === 0 ? 'var(--sk-red)' : 'var(--sk-muted)',
        }}
      >
        {/* Aucun pays couvert — rien choisi, ou seulement une zone retirée : jamais « 0 pays couverts » (point 13). */}
        {paysCouverts.length === 0
          ? t(selected.length === 0 ? 'none_selected' : 'aucun_pays_couvert')
          : t('coverage', { count: paysCouverts.length })}
      </p>
    </div>
  )
}

/** Le rond d'un choix exclusif — dessiné, pas emprunté à une bibliothèque. */
function Puce({ choisie }: { choisie: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        flexShrink: 0,
        width: 16,
        height: 16,
        marginTop: 2,
        borderRadius: '50%',
        border: `2px solid ${choisie ? 'var(--sk-accent)' : 'var(--sk-border)'}`,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {choisie ? <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--sk-accent)' }} /> : null}
    </span>
  )
}
