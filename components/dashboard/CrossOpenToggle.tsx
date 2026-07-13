'use client'

/**
 * CrossOpenToggle — switch compact « ouverture croisée » des opportunités.
 *
 * Source UNIQUE de rendu partagée par les 2 dashboards (freelance ET CDI) pour
 * garantir une parité stricte. Ligne inline (largeur = contenu, pas pleine
 * largeur, pas de carte dédiée) séparée des cartes de statut par un fin
 * border-top. Le libellé seul suffit ; `hint` alimente un title/tooltip.
 *
 * Purement présentationnel : l'état + la persistance (write client-direct +
 * relance sync-matching) vivent dans la page appelante.
 */

type Props = {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  /** Description courte → title/tooltip (optionnel). */
  hint?: string
  disabled?: boolean
  /** Couleur de l'état actif (tenant-aware — domain.primaryColor). */
  accentColor?: string
}

export default function CrossOpenToggle({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
  accentColor = '#10b981',
}: Props) {
  const toggle = () => {
    if (!disabled) onChange(!checked)
  }

  return (
    <div
      style={{
        marginTop: 14,
        paddingTop: 14,
        borderTop: '1px solid #e5e7eb',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        title={hint}
        onClick={toggle}
        disabled={disabled}
        style={{
          position: 'relative',
          width: 38,
          height: 22,
          flexShrink: 0,
          padding: 0,
          border: 'none',
          borderRadius: 999,
          background: checked ? accentColor : '#cbd5e1',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          transition: 'background .18s ease',
        }}
      >
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 18 : 2,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 2px rgba(0,0,0,.2)',
            transition: 'left .18s ease',
          }}
        />
      </button>
      <span
        onClick={toggle}
        title={hint}
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: '#334155',
          cursor: disabled ? 'not-allowed' : 'pointer',
          userSelect: 'none',
        }}
      >
        {label}
      </span>
    </div>
  )
}
