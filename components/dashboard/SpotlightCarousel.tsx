'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useDomain } from '@/context/DomainContext'

/**
 * SpotlightCarousel — shell « casting sous projecteur » AGNOSTIQUE du contenu.
 *
 * Généralisé depuis CastingCarousel (vue casting org) : ce composant ne gère
 * QUE la mise en scène et la navigation, jamais le type de carte affichée.
 *
 * Disposition :
 *   - 3 slots visibles : [voisin gauche] [SPOTLIGHT] [voisin droit]
 *   - Voisins : scale réduit + opacité faible + pointer-events:none →
 *     visibles mais non interactifs (effet teaser). PAS de cadenas / masquage :
 *     toute notion de disclosure est laissée à la carte fournie par l'appelant.
 *   - Spotlight : carte pleine, nette, interactive.
 *
 * Navigation :
 *   - Flèches gauche/droite à l'écran.
 *   - Clavier : ← / → (ignoré si le focus est dans un input/textarea).
 *   - Swipe tactile (mobile).
 *   - Compteur "X / N" (+ légende « trié par score ») + pastilles pagination.
 *
 * La carte est fournie via `renderItem(item, { isCenter })` : l'appelant
 * décide quoi rendre et comment désactiver les voisins.
 *
 * `onCenterChange(item, index)` est appelé quand le centre change (dédupliqué
 * par clé) : l'appelant l'utilise par ex. pour marquer un item comme vu. Le
 * shell n'a AUCUNE logique « viewed » en propre.
 *
 * `items` DOIT déjà être trié par l'appelant (ex. score DESC).
 *
 * useDomain pour l'accent (multi-tenant).
 */

export type SpotlightCarouselLabels = {
  /** Compteur, ex. "3 / 12". */
  formatCounter: (current: number, total: number) => string
  prevAria: string
  nextAria: string
  paginationAria: string
  gotoAria: (index: number) => string
  empty: string
  /** Légende optionnelle affichée sous le compteur (ex. « Trié par score »). */
  sortedByScore?: string
  /** Note de bas de scène optionnelle (ex. tooltip score IA). */
  footnote?: string
}

type Props<T> = {
  items: T[]
  getKey: (item: T) => string
  renderItem: (item: T, ctx: { isCenter: boolean }) => ReactNode
  labels: SpotlightCarouselLabels
  /** Index de départ (défaut 0). Re-appliqué quand la liste change d'identité. */
  initialIndex?: number
  /** Appelé quand le centre change (dédupliqué par clé). */
  onCenterChange?: (item: T, index: number) => void
  /** Largeur max des voisins (défaut 360). */
  sideMaxWidth?: number
  /** Hauteur min de la scène (défaut 580 — org pixel-identique). number → px. */
  minHeight?: number | string
  /** Hauteur min de la scène <640px (défaut 540 — org pixel-identique). */
  minHeightMobile?: number | string
  /**
   * Borne la largeur du stage et le centre (défaut `undefined` → 100% = org).
   * En la bornant, les voisines ancrées aux bords se rapprochent du centre.
   */
  sceneMaxWidth?: number | string
  /**
   * Décalage horizontal des voisines (magnitude positive ; gauche = -valeur,
   * droite = +valeur). Défaut '12%' — org pixel-identique.
   */
  sidePeek?: string
}

function cssLen(v: number | string): string {
  return typeof v === 'number' ? `${v}px` : v
}

export default function SpotlightCarousel<T>({
  items,
  getKey,
  renderItem,
  labels,
  initialIndex = 0,
  onCenterChange,
  sideMaxWidth = 360,
  minHeight = 580,
  minHeightMobile = 540,
  sceneMaxWidth,
  sidePeek = '12%',
}: Props<T>) {
  const domain = useDomain()
  const containerRef = useRef<HTMLDivElement | null>(null)

  const [centerIdx, setCenterIdx] = useState(initialIndex)

  // Reset si la liste change d'identité (ex. changement d'annonce / de filtre).
  const listKey = items.length > 0 ? getKey(items[0]) : ''
  const prevKeyRef = useRef(listKey)
  useEffect(() => {
    if (prevKeyRef.current !== listKey) {
      prevKeyRef.current = listKey
      setCenterIdx(initialIndex)
    }
  }, [listKey, initialIndex])

  // Clamp centerIdx si la liste raccourcit.
  useEffect(() => {
    if (centerIdx >= items.length && items.length > 0) setCenterIdx(items.length - 1)
  }, [items.length, centerIdx])

  // Notifie l'appelant quand le centre change (dédupliqué par clé).
  const center = items[centerIdx] ?? null
  const centerKey = center ? getKey(center) : null
  const lastNotifiedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!center || centerKey == null) return
    if (lastNotifiedRef.current === centerKey) return
    lastNotifiedRef.current = centerKey
    onCenterChange?.(center, centerIdx)
  }, [center, centerKey, centerIdx, onCenterChange])

  const prev = useCallback(() => {
    setCenterIdx((i) => Math.max(0, i - 1))
  }, [])
  const next = useCallback(() => {
    setCenterIdx((i) => Math.min(items.length - 1, i + 1))
  }, [items.length])

  // Navigation clavier (← / →). Ignore si focus dans un champ de saisie.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase() ?? ''
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next])

  // Swipe tactile (mobile). Seuil horizontal de 40px, ignore les swipes
  // majoritairement verticaux (scroll).
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const t0 = e.touches[0]
    touchStartRef.current = { x: t0.clientX, y: t0.clientY }
  }, [])
  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const start = touchStartRef.current
    touchStartRef.current = null
    if (!start) return
    const t1 = e.changedTouches[0]
    const dx = t1.clientX - start.x
    const dy = t1.clientY - start.y
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return
    if (dx > 0) prev()
    else next()
  }, [prev, next])

  if (items.length === 0) {
    return (
      <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--sk-muted)', fontSize: 14 }}>
        {labels.empty}
      </div>
    )
  }

  const leftItem = centerIdx > 0 ? items[centerIdx - 1] : null
  const rightItem = centerIdx < items.length - 1 ? items[centerIdx + 1] : null
  const canPrev = centerIdx > 0
  const canNext = centerIdx < items.length - 1

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <style>{`
        @keyframes sk-spotlight-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .sk-spotlight-stage {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0;
          padding: 18px 0 28px;
          min-height: ${cssLen(minHeight)};
          max-width: ${sceneMaxWidth != null ? cssLen(sceneMaxWidth) : 'none'};
          margin-left: auto;
          margin-right: auto;
        }
        .sk-spotlight-slot {
          flex-shrink: 0;
          transition: transform .25s ease, opacity .25s ease;
        }
        .sk-spotlight-slot-center {
          z-index: 3;
          animation: sk-spotlight-fade .25s ease;
        }
        .sk-spotlight-slot-side {
          position: absolute;
          top: 50%;
          transform: translateY(-50%) scale(0.78);
          opacity: 0.38;
          filter: grayscale(0.15);
          pointer-events: none;
          z-index: 1;
          width: min(${sideMaxWidth}px, 70vw);
        }
        .sk-spotlight-slot-side.left  { left: 0; transform: translate(calc(-1 * ${sidePeek}), -50%) scale(0.78); }
        .sk-spotlight-slot-side.right { right: 0; transform: translate(${sidePeek}, -50%) scale(0.78); }
        .sk-spotlight-arrow {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          width: 44px; height: 44px;
          border-radius: 50%;
          background: #fff;
          border: 1px solid var(--sk-border);
          color: var(--sk-text);
          cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 14px rgba(15,23,42,0.10);
          font-family: inherit; font-size: 18px;
          z-index: 5;
          transition: transform .12s, box-shadow .15s, opacity .15s;
        }
        .sk-spotlight-arrow:disabled { opacity: 0.35; cursor: not-allowed; }
        .sk-spotlight-arrow:not(:disabled):hover { transform: translateY(-50%) scale(1.06); box-shadow: 0 6px 18px rgba(15,23,42,0.14); }
        .sk-spotlight-arrow.left { left: 10px; }
        .sk-spotlight-arrow.right { right: 10px; }
        @media (max-width: 1024px) {
          .sk-spotlight-slot-side { display: none; }
        }
        @media (max-width: 640px) {
          .sk-spotlight-stage { min-height: ${cssLen(minHeightMobile)}; padding: 12px 0 22px; }
          .sk-spotlight-arrow { width: 38px; height: 38px; font-size: 16px; }
          .sk-spotlight-arrow.left { left: 4px; }
          .sk-spotlight-arrow.right { right: 4px; }
        }
      `}</style>

      {/* Compteur (+ légende trié par score) + pastilles pagination */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--sk-muted)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{labels.formatCounter(centerIdx + 1, items.length)}</span>
          {labels.sortedByScore && (
            <span style={{ color: 'var(--sk-faint)', fontWeight: 500 }}>· {labels.sortedByScore}</span>
          )}
        </div>
        <div role="tablist" aria-label={labels.paginationAria} style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', maxWidth: '60%', justifyContent: 'flex-end' }}>
          {items.map((item, i) => (
            <button
              key={getKey(item)}
              type="button"
              role="tab"
              aria-selected={i === centerIdx}
              aria-label={labels.gotoAria(i + 1)}
              onClick={() => setCenterIdx(i)}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: i === centerIdx ? domain.primaryColor : 'var(--sk-border)',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                transition: 'background .12s, transform .12s',
                transform: i === centerIdx ? 'scale(1.2)' : 'scale(1)',
              }}
            />
          ))}
        </div>
      </div>

      {/* Stage : voisins + spotlight + flèches */}
      <div className="sk-spotlight-stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {/* Voisin gauche */}
        {leftItem && (
          <div className="sk-spotlight-slot sk-spotlight-slot-side left" aria-hidden>
            {renderItem(leftItem, { isCenter: false })}
          </div>
        )}

        {/* Spotlight (centre) */}
        {center && (
          <div className="sk-spotlight-slot sk-spotlight-slot-center" key={getKey(center)}>
            {renderItem(center, { isCenter: true })}
          </div>
        )}

        {/* Voisin droite */}
        {rightItem && (
          <div className="sk-spotlight-slot sk-spotlight-slot-side right" aria-hidden>
            {renderItem(rightItem, { isCenter: false })}
          </div>
        )}

        {/* Flèches */}
        <button
          type="button"
          className="sk-spotlight-arrow left"
          onClick={prev}
          disabled={!canPrev}
          aria-label={labels.prevAria}
        >
          ‹
        </button>
        <button
          type="button"
          className="sk-spotlight-arrow right"
          onClick={next}
          disabled={!canNext}
          aria-label={labels.nextAria}
        >
          ›
        </button>
      </div>

      {labels.footnote && (
        <div style={{ fontSize: 11.5, color: 'var(--sk-faint)', textAlign: 'center', marginTop: 6 }} aria-hidden>
          {labels.footnote}
        </div>
      )}
    </div>
  )
}
