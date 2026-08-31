'use client'

/**
 * CorrespondantAvatar — pastille d'un correspondant de messagerie.
 *
 * POURQUOI UN COMPOSANT, ET PAS DEUX COPIES
 *   L'inbox et l'en-tête du fil rendaient la même pastille, chacune avec sa
 *   propre expression. Elles devaient toutes deux changer pour le code masqué ;
 *   les laisser séparées, c'était se donner deux occasions de n'en corriger
 *   qu'une.
 *
 * DEUX CAS, ET LE SERVEUR TRANCHE
 *   - `isMasked` : le nom servi est un CODE de trois lettres (« YCH »). On
 *     l'affiche EN ENTIER. Réduire « YCH » à « Y » aurait mis, côte à côte,
 *     une pastille et un libellé commençant par la même lettre — du bruit qui
 *     n'apprend rien.
 *   - sinon : identité lisible (raison sociale, nom complet, ou libellé de
 *     compte supprimé) → première lettre, comme avant.
 *
 *   `isMasked` est SERVI par l'API (`correspondant.is_masked`), il n'est pas
 *   déduit du motif de la chaîne. Deviner « trois majuscules donc masqué »
 *   reviendrait à reconstruire une règle de sécurité dans le navigateur, ce
 *   que le point 20 interdit — et un nom de famille comme « NG » ou un
 *   acronyme d'entreprise ferait un faux positif.
 *
 * `Array.from(...)[0]` ET NON `name[0]` : l'indexation d'une chaîne rend une
 * unité UTF-16. Sur un nom commençant par un caractère hors du plan de base,
 * elle renvoie une demi-paire de substitution, qui s'affiche en carré vide.
 */

type Props = {
  name: string | null
  /** Servi par le serveur. `true` ⇒ `name` est un code de masquage. */
  isMasked: boolean
  avatarUrl: string | null
  /** Diamètre en pixels. La police s'y adapte. */
  size: number
}

export default function CorrespondantAvatar({ name, isMasked, avatarUrl, size }: Props) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    )
  }

  const trimmed = (name ?? '').trim()
  const showsCode = isMasked && trimmed.length > 0
  // Le code entier tient dans la pastille moyennant une police plus petite ;
  // une initiale seule peut rester généreuse.
  const content = showsCode ? trimmed : (Array.from(trimmed)[0]?.toUpperCase() ?? '?')
  const fontSize = showsCode ? Math.max(10, Math.round(size * 0.3)) : Math.round(size * 0.39)

  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: '#f1f5f9',
        color: '#94a3b8',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize,
        fontWeight: 600,
        letterSpacing: showsCode ? '.02em' : undefined,
        flexShrink: 0,
      }}
    >
      {content}
    </div>
  )
}
