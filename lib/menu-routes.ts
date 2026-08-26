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
 * Bases de la MESSAGERIE (tous rôles).
 *
 * Les RACINES `…/messages` sont déjà des entrées de sidebar, donc déjà dans
 * MENU_ROUTES (cf. lib/nav-config.ts) : rien à ajouter pour elles.
 *
 * Reste `…/messages/[id]`, qui est AMBIGU — et c'est tout le sujet :
 *
 *   • Ouverte DEPUIS l'inbox, ce n'est pas un drill-in : le clic ne navigue
 *     pas, il fait un `replaceState`. On est toujours sur la page de menu
 *     Messages → aucun bouton Retour.
 *   • Ouverte depuis AILLEURS (détail d'une candidature, notification), c'est
 *     un vrai drill-in : sans bouton Retour, l'utilisateur est bloqué et doit
 *     repasser par le menu.
 *
 * Le même chemin recouvre donc deux situations opposées. Ce qui les distingue
 * n'est pas l'URL mais l'HISTORIQUE — d'où l'exposition de ce prédicat, que
 * GlobalBackButton applique à la cible de retour. Avant ce lot, toute la
 * section était classée « menu », ce qui condamnait le second cas.
 */
const MESSAGING_BASES = [
  '/dashboard/freelance/messages',
  '/dashboard/cdi/messages',
  '/dashboard/entreprise/messages',
] as const

/** `true` si le chemin appartient à la messagerie (racine ou conversation). */
export function isMessagingRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  const path = normalize(pathname)
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
  return MENU_ROUTES.has(normalize(pathname))
}
