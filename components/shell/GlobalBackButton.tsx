'use client'

import { useTranslations } from 'next-intl'
import { useRouter, usePathname } from '@/i18n/navigation'
import { deriveBackLabel, isSafeInternalPath } from '@/lib/auth-routing'
import { isMenuRoute, isMessagingRoute } from '@/lib/menu-routes'
import { useNavHistory } from './NavHistoryProvider'

/**
 * GlobalBackButton — bouton « Retour » UNIQUE de toute l'app.
 *
 * Rendu en tête de <main> de la coquille partagée (DashboardShell pour
 * FL/CDI/entreprise + leurs pages de détail) ET en tête du <main> admin. Même
 * composant, même pile (NavHistoryProvider).
 *
 *  - ne s'affiche QUE sur une page de DÉTAIL : si la page COURANTE est une
 *    page de MENU (entrée de sidebar, cf. isMenuRoute) → n'affiche RIEN. Fini
 *    le « Retour aux opportunités » planté sur le tableau de bord quand on
 *    bascule entre menus ;
 *  - cible = pile[len-2] (exposée via useNavHistory().backTarget) ;
 *  - si pas de cible (pile < 2 : arrivée directe, rechargement, lien profond,
 *    page d'origine) → n'affiche RIEN ;
 *  - libellé = t(deriveBackLabel(cible)) — les valeurs back_nav contiennent DÉJÀ
 *    la flèche « ← », on n'en re-préfixe aucune ;
 *  - au clic → router.push(cible) (jamais router.back() : interne uniquement).
 *    Le pop de la pile se fait tout seul au changement de route → pas de
 *    ping-pong.
 *
 * Style discret (lien/ghost), rendu pleine largeur au-dessus du PageHeader,
 * aligné sur le contenu (padding gauche cohérent) → ne casse aucun layout.
 */
export default function GlobalBackButton() {
  const { backTarget } = useNavHistory()
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations('back_nav')

  // Jamais de Retour sur une page de MENU (sidebar) : uniquement sur un détail.
  // Les racines `…/messages` en font partie (entrées de sidebar).
  if (isMenuRoute(pathname)) return null
  if (!backTarget || !isSafeInternalPath(backTarget)) return null

  // MESSAGERIE — `…/messages/[id]` est ambigu (cf. lib/menu-routes.ts) :
  //   • venu de l'inbox  → la cible de retour est elle-même dans la messagerie
  //     → ce n'est pas un drill-in, on n'affiche RIEN (comportement d'avant) ;
  //   • venu d'ailleurs  → la cible est hors messagerie (détail de candidature,
  //     notification) → c'est un vrai détail, l'utilisateur doit pouvoir
  //     revenir. Sans ce cas, il était bloqué et devait repasser par le menu.
  if (isMessagingRoute(pathname) && isMessagingRoute(backTarget)) return null

  const label = t(deriveBackLabel(backTarget) as 'back')

  return (
    <div style={{ padding: '14px 26px 0' }}>
      <button
        type="button"
        onClick={() => router.push(backTarget)}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--sk-accent, var(--sk-muted))',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          padding: 0,
          fontFamily: 'inherit',
        }}
      >
        {label}
      </button>
    </div>
  )
}
