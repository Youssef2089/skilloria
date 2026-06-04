'use client'

import type { ReactNode } from 'react'

/**
 * MasterDetail — layout liste+détail responsive (Lot refonte UX).
 *
 * Desktop ≥ 1024px : 2 colonnes (liste largeur fixe, détail flex 1).
 * Tablette 768-1023px : 2 colonnes resserrées (liste plus étroite).
 * Mobile < 768px : mono-colonne, `detailVisible` détermine quoi montrer
 * (typiquement contrôlé par la présence d'une route /[id]).
 *
 * Le composant NE gère PAS le routing — l'enfant détail est rendu si
 * `detailVisible` ; sinon empty state vide ou rien.
 */
export default function MasterDetail({
  list,
  detail,
  listWidth = 392,
  detailVisible = true,
  noPadding = false,
}: {
  list: ReactNode
  detail: ReactNode
  /** Largeur de la colonne liste sur desktop (par défaut 392px style maquette). */
  listWidth?: number
  /** Si true, le détail est rendu ; sinon empty state (mono-col mobile : liste seule). */
  detailVisible?: boolean
  /** Désactive le padding interne (pour les pages messages plein écran). */
  noPadding?: boolean
}) {
  return (
    <div
      className="sk-md"
      data-detail-visible={detailVisible ? 'true' : 'false'}
      style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: `${listWidth}px 1fr`,
        gap: 18,
        minHeight: 0,
        padding: noPadding ? 0 : '0 26px 22px',
      }}
    >
      <style>{`
        @media (max-width: 1023px) {
          .sk-md { grid-template-columns: minmax(280px, 320px) 1fr !important; gap: 14px !important; }
        }
        @media (max-width: 767px) {
          .sk-md { grid-template-columns: 1fr !important; }
          .sk-md[data-detail-visible="true"] .sk-md-list { display: none; }
          .sk-md[data-detail-visible="false"] .sk-md-detail { display: none; }
        }
      `}</style>
      <div className="sk-md-list" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {list}
      </div>
      <div className="sk-md-detail" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {detail}
      </div>
    </div>
  )
}
