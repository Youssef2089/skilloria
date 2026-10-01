'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Info } from 'lucide-react'

/**
 * INFO-BULLE — l'icône « i » d'une case ou d'un bloc de tableau de bord, et la phrase
 * qui dit ce que la case COMPTE ou ce que le bloc MONTRE (recette staging du
 * 01/10/2026, point 6).
 *
 * Trois façons de l'ouvrir, une par appareil :
 *   · ORDINATEUR — au survol de la souris ;
 *   · TÉLÉPHONE  — au toucher (un second toucher, ou un toucher ailleurs, la ferme) ;
 *   · CLAVIER    — au focus (Tab), Échap la ferme.
 * La phrase est reliée au bouton par `aria-describedby` : un lecteur d'écran la lit.
 *
 * ⚠️ JAMAIS DANS UN LIEN. Un bouton dans un `<a>` est un élément interactif dans un
 *    autre : le toucher ouvrirait la page au lieu de la phrase. Les cases cliquables
 *    posent l'icône À CÔTÉ du lien (voir les tableaux de bord).
 *
 * Aucune couleur littérale (§D.12) ; aucune bibliothèque d'infobulle — un composant
 * de quatre-vingts lignes ne justifie pas une dépendance.
 */
export default function InfoBulle({ texte, etiquette }: { texte: string; etiquette: string }) {
  const [ouverte, setOuverte] = useState(false)
  const [aGauche, setAGauche] = useState(true)
  const id = useId()
  const racine = useRef<HTMLSpanElement>(null)
  // Le dernier pointeur : une souris ouvre au survol, un doigt au toucher.
  const pointeur = useRef<string>('mouse')

  // La bulle s'ouvre du côté où elle a la place : vers la droite près du bord gauche
  // de l'écran, vers la gauche sinon. Mesuré à l'ouverture, avant la peinture.
  useLayoutEffect(() => {
    if (!ouverte || !racine.current) return
    const r = racine.current.getBoundingClientRect()
    setAGauche(r.left < window.innerWidth / 2)
  }, [ouverte])

  // Fermer au toucher ailleurs et à Échap — seulement tant qu'elle est ouverte.
  useEffect(() => {
    if (!ouverte) return
    const dehors = (e: PointerEvent) => {
      if (racine.current && !racine.current.contains(e.target as Node)) setOuverte(false)
    }
    const echap = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOuverte(false)
    }
    document.addEventListener('pointerdown', dehors)
    document.addEventListener('keydown', echap)
    return () => {
      document.removeEventListener('pointerdown', dehors)
      document.removeEventListener('keydown', echap)
    }
  }, [ouverte])

  return (
    <span ref={racine} style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <button
        type="button"
        aria-label={etiquette}
        aria-expanded={ouverte}
        aria-describedby={ouverte ? id : undefined}
        onPointerDown={(e) => { pointeur.current = e.pointerType }}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') setOuverte(true) }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setOuverte(false) }}
        // Le focus n'ouvre qu'au CLAVIER : un toucher donne aussi le focus, et le clic qui
        // suit refermerait aussitôt ce que le focus vient d'ouvrir.
        onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) setOuverte(true) }}
        onBlur={() => setOuverte(false)}
        onClick={(e) => {
          // Dans une case cliquable, le toucher de l'icône n'ouvre pas la page.
          e.preventDefault()
          e.stopPropagation()
          // La souris a déjà ouvert au survol : un clic ne la referme pas sous le curseur.
          setOuverte((o) => (pointeur.current === 'mouse' ? true : !o))
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 22,
          height: 22,
          padding: 0,
          border: 'none',
          borderRadius: '50%',
          background: 'transparent',
          color: 'var(--sk-muted)',
          cursor: 'help',
        }}
      >
        <Info size={15} aria-hidden />
      </button>
      {ouverte && (
        <span
          id={id}
          role="tooltip"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            ...(aGauche ? { left: 0 } : { right: 0 }),
            zIndex: 30,
            width: 'max-content',
            maxWidth: 'min(280px, 80vw)',
            padding: '10px 12px',
            borderRadius: 10,
            background: 'var(--sk-surface)',
            border: '1px solid var(--sk-border)',
            boxShadow: '0 6px 24px color-mix(in srgb, var(--sk-text) 14%, transparent)',
            color: 'var(--sk-text)',
            fontSize: 12.5,
            fontWeight: 400,
            lineHeight: 1.5,
            textAlign: 'left',
            whiteSpace: 'normal',
          }}
        >
          {texte}
        </span>
      )}
    </span>
  )
}
