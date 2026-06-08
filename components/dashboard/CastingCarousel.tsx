'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useDomain } from '@/context/DomainContext'
import { useMarkCandidatureViewed } from '@/lib/candidature-view-client'
import type { CandidatureData } from '@/components/dashboard/CandidatureCard'
import SpotlightCandidateCard from '@/components/dashboard/SpotlightCandidateCard'

/**
 * CastingCarousel — vue casting "sous projecteur" (Lot vue casting).
 *
 * Disposition :
 *   - 3 slots visibles : [voisin gauche] [SPOTLIGHT] [voisin droit]
 *   - Voisins : scale réduit + opacité faible + pointer-events: none →
 *     visibles mais non interactifs (effet teaser).
 *   - Spotlight : carte pleine, nette, actions interactives.
 *
 * Navigation :
 *   - Flèches gauche/droite à l'écran.
 *   - Clavier : ← / →.
 *   - Compteur "X / N" + pastilles pagination.
 *
 * Auto-mark viewed :
 *   - Quand un candidat devient le centre, on POST /api/me/candidatures/[id]/view
 *     via useMarkCandidatureViewed (qui dispatch skilloria:notif-bump → badge -1).
 *   - Cohérent avec le lot bascule "badges par item consulté".
 *
 * Mobile : viewport étroit → on cache les voisins via media query (les côtés
 * dépassent simplement hors viewport, le spotlight reste centré).
 *
 * useDomain pour l'accent (multi-tenant).
 *
 * `items` DOIT déjà être trié serveur par ai_match_score DESC (cf. DTO org).
 */

type Props = {
  items: CandidatureData[]
  publicationType: 'mission' | 'offre' | string
  pubSkillsRequired: string[]
  onMutated: () => void
}

export default function CastingCarousel({ items, publicationType, pubSkillsRequired, onMutated }: Props) {
  const t = useTranslations('candidatures.casting')
  const tCard = useTranslations('candidatures.card')
  const domain = useDomain()
  const markViewed = useMarkCandidatureViewed()
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Index du centre. Reset à 0 quand la liste change d'identité (nouvelle pub).
  const [centerIdx, setCenterIdx] = useState(0)

  // Reset si la liste change (changement d'annonce dans la page globale).
  const listKey = items.length > 0 ? items[0].id : ''
  const prevKeyRef = useRef(listKey)
  useEffect(() => {
    if (prevKeyRef.current !== listKey) {
      prevKeyRef.current = listKey
      setCenterIdx(0)
    }
  }, [listKey])

  // Clamp centerIdx si la liste raccourcit.
  useEffect(() => {
    if (centerIdx >= items.length && items.length > 0) setCenterIdx(items.length - 1)
  }, [items.length, centerIdx])

  // Auto-mark viewed quand le centre change.
  const center = items[centerIdx] ?? null
  const lastMarkedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!center) return
    if (lastMarkedRef.current === center.id) return
    lastMarkedRef.current = center.id
    void markViewed(center.id)
  }, [center, markViewed])

  const prev = useCallback(() => {
    setCenterIdx((i) => Math.max(0, i - 1))
  }, [])
  const next = useCallback(() => {
    setCenterIdx((i) => Math.min(items.length - 1, i + 1))
  }, [items.length])

  // Navigation clavier (← / →). Scope au composant via focus du container.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ne pas hijack si l'user est dans un input / textarea (ex. raison de
      // refus en cours d'écriture).
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase() ?? ''
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next])

  if (items.length === 0) {
    return (
      <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--sk-muted)', fontSize: 14 }}>
        {t('empty')}
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
        @keyframes sk-casting-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .sk-casting-stage {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0;
          padding: 18px 0 28px;
          min-height: 580px;
        }
        .sk-casting-slot {
          flex-shrink: 0;
          transition: transform .25s ease, opacity .25s ease;
        }
        .sk-casting-slot-center {
          z-index: 3;
          animation: sk-casting-fade .25s ease;
        }
        .sk-casting-slot-side {
          position: absolute;
          top: 50%;
          transform: translateY(-50%) scale(0.78);
          opacity: 0.38;
          filter: grayscale(0.15);
          pointer-events: none;
          z-index: 1;
          width: min(360px, 70vw);
        }
        .sk-casting-slot-side.left  { left: 0; transform: translate(-12%, -50%) scale(0.78); }
        .sk-casting-slot-side.right { right: 0; transform: translate(12%, -50%) scale(0.78); }
        .sk-casting-arrow {
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
        .sk-casting-arrow:disabled { opacity: 0.35; cursor: not-allowed; }
        .sk-casting-arrow:not(:disabled):hover { transform: translateY(-50%) scale(1.06); box-shadow: 0 6px 18px rgba(15,23,42,0.14); }
        .sk-casting-arrow.left { left: 10px; }
        .sk-casting-arrow.right { right: 10px; }
        @media (max-width: 1024px) {
          .sk-casting-slot-side { display: none; }
        }
        @media (max-width: 640px) {
          .sk-casting-stage { min-height: 540px; padding: 12px 0 22px; }
          .sk-casting-arrow { width: 38px; height: 38px; font-size: 16px; }
          .sk-casting-arrow.left { left: 4px; }
          .sk-casting-arrow.right { right: 4px; }
        }
      `}</style>

      {/* Compteur + pastilles pagination */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--sk-muted)', fontWeight: 500 }}>
          {t('counter', { current: centerIdx + 1, total: items.length })}
        </div>
        <div role="tablist" aria-label={t('pagination_aria')} style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', maxWidth: '60%', justifyContent: 'flex-end' }}>
          {items.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={i === centerIdx}
              aria-label={t('goto_aria', { index: i + 1 })}
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

      {/* Stage : voisins + spotlight + arrows */}
      <div className="sk-casting-stage">
        {/* Voisin gauche */}
        {leftItem && (
          <div className="sk-casting-slot sk-casting-slot-side left" aria-hidden>
            <SpotlightCandidateCard
              candidature={leftItem}
              publicationType={publicationType}
              pubSkillsRequired={pubSkillsRequired}
              onMutated={onMutated}
              interactive={false}
            />
          </div>
        )}

        {/* Spotlight (centre) */}
        {center && (
          <div className="sk-casting-slot sk-casting-slot-center" key={center.id}>
            <SpotlightCandidateCard
              candidature={center}
              publicationType={publicationType}
              pubSkillsRequired={pubSkillsRequired}
              onMutated={onMutated}
              interactive
            />
          </div>
        )}

        {/* Voisin droite */}
        {rightItem && (
          <div className="sk-casting-slot sk-casting-slot-side right" aria-hidden>
            <SpotlightCandidateCard
              candidature={rightItem}
              publicationType={publicationType}
              pubSkillsRequired={pubSkillsRequired}
              onMutated={onMutated}
              interactive={false}
            />
          </div>
        )}

        {/* Flèches */}
        <button
          type="button"
          className="sk-casting-arrow left"
          onClick={prev}
          disabled={!canPrev}
          aria-label={t('prev_aria')}
        >
          ‹
        </button>
        <button
          type="button"
          className="sk-casting-arrow right"
          onClick={next}
          disabled={!canNext}
          aria-label={t('next_aria')}
        >
          ›
        </button>
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--sk-faint)', textAlign: 'center', marginTop: 6 }} aria-hidden>
        {tCard('ai_score_tooltip')}
      </div>
    </div>
  )
}
