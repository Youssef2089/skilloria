'use client'

import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

/**
 * ImageOuRepli — une image, et ce qu'on montre quand elle n'arrive pas.
 *
 * ┌─ LE DEFAUT DE CLASSE QUE CE COMPOSANT FERME ────────────────────────────┐
 * │ Partout dans le produit, le motif etait `{url ? <img/> : <repli/>}`.    │
 * │ Le repli ne couvrait donc que l'ABSENCE d'adresse, jamais l'ECHEC de    │
 * │ chargement : une adresse morte donnait l'icone d'image cassee du        │
 * │ navigateur — un ecran mort, interdit par la checklist du projet.        │
 * │                                                                          │
 * │ Ce n'etait pas theorique : `diag-logo-organisation` a trouve DIX        │
 * │ emplacements dans ce cas, sur des avatars, des photos d'expert et des   │
 * │ logos d'ecosysteme.                                                     │
 * │                                                                          │
 * │ Et c'est devenu STRUCTUREL : les images privees sont servies par URL    │
 * │ SIGNEE, qui vit 300 s. Un onglet reste ouvert au-dela rouvre une image  │
 * │ expiree — un echec PARFAITEMENT NORMAL, qui ne doit jamais ressembler   │
 * │ a une panne.                                                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `repli` peut valoir `null` : pour une image purement decorative (le logo
 * d'ecosysteme a cote du nom de la marque, deja ecrit en toutes lettres),
 * ne RIEN afficher est le bon repli. Montrer des initiales a la place d'un
 * logo serait un artefact.
 */
export default function ImageOuRepli({
  src,
  alt,
  style,
  className,
  width,
  height,
  repli = null,
}: {
  src: string | null | undefined
  alt: string
  style?: CSSProperties
  className?: string
  width?: number
  height?: number
  /** Ce qu'on montre si l'image est absente OU si elle echoue. */
  repli?: ReactNode
}) {
  const [echec, setEchec] = useState(false)
  const [srcPrecedent, setSrcPrecedent] = useState(src)

  // Une NOUVELLE adresse merite une nouvelle tentative : sans cette remise a
  // zero, un echec resterait colle au composant et l'image suivante n'aurait
  // aucune chance de s'afficher — un etat vide definitif apres un incident
  // passager.
  //
  // ⚠️ AJUSTE PENDANT LE RENDU, PAS DANS UN EFFET.
  //    La premiere version faisait `useEffect(() => setEchec(false), [src])`.
  //    C'est l'anti-pattern que React deconseille et que la regle
  //    `react-hooks/set-state-in-effect` refuse : l'effet s'execute APRES la
  //    peinture, donc le composant rend d'abord le repli avec la NOUVELLE
  //    adresse, puis se re-rend — un scintillement, et une cascade de rendus.
  //    La comparaison au rendu est la forme recommandee (« adjusting state
  //    when a prop changes ») : elle corrige l'etat AVANT la peinture.
  if (src !== srcPrecedent) {
    setSrcPrecedent(src)
    setEchec(false)
  }

  if (!src || echec) return <>{repli}</>

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      onError={() => setEchec(true)}
      className={className}
      style={style}
    />
  )
}
