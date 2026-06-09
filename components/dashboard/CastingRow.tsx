'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * CastingRow — rangée HORIZONTALE de cartes commerciales (home uniquement).
 *
 * Remplit la largeur, alignée à gauche, scroll-snap horizontal. ~4-5 cartes
 * visibles desktop, scroll pour les suivantes ; 1-1.5 carte en mobile (swipe
 * natif). Une seule hauteur de rangée → ne rallonge pas le home.
 *
 * Navigation : flèches prev/next (overlay, masquées aux extrémités et en
 * mobile), clavier ← / → quand la rangée a le focus, swipe = scroll tactile
 * natif. AGNOSTIQUE du contenu : la carte vient de `renderItem`.
 *
 * Distinct de SpotlightCarousel (qui est du « une-carte-projecteur » pour
 * l'org). Ici pas de notion de centre/voisines.
 */

type Props<T> = {
  items: T[]
  getKey: (item: T) => string
  renderItem: (item: T) => ReactNode
  labels: { prevAria: string; nextAria: string; empty: string }
  /** Largeur des cartes desktop (px). Défaut 272. */
  cardWidth?: number
}

export default function CastingRow<T>({ items, getKey, renderItem, labels, cardWidth = 272 }: Props<T>) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [canPrev, setCanPrev] = useState(false)
  const [canNext, setCanNext] = useState(false)

  const update = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    setCanPrev(el.scrollLeft > 4)
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [update, items.length])

  const scrollByCards = useCallback((dir: 1 | -1) => {
    const el = scrollerRef.current
    if (!el) return
    const slot = el.querySelector('[data-castrow-slot]') as HTMLElement | null
    const step = (slot ? slot.offsetWidth + 14 : el.clientWidth * 0.8) * 2 // ~2 cartes
    el.scrollBy({ left: dir * step, behavior: 'smooth' })
  }, [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); scrollByCards(-1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); scrollByCards(1) }
    },
    [scrollByCards],
  )

  if (items.length === 0) {
    return <div style={{ padding: '24px', textAlign: 'center', color: 'var(--sk-muted)', fontSize: 14 }}>{labels.empty}</div>
  }

  return (
    <div style={{ position: 'relative' }} role="group" tabIndex={0} onKeyDown={onKeyDown}>
      <style>{`
        .sk-castrow-scroller {
          display: flex;
          gap: 14px;
          overflow-x: auto;
          scroll-snap-type: x mandatory;
          scroll-behavior: smooth;
          padding: 4px 2px 12px;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .sk-castrow-scroller::-webkit-scrollbar { display: none; }
        .sk-castrow-slot {
          flex: 0 0 auto;
          width: ${cardWidth}px;
          scroll-snap-align: start;
          display: flex;
        }
        .sk-castrow-slot > * { width: 100%; }
        .sk-castrow-arrow {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          width: 40px; height: 40px;
          border-radius: 50%;
          background: #fff;
          border: 1px solid var(--sk-border);
          color: var(--sk-text);
          cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 14px rgba(15,23,42,0.12);
          font-family: inherit; font-size: 18px;
          z-index: 5;
          transition: opacity .15s, box-shadow .15s;
        }
        .sk-castrow-arrow:disabled { opacity: 0; pointer-events: none; }
        .sk-castrow-arrow:not(:disabled):hover { box-shadow: 0 6px 18px rgba(15,23,42,0.16); }
        .sk-castrow-arrow.left { left: -6px; }
        .sk-castrow-arrow.right { right: -6px; }
        @media (max-width: 768px) { .sk-castrow-arrow { display: none; } }
        @media (max-width: 640px) { .sk-castrow-slot { width: 82vw; } }
      `}</style>

      <div ref={scrollerRef} className="sk-castrow-scroller">
        {items.map((it) => (
          <div key={getKey(it)} data-castrow-slot className="sk-castrow-slot">
            {renderItem(it)}
          </div>
        ))}
      </div>

      <button type="button" className="sk-castrow-arrow left" onClick={() => scrollByCards(-1)} disabled={!canPrev} aria-label={labels.prevAria}>
        ‹
      </button>
      <button type="button" className="sk-castrow-arrow right" onClick={() => scrollByCards(1)} disabled={!canNext} aria-label={labels.nextAria}>
        ›
      </button>
    </div>
  )
}
