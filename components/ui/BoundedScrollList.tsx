'use client'

import React from 'react'

/**
 * <BoundedScrollList> — conteneur de liste à hauteur bornée, scroll interne.
 *
 * Pattern flex-fill éprouvé (MessagesInbox + CandidaturesTrackingView) :
 *   - Parent en `display: flex; flex-direction: column` avec une hauteur
 *     définie (le shell impose `<main style="flex:1; overflow:auto; minHeight:0">`).
 *   - Ce conteneur prend `flex: 1; min-height: 0; overflow-y: auto` →
 *     remplit la hauteur disponible et scrolle son contenu en interne.
 *   - Aucun calc(100dvh - X) en dur : on s'appuie sur la chaîne flex jusqu'au
 *     <main>, qui s'adapte naturellement à toutes les tailles desktop.
 *
 * Mobile (<= mobileBreakpoint) : on DÉSACTIVE la borne (display: block,
 * overflow: visible). La page scrolle naturellement → pas de double scroll
 * sur mobile, comportement attendu par les users mobile-first.
 *
 * stickyHeader (optionnel) : typiquement <NewItemsPill>. Reste collé en haut
 * du conteneur pendant que l'utilisateur scrolle vers le bas, lui permettant
 * de toujours cliquer "Afficher" sans remonter manuellement.
 *
 * scrollbar-gutter:stable : évite le shift de layout au mount quand la
 * scrollbar apparaît.
 *
 * USAGE :
 *   Le parent direct (la page) doit être en flex column height: 100%.
 *   Ex.:
 *     <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
 *       <PageHeader ... />
 *       <BoundedScrollList stickyHeader={<NewItemsPill ... />}>
 *         {items.map(...)}
 *       </BoundedScrollList>
 *     </div>
 */

export const BOUNDED_SCROLL_MOBILE_BREAKPOINT = 768

export default function BoundedScrollList({
  children,
  stickyHeader,
  innerGap = 14,
  innerPadding = '0 6px 16px 0',
  mobileBreakpoint = BOUNDED_SCROLL_MOBILE_BREAKPOINT,
  className,
}: {
  children: React.ReactNode
  stickyHeader?: React.ReactNode
  /** Gap vertical entre enfants (px). */
  innerGap?: number
  /** Padding interne — laisse de la place pour la scrollbar à droite. */
  innerPadding?: string
  mobileBreakpoint?: number
  className?: string
}) {
  // L'identifiant local sert à scoper la media query mobile à ce conteneur
  // sans dépendre d'une lib CSS-in-JS. React stable id.
  const uid = React.useId().replace(/:/g, '')
  const cls = `sk-bsl-${uid}${className ? ` ${className}` : ''}`

  return (
    <div
      className={cls}
      style={{
        // Desktop par défaut : flex-fill + scroll interne.
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        // scrollbar-gutter: stable évite le shift au mount.
        scrollbarGutter: 'stable',
        padding: innerPadding,
        display: 'flex',
        flexDirection: 'column',
        gap: innerGap,
      }}
    >
      {stickyHeader && (
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 5,
            // Donne un fond transparent — la pastille se gère son propre fond.
            background: 'transparent',
            pointerEvents: 'none',
          }}
        >
          {/* Re-active pointer events sur le contenu (la pastille interne
              s'auto-rend cliquable). */}
          <div style={{ pointerEvents: 'auto' }}>{stickyHeader}</div>
        </div>
      )}
      {children}
      {/* Mobile : retire la borne, laisse la page scroller naturellement. */}
      <style>{`
        @media (max-width: ${mobileBreakpoint}px) {
          .${cls} {
            flex: 0 0 auto !important;
            min-height: 0 !important;
            overflow-y: visible !important;
            scrollbar-gutter: auto !important;
            padding-right: 0 !important;
          }
        }
      `}</style>
    </div>
  )
}
