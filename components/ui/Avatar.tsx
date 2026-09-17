'use client'

import { useState } from 'react'

/**
 * Avatar — image circulaire ou initiales fallback. Multi-tenant : la couleur
 * fallback dérive de --sk-accent (via color-mix dans le CSS).
 *
 * ┌─ ÉCRAN MORT FERMÉ : `src` ABSENT ET `src` QUI ÉCHOUE SONT DEUX CHOSES ──┐
 * │ Ce composant basculait sur les initiales quand `src` était ABSENT, et   │
 * │ jamais quand le chargement ÉCHOUAIT. Une URL morte donnait donc l'icône │
 * │ d'image cassée du navigateur — un écran mort, que la checklist du       │
 * │ projet interdit, et il était là AVANT le lot logo.                      │
 * │                                                                          │
 * │ Le cas est devenu structurel depuis que les logos sont servis par URL   │
 * │ SIGNÉE : une signature a une durée de vie de 300 s. Un onglet resté     │
 * │ ouvert au-delà rouvre une image expirée — donc un échec de chargement   │
 * │ PARFAITEMENT NORMAL, qui ne doit jamais se voir comme une panne.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export default function Avatar({
  src,
  name,
  size = 40,
  variant = 'accent',
}: {
  src?: string | null
  name?: string | null
  size?: number
  variant?: 'accent' | 'neutral'
}) {
  const [echecChargement, setEchecChargement] = useState(false)
  const [srcPrecedent, setSrcPrecedent] = useState(src)

  // Une NOUVELLE URL mérite une nouvelle tentative : sans cette remise à zéro,
  // un échec resterait collé au composant et la photo suivante n'aurait aucune
  // chance de s'afficher — un état vide définitif après un incident passager.
  //
  // Ajusté PENDANT LE RENDU, pas dans un effet — cf. le commentaire détaillé
  // dans components/ui/ImageOuRepli.tsx.
  if (src !== srcPrecedent) {
    setSrcPrecedent(src)
    setEchecChargement(false)
  }

  const initials = (name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase() || '?'

  if (src && !echecChargement) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name ?? ''}
        // L'échec bascule sur les initiales — l'état vide DÉLIBÉRÉ, jamais
        // l'icône d'image cassée du navigateur.
        onError={() => setEchecChargement(true)}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    )
  }

  const bg = variant === 'accent' ? 'var(--sk-accent-soft)' : 'var(--sk-surface-2)'
  const fg = variant === 'accent' ? 'var(--sk-accent-ink)' : 'var(--sk-muted)'

  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        color: fg,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.max(11, Math.round(size * 0.35)),
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {initials}
    </span>
  )
}
