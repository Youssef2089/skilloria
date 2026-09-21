'use client'


const fontJakarta = 'var(--font-jakarta), system-ui, sans-serif'

/**
 * Sélection MULTIPLE en pastilles cochables.
 *
 * Spécialités et séniorités deviennent multiples des deux côtés du marché : un
 * expert déclare toutes ses spécialités, une mission peut chercher « confirmé
 * OU senior ». Ce composant porte cette bascule partout, plutôt que quatre
 * réécritures du même bloc dans les deux formulaires de profil et celui
 * d'annonce.
 *
 * Reprend au mot près le motif de pastilles déjà en place pour les modes de
 * travail : un `<label>` cliquable qui enveloppe une vraie case à cocher. Ce
 * n'est pas un détail de style — c'est ce qui rend le composant utilisable au
 * clavier et annonçable par un lecteur d'écran sans une ligne d'ARIA.
 *
 * AUCUNE bibliothèque : les primitives du projet, styles en ligne, comme le
 * reste des formulaires.
 */

export type MultiSelectOption = {
  value: string
  label: string
  /** Précision discrète à droite du libellé (« 46 pays », « 12 experts »…). */
  hint?: string
  disabled?: boolean
}

type Props = {
  options: readonly MultiSelectOption[]
  selected: readonly string[]
  onChange: (next: string[]) => void
  /** Encadre en rouge : le champ manque pour publier. */
  invalid?: boolean
  /** Rendu quand il n'y a rien à proposer — jamais un vide muet. */
  emptyLabel?: string
  ariaLabel?: string
}

export default function MultiSelectChips({
  options,
  selected,
  onChange,
  invalid = false,
  emptyLabel,
  ariaLabel,
}: Props) {

  const basculer = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    )
  }

  if (options.length === 0) {
    // Un sélecteur vide sans explication laisse croire à une panne. On dit ce
    // qu'il en est, ou rien ne s'affiche du tout.
    return emptyLabel ? (
      <p style={{ margin: 0, fontSize: 13, color: 'var(--sk-muted)', fontFamily: fontJakarta }}>
        {emptyLabel}
      </p>
    ) : null
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}
    >
      {options.map((o) => {
        const actif = selected.includes(o.value)
        return (
          <label
            key={o.value}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 14px',
              border: `1.5px solid ${
                actif ? 'var(--sk-accent)' : invalid ? 'var(--sk-red)' : 'var(--sk-border)'
              }`,
              borderRadius: 10,
              background: actif ? `color-mix(in srgb, var(--sk-accent) 6%, transparent)` : 'var(--sk-surface)',
              cursor: o.disabled ? 'not-allowed' : 'pointer',
              opacity: o.disabled ? 0.5 : 1,
              fontSize: 13,
              fontWeight: 600,
              color: actif ? 'var(--sk-accent)' : 'var(--sk-muted)',
              fontFamily: fontJakarta,
            }}
          >
            <input
              type="checkbox"
              checked={actif}
              disabled={o.disabled}
              onChange={() => basculer(o.value)}
              style={{ accentColor: 'var(--sk-accent)' }}
            />
            {o.label}
            {o.hint ? (
              <span style={{ color: 'var(--sk-muted)', fontWeight: 400 }}>· {o.hint}</span>
            ) : null}
          </label>
        )
      })}
    </div>
  )
}
