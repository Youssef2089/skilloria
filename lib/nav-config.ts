/**
 * SOURCE UNIQUE de la structure de navigation (sidebars) de toute l'app.
 *
 * Pourquoi ce fichier existe : le bouton Retour global ne doit jamais
 * apparaître sur une page de MENU (entrée de sidebar). Tant que la liste des
 * routes de menu était recopiée à la main dans lib/menu-routes.ts, chaque
 * nouvelle entrée de sidebar y était oubliée et faisait apparaître un Retour
 * parasite (cas vécu : /admin/packages).
 *
 * Désormais les sidebars ET lib/menu-routes.ts lisent CE fichier. Ajouter une
 * entrée ici la fait apparaître dans la sidebar ET la déclare comme route de
 * menu — la désynchronisation n'est plus possible.
 *
 * Consommateurs :
 *   - components/shell/DashboardSidebar.tsx  → dashboardNavSections()
 *   - app/[locale]/admin/layout.tsx          → ADMIN_NAV_SECTIONS
 *   - lib/menu-routes.ts                     → allMenuRoutes()
 *
 * Les chemins sont SANS préfixe de locale (format de `usePathname()` next-intl).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Dashboards (expert freelance / expert CDI / entreprise)
// ─────────────────────────────────────────────────────────────────────────────

export type DashboardSide = 'freelance' | 'entreprise' | 'cdi'

export type NavItem = {
  key: string
  href: string
  iconKey: string
  // A3 : deux sources DISTINCTES pour les candidatures —
  //   'candidatures'      = candidatures DÉPOSÉES par l'expert (côté candidat)
  //   'candidatures_org'  = candidatures REÇUES sur les pubs de l'org (côté
  //                         donneur d'ordre : entreprise OU expert publiant).
  // Elles ne doivent JAMAIS être sommées : un expert publiant a les deux
  // non-nulles (cf. hooks/useNavBadges).
  badgeSource?: 'messages' | 'candidatures' | 'candidatures_org' | 'missions'
  locked?: boolean
  variant?: 'default' | 'link'
}

export type NavSection = {
  sectionKey: string
  items: NavItem[]
}

/**
 * Sections de la sidebar dashboard. Fonction PURE : `userIsVerified` ne joue
 * que sur `locked` (jamais sur les href), ce qui permet de dériver les routes
 * de menu sans connaître l'état de l'utilisateur.
 */
export function dashboardNavSections(
  side: DashboardSide,
  opts: { userIsVerified: boolean },
): NavSection[] {
  const { userIsVerified } = opts

  if (side === 'entreprise') {
    return [
      {
        sectionKey: 'main',
        items: [
          { key: 'dashboard',         href: '/dashboard/entreprise',              iconKey: 'dashboard' },
          { key: 'annonces',          href: '/dashboard/entreprise/annonces',     iconKey: 'annonces' },
          { key: 'candidatures_org',  href: '/dashboard/entreprise/candidatures', iconKey: 'applications', badgeSource: 'candidatures_org' },
          { key: 'messages',          href: '/dashboard/entreprise/messages',     iconKey: 'messages', badgeSource: 'messages' },
        ],
      },
      {
        sectionKey: 'account',
        items: [
          { key: 'organisation', href: '/dashboard/entreprise/organisation', iconKey: 'organisation' },
          // Membres équipe : page livrée au Lot B (invitations). `locked`
          // retiré → lien actif normal. La route reste une route de MENU
          // (dérivée via allMenuRoutes) → aucun bouton Retour.
          { key: 'members',      href: '/dashboard/entreprise/membres',      iconKey: 'members' },
          // Ex-« Factures et paiements » → « Mon offre ». Stripe n'est pas
          // branché et `transactions` est indexée sur user_id (inexploitable
          // par org) : une page Factures n'aurait rien à afficher. On montre à
          // la place l'offre effective et sa consommation du mois.
          { key: 'offre',        href: '/dashboard/entreprise/offre',        iconKey: 'invoices' },
          { key: 'settings',     href: '/dashboard/entreprise/parametres',   iconKey: 'settings' },
        ],
      },
    ]
  }

  return [
    {
      sectionKey: 'main',
      items: [
        { key: 'dashboard',    href: `/dashboard/${side}`,              iconKey: 'dashboard' },
        { key: 'profile',      href: `/dashboard/${side}/mon-profil`,   iconKey: 'profile' },
        // Missions & Candidatures : ACCESSIBLES même profil non validé.
        //  - Candidatures = données propres de l'expert.
        //  - Missions = état vide propre tant que non validé (cf. page).
        // Seules les actions marché (alert/subcontract) restent lockées.
        { key: 'missions',     href: `/dashboard/${side}/missions`,     iconKey: 'missions',     badgeSource: 'missions' },
        { key: 'applications', href: `/dashboard/${side}/candidatures`, iconKey: 'applications', badgeSource: 'candidatures' },
        { key: 'messages',     href: `/dashboard/${side}/messages`,     iconKey: 'messages',     badgeSource: 'messages' },
      ],
    },
    {
      sectionKey: 'publish',
      items: [
        // Placeholder (alerte dispo) : pointe vers la racine (déjà route de menu).
        { key: 'alert',       href: `/dashboard/${side}`,                iconKey: 'alert',       variant: 'link', locked: !userIsVerified },
        // Collaboration experts — LIVRÉ : besoin de sous-traitance entre pairs.
        // Badge = candidatures REÇUES sur les besoins publiés (candidatures_org),
        // distinct de l'entrée « Candidatures » (déposées) ci-dessus.
        // C2 : VERROUILLÉE tant que le profil n'est pas vérifié — comme « Lancer
        // une alerte ». Publier un besoin exige un profil approved (garde serveur
        // dans ensure-org + la chaîne de publication ; ce lock est le miroir UI).
        { key: 'subcontract', href: `/dashboard/${side}/sous-traitance`, iconKey: 'subcontract', variant: 'link', badgeSource: 'candidatures_org', locked: !userIsVerified },
      ],
    },
    {
      sectionKey: 'account',
      items: [
        // C4 : entrée « Paiements » retirée du menu expert — les experts sont
        // GRATUITS par principe (Code du travail), la page n'existait pas (le
        // lien renvoyait au tableau de bord). Aucune route stub à supprimer
        // (l'href pointait sur la racine, pas sur un fichier dédié).
        { key: 'settings', href: `/dashboard/${side}/parametres`, iconKey: 'settings' },
      ],
    },
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// Back-office /admin
// ─────────────────────────────────────────────────────────────────────────────

export type AdminNavItem = {
  key: string
  href: string
  /** Clé i18n sous admin_back_office.sidebar. */
  labelKey: string
  iconKey: string
  /**
   * Préfixes supplémentaires qui rendent l'item actif (au-delà de son href).
   * Organisations est aussi l'écran servi par la racine /admin.
   */
  extraActivePaths?: string[]
}

export type AdminNavSection = {
  /** Clé i18n sous admin_back_office.sidebar. */
  sectionKey: string
  items: AdminNavItem[]
}

/** Racine du back-office : écran d'accueil, donc route de MENU. */
export const ADMIN_ROOT_ROUTE = '/admin'

export const ADMIN_NAV_SECTIONS: readonly AdminNavSection[] = [
  {
    sectionKey: 'section_validation',
    items: [
      {
        key: 'organisations',
        href: '/admin/organisations',
        labelKey: 'nav_organisations',
        iconKey: 'building',
        extraActivePaths: [ADMIN_ROOT_ROUTE],
      },
      { key: 'experts', href: '/admin/experts', labelKey: 'nav_experts', iconKey: 'user' },
    ],
  },
  {
    sectionKey: 'section_commerce',
    items: [
      { key: 'packages', href: '/admin/packages', labelKey: 'nav_packages', iconKey: 'package' },
    ],
  },
  {
    sectionKey: 'section_taxonomy',
    items: [
      { key: 'taxonomie', href: '/admin/taxonomie', labelKey: 'nav_taxonomie', iconKey: 'taxonomy' },
    ],
  },
] as const

// ─────────────────────────────────────────────────────────────────────────────
// Dérivation des routes de MENU (consommée par lib/menu-routes.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tous les href de sidebar, tous rôles confondus. `userIsVerified` est sans
 * effet sur les href : on passe `true` pour énumérer la structure complète.
 */
export function allMenuRoutes(): string[] {
  const dashboards = (['freelance', 'cdi', 'entreprise'] as const).flatMap((side) =>
    dashboardNavSections(side, { userIsVerified: true }).flatMap((s) => s.items.map((i) => i.href)),
  )
  const admin = ADMIN_NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href))
  return [...dashboards, ...admin, ADMIN_ROOT_ROUTE]
}
