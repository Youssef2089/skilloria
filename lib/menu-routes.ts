/**
 * Liste blanche des routes de MENU (destinations de sidebar) de TOUS les rôles.
 *
 * Une page de MENU = une entrée de sidebar (tableau de bord, missions,
 * candidatures, messages, paramètres, annonces, etc.). Une page de DÉTAIL =
 * tout le reste sous un menu (missions/[id], annonces/[id], messages/[id], …).
 *
 * Source de vérité : la config de la sidebar.
 *   - Expert FL/CDI + Entreprise : components/shell/DashboardSidebar.tsx
 *     (tableau `sections[].items[].href`).
 *   - Admin : app/[locale]/admin/layout.tsx (liens `/admin/organisations`,
 *     `/admin/experts`, racine `/admin`).
 *
 * ⚠️ À garder synchronisé avec ces deux fichiers si un item de menu est
 * ajouté/retiré. On ne référence ici QUE les hrefs réels et distincts (les
 * items `alert`/`subcontract`/`payments` de la sidebar pointent vers la racine
 * `/dashboard/{side}` comme placeholder — déjà couverte par l'entrée dashboard).
 *
 * Les chemins sont SANS préfixe de locale (format de `usePathname()` next-intl).
 */

const EXPERT_MENU_SUFFIXES = [
  '',              // racine = tableau de bord
  '/mon-profil',
  '/missions',
  '/candidatures',
  '/messages',
  '/parametres',
] as const

function expertMenuRoutes(side: 'freelance' | 'cdi'): string[] {
  return EXPERT_MENU_SUFFIXES.map((suffix) => `/dashboard/${side}${suffix}`)
}

const ENTREPRISE_MENU_ROUTES = [
  '/dashboard/entreprise',
  '/dashboard/entreprise/annonces',
  '/dashboard/entreprise/candidatures',
  '/dashboard/entreprise/messages',
  '/dashboard/entreprise/organisation',
  '/dashboard/entreprise/membres',
  '/dashboard/entreprise/factures',
  '/dashboard/entreprise/parametres',
] as const

const ADMIN_MENU_ROUTES = [
  '/admin',
  '/admin/organisations',
  '/admin/experts',
] as const

/** Ensemble figé de toutes les routes de menu (tous rôles), pour test O(1). */
const MENU_ROUTES: ReadonlySet<string> = new Set<string>([
  ...expertMenuRoutes('freelance'),
  ...expertMenuRoutes('cdi'),
  ...ENTREPRISE_MENU_ROUTES,
  ...ADMIN_MENU_ROUTES,
])

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
