import type { CSSProperties } from 'react'

/**
 * BandeauTroncature — UN PLAFOND MUET EST UN MENSONGE DIFFÉRÉ.
 *
 * Le serveur lit une ligne de plus que son plafond et DIT si la liste est
 * incomplète (`troncature.atteint`, lib/plafonds-liste). Un écran qui reçoit ce
 * drapeau et ne le montre pas rend le plafond muet tout court : c'est ce
 * composant qui le montre, partout de la même façon — le modèle est le bandeau
 * de la page Annonces, qui existait seul (lot C4a, `diag-plafonds-listes`).
 *
 * Il ne décide RIEN : le texte est traduit par l'appelant (namespace `plafonds`),
 * parce que la phrase dépend de ce qui est coupé (« vos 200 candidatures les
 * plus récentes », « les 500 messages les plus récents »…) et du bout qui tombe.
 */
export type Troncature = { plafond: number; atteint: boolean }

export function BandeauTroncature({ texte, style }: { texte: string; style?: CSSProperties }) {
  return (
    <div
      role="status"
      style={{
        margin: '0 0 12px',
        padding: '10px 14px',
        borderRadius: 10,
        background: '#fffbeb',
        border: '1px solid #fde68a',
        color: '#92400e',
        fontSize: 13,
        lineHeight: 1.5,
        ...style,
      }}
    >
      {texte}
    </div>
  )
}
