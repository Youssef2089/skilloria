import { allMenuRoutes } from '@/lib/nav-config'

/**
 * Routes de MENU (destinations de sidebar) de TOUS les rôles.
 *
 * Une page de MENU = une entrée de sidebar (tableau de bord, missions,
 * candidatures, messages, paramètres, annonces, catalogue commerce, etc.). Une
 * page de DÉTAIL = tout le reste sous un menu (missions/[id], packages/[id],
 * packages/new, …) : elle, porte le bouton Retour.
 *
 * ⚠️ AUCUNE liste codée en dur ici — elle se désynchronisait à chaque nouvelle
 * entrée de sidebar et faisait apparaître un bouton Retour parasite sur une
 * page de menu. La liste est DÉRIVÉE de lib/nav-config.ts, la structure qui
 * alimente réellement les deux sidebars (dashboard + admin). Pour déclarer une
 * nouvelle route de menu, il suffit d'ajouter son entrée de sidebar là-bas.
 *
 * Les chemins sont SANS préfixe de locale (format de `usePathname()` next-intl).
 */

/** Ensemble figé de toutes les routes de menu (tous rôles), pour test O(1). */
const MENU_ROUTES: ReadonlySet<string> = new Set<string>(allMenuRoutes())

/**
 * Bases de la MESSAGERIE (tous rôles). La messagerie est un inbox MASTER-DETAIL
 * (liste de conversations + conversation ouverte dans le même écran). Ouvrir une
 * conversation passe l'URL à `…/messages/[id]` (replaceState, sans navigation) :
 * ce n'est PAS un drill-in « liste → détail », c'est toujours la page de menu
 * Messages. On considère donc TOUTE la section `…/messages[/…]` comme une route
 * de menu → pas de bouton Retour, ni sur la liste ni sur une conversation.
 */
const MESSAGING_BASES = [
  '/dashboard/freelance/messages',
  '/dashboard/cdi/messages',
  '/dashboard/entreprise/messages',
] as const

function isMessagingRoute(path: string): boolean {
  return MESSAGING_BASES.some((base) => path === base || path.startsWith(base + '/'))
}

/** Normalise un pathname : retire la query/hash et le slash final (sauf racine). */
function normalize(pathname: string): string {
  const clean = pathname.replace(/[?#].*$/, '')
  return clean.length > 1 ? clean.replace(/\/+$/, '') : clean
}

/**
 * `true` si le pathname courant est une page de MENU (entrée de sidebar) →
 * le bouton Retour global ne doit PAS s'y afficher. `false` = page de détail.
 */
export function isMenuRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  const path = normalize(pathname)
  return MENU_ROUTES.has(path) || isMessagingRoute(path)
}
