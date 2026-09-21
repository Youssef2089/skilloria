'use client'

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ UN NUMÉRO DE SECTION EST UN REPÈRE. CE N'EST PAS UN ÉTAT.                ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ┌─ LE DÉFAUT QU'ON FERME, ET IL ÉTAIT EN QUATRE EXEMPLAIRES ──────────────┐
 * │ Les quatre pages de profil portaient CHACUNE sa copie de ce composant,  │
 * │ et CHACUNE sa table de couleurs — sous trois noms différents            │
 * │ (`SECTION_PALETTE`, `SECTION_COLORS`, `SECTION_COLORS`).                │
 * │                                                                         │
 * │ Ces tables peignaient les numéros en VERT, en AMBRE et en ROUGE :       │
 * │                                                                         │
 * │   · freelance/mon-profil  → missions en ROUGE, langues en AMBRE,        │
 * │                             disponibilité en VERT                       │
 * │   · cdi/mon-profil        → deux VERTS, un AMBRE, un ROUGE sur douze    │
 * │   · freelance/…/valider   → coordonnées en AMBRE, missions en ROUGE     │
 * │   · cdi/…/valider         → trois AMBRE, un VERT, un ROUGE              │
 * │                                                                         │
 * │ Or §D.12 réserve ces trois couleurs à un ÉTAT : « les rendre réglables  │
 * │ inviterait à peindre une erreur en vert ». Un formulaire dont la        │
 * │ section 5 est rouge dit à celui qui le remplit qu'il s'y est trompé.    │
 * │ Elle ne disait rien du tout : le rouge y était décoratif.               │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ LA PARADE N'EST PAS UNE CONSIGNE, C'EST L'ABSENCE DU CHAMP.
 *    Ce composant N'ACCEPTE PAS de couleur. Le numéro prend l'accent de
 *    l'écosystème, toujours. On ne peut donc plus y remettre un état sans
 *    rouvrir CE fichier — et il n'y a plus qu'un fichier (§E.31).
 *
 * Et il n'y en a plus qu'UN pour les quatre écrans : quatre jumeaux dérivent,
 * et le quatrième se lit comme corrigé quand on a corrigé le premier (§E.20).
 */

export default function SectionHeader({
  n,
  title,
  action,
}: {
  /** Le rang de la section. `number` côté « mon profil », `string` côté saisie. */
  n: number | string
  title: React.ReactNode
  /** Le bouton « Ajouter » des sections en liste — deux des quatre écrans. */
  action?: React.ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 28,
          height: 28,
          padding: '0 9px',
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 800,
          color: 'var(--sk-sur-accent)',
          background: 'var(--sk-accent)',
          fontFamily: 'var(--font-jakarta), system-ui, sans-serif',
          flexShrink: 0,
        }}
      >
        {n}
      </span>
      <div
        style={{
          flex: 1,
          fontSize: 16,
          fontWeight: 700,
          color: 'var(--sk-text)',
          letterSpacing: '-0.2px',
          fontFamily: 'var(--font-jakarta), system-ui, sans-serif',
        }}
      >
        {title}
      </div>
      {action}
    </div>
  )
}
