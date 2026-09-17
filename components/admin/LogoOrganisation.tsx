'use client'

import { useState } from 'react'

/**
 * LogoOrganisation — le logo d'une organisation dans les écrans d'administration,
 * avec REPLI SUR ÉCHEC.
 *
 * ┌─ POURQUOI CE COMPOSANT EXISTE ──────────────────────────────────────────┐
 * │ Les deux écrans admin écrivaient `org.logo_url ? <img> : <initiales>`.  │
 * │ Le repli ne couvrait donc que l'ABSENCE, jamais l'ÉCHEC de chargement : │
 * │ une adresse morte donnait l'icône d'image cassée du navigateur — un     │
 * │ écran mort, que la checklist du projet interdit.                        │
 * │                                                                          │
 * │ Le cas est devenu structurel : ces écrans reçoivent désormais des URL   │
 * │ SIGNÉES (migration 20260916300000), qui vivent 300 s. Un onglet resté   │
 * │ ouvert au-delà rouvre une image expirée — un échec PARFAITEMENT NORMAL. │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Pourquoi pas `components/ui/Avatar` : sa palette de repli est celle du
 * produit (variables `--sk-*`), celle-ci est celle de l'administration
 * (#DBEAFE / #00B9FF). Le comportement est identique, l'apparence ne l'est pas,
 * et changer l'apparence de l'administration n'était pas l'objet du lot.
 */
export default function LogoOrganisation({
  src,
  nom,
  taille,
  taillePolice,
}: {
  /** URL SIGNÉE servie par la route. Jamais la valeur brute de la colonne. */
  src: string | null
  nom: string | null
  taille: number
  taillePolice: number
}) {
  const [echec, setEchec] = useState(false)
  const [srcPrecedent, setSrcPrecedent] = useState(src)

  // Une nouvelle URL mérite une nouvelle tentative : sans cette remise à zéro,
  // un échec resterait collé et l'organisation suivante n'aurait aucune chance
  // de s'afficher.
  //
  // Ajusté PENDANT LE RENDU, pas dans un effet — cf. le commentaire détaillé
  // dans components/ui/ImageOuRepli.tsx.
  if (src !== srcPrecedent) {
    setSrcPrecedent(src)
    setEchec(false)
  }

  const initiales = ((nom ?? '').trim().slice(0, 2) || '??').toUpperCase()

  if (src && !echec) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={nom ?? ''}
        width={taille}
        height={taille}
        onError={() => setEchec(true)}
        style={{
          width: taille,
          height: taille,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
        }}
      />
    )
  }

  return (
    <span
      aria-hidden
      style={{
        width: taille,
        height: taille,
        borderRadius: '50%',
        background: '#DBEAFE',
        color: '#00B9FF',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: taillePolice,
        fontWeight: 500,
        flexShrink: 0,
      }}
    >
      {initiales}
    </span>
  )
}
