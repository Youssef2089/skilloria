'use client'

/**
 * Jeu d'icônes de la page d'accueil : SVG en ligne, aucune police d'icônes,
 * aucune requête réseau. Purement décoratives — le sens est porté par le texte
 * i18n qui les accompagne, d'où `aria-hidden`.
 */
export type HomeIconName =
  | 'bell'
  | 'users'
  | 'target'
  | 'switch'
  | 'document'
  | 'verified'
  | 'nocommission'

const paths: Record<HomeIconName, string> = {
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  target:
    '<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2"/>',
  switch: '<path d="M7 4 3 8l4 4M3 8h13a4 4 0 0 1 4 4M17 20l4-4-4-4M21 16H8a4 4 0 0 1-4-4"/>',
  document:
    '<path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7zM14 2v5h5M9 13h6M9 17h4"/>',
  verified:
    '<path d="m9 12 2 2 4-4M12 3l2.4 1.8 3-.3 1 2.9 2.5 1.7-1.2 2.8 1.2 2.8-2.5 1.7-1 2.9-3-.3L12 21l-2.4-1.8-3 .3-1-2.9L3.1 15l1.2-2.8L3.1 9.4l2.5-1.7 1-2.9 3 .3z"/>',
  nocommission: '<path d="M19 5 5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5M17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5"/>',
}

export default function HomeIcon({
  name,
  color,
  size = 18,
}: {
  name: HomeIconName
  color: string
  size?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: paths[name] }}
    />
  )
}
