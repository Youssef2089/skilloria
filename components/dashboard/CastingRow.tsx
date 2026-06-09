'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { castingTheme } from '@/lib/casting-theme'

/**
 * CastingRow — rangée HORIZONTALE de cartes commerciales (home uniquement).
 *
 * Remplit la largeur, alignée à gauche, scroll-snap horizontal. ~4-5 cartes
 * visibles desktop, scroll pour les suivantes ; 1-1.5 carte en mobile (swipe
 * natif). Une seule hauteur de rangée → ne rallonge pas le home.
 *
 * Navigation : flèches prev/next (overlay, masquées aux extrémités et en
 * mobile), clavier ← / → quand la rangée a le focus, swipe = scroll tactile
 * natif, ET une scrollbar horizontale custom (curseur draggable) affichée
 * quand le contenu déborde. Scrollbar fine, arrondie, discrète, lavande
 * (castingTheme.accent — couleur décorative casting). AGNOSTIQUE du
 * contenu : carte = `renderItem`.
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
  const trackRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ startX: number; startScrollLeft: number } | null>(null)
  const [canPrev, setCanPrev] = useState(false)
  const [canNext, setCanNext] = useState(false)
  const [overflow, setOverflow] = useState(false)
  // Géométrie du curseur (en %) : largeur ∝ viewport/contenu, position ∝ scroll.
  const [thumb, setThumb] = useState({ widthPct: 100, leftPct: 0 })

  const update = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const { scrollLeft, clientWidth, scrollWidth } = el
    const max = scrollWidth - clientWidth
    setCanPrev(scrollLeft > 4)
    setCanNext(scrollLeft + clientWidth < scrollWidth - 4)
    setOverflow(max > 4)
    const widthPct = Math.min(100, (clientWidth / scrollWidth) * 100)
    const leftPct = max > 0 ? (scrollLeft / max) * (100 - widthPct) : 0
    setThumb({ widthPct, leftPct })
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

  // --- Curseur draggable -----------------------------------------------------
  // Pendant le drag : on coupe snap + smooth pour un suivi 1:1 du pointeur,
  // puis on restaure (le snap re-cale proprement au relâchement).
  const onThumbPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const el = scrollerRef.current
    if (!el) return
    dragRef.current = { startX: e.clientX, startScrollLeft: el.scrollLeft }
    el.style.scrollBehavior = 'auto'
    el.style.scrollSnapType = 'none'
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const onThumbPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current
    const el = scrollerRef.current
    const track = trackRef.current
    if (!drag || !el || !track) return
    const max = el.scrollWidth - el.clientWidth
    const thumbW = track.clientWidth * (el.clientWidth / el.scrollWidth)
    const movable = track.clientWidth - thumbW
    const dx = e.clientX - drag.startX
    el.scrollLeft = drag.startScrollLeft + (movable > 0 ? (dx / movable) * max : 0)
  }, [])

  const onThumbPointerUp = useCallback((e: React.PointerEvent) => {
    const el = scrollerRef.current
    dragRef.current = null
    if (el) {
      el.style.scrollBehavior = ''
      el.style.scrollSnapType = ''
    }
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
  }, [])

  // Clic sur la piste (hors curseur) : on saute en centrant le curseur sous le clic.
  const onTrackPointerDown = useCallback((e: React.PointerEvent) => {
    const el = scrollerRef.current
    const track = trackRef.current
    if (!el || !track) return
    const rect = track.getBoundingClientRect()
    const thumbW = rect.width * (el.clientWidth / el.scrollWidth)
    const movable = rect.width - thumbW
    if (movable <= 0) return
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left - thumbW / 2) / movable))
    el.scrollTo({ left: ratio * (el.scrollWidth - el.clientWidth), behavior: 'smooth' })
  }, [])

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
          padding: 4px 2px 4px;
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
          top: calc(50% - 8px);
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

        /* Scrollbar horizontale custom : piste discrète + curseur accent. */
        .sk-castrow-track {
          position: relative;
          height: 6px;
          margin: 8px 2px 2px;
          border-radius: 999px;
          background: var(--sk-border-soft);
          cursor: pointer;
        }
        .sk-castrow-thumb {
          position: absolute;
          top: 0; bottom: 0;
          min-width: 28px;
          border-radius: 999px;
          background: ${castingTheme.accent};
          opacity: 0.55;
          cursor: grab;
          touch-action: none;
          transition: opacity .15s;
        }
        .sk-castrow-thumb:hover { opacity: 0.8; }
        .sk-castrow-thumb:active { cursor: grabbing; opacity: 0.95; }
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

      {overflow && (
        <div ref={trackRef} className="sk-castrow-track" onPointerDown={onTrackPointerDown}>
          <div
            className="sk-castrow-thumb"
            style={{ width: `${thumb.widthPct}%`, left: `${thumb.leftPct}%` }}
            onPointerDown={onThumbPointerDown}
            onPointerMove={onThumbPointerMove}
            onPointerUp={onThumbPointerUp}
            onPointerCancel={onThumbPointerUp}
            role="scrollbar"
            aria-orientation="horizontal"
            aria-label={labels.nextAria}
            aria-valuenow={Math.round(thumb.leftPct)}
          />
        </div>
      )}
    </div>
  )
}
