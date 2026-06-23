'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { usePathname } from '@/i18n/navigation'
import { isSafeInternalPath } from '@/lib/auth-routing'

/**
 * NavHistoryProvider — pile d'historique de navigation INTERNE (par onglet).
 *
 * Source unique du bouton « Retour » global (GlobalBackButton). Monté une seule
 * fois tout en haut (app/[locale]/layout.tsx) : il tourne donc sur CHAQUE route
 * (dashboard expert FL/CDI + entreprise + admin + pages publiques) et maintient
 * la pile à jour quelle que soit la coquille traversée.
 *
 * RÈGLE (à chaque changement de pathname) :
 *   - pile.length >= 2 ET pathname === pile[len-2]  → l'utilisateur est revenu
 *     en arrière → on retire le dernier (pop). C'est ce qui évite le ping-pong :
 *     le clic Retour fait router.push(cible), la route change, et le pop se fait
 *     tout seul ici — pas besoin de muter la pile dans le bouton.
 *   - sinon si pathname !== pile[len-1]              → navigation avant → push.
 *   - sinon (même page)                              → rien.
 *
 * Cible du Retour = pile[len-2] (null si pile < 2).
 *
 * INTERNE UNIQUEMENT : on n'empile que des chemins internes valides
 * (isSafeInternalPath). usePathname() (next-intl) renvoie le chemin SANS la
 * query string ni le préfixe de locale → un simple changement de `?param` ne
 * change pas le pathname, donc l'effet ne se redéclenche pas (pas de faux
 * niveaux). Aucun router.back() n'est jamais utilisé côté bouton (anti-sortie
 * vers l'extérieur / Gmail) : on push toujours un chemin interne de la pile.
 *
 * Persistance : sessionStorage (isolé par onglet). Au montage, on hydrate depuis
 * sessionStorage puis on applique la règle au pathname courant.
 */

const STORAGE_KEY = 'sk_nav_stack'

const NavHistoryContext = createContext<{ backTarget: string | null }>({
  backTarget: null,
})

export function useNavHistory() {
  return useContext(NavHistoryContext)
}

export default function NavHistoryProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [backTarget, setBackTarget] = useState<string | null>(null)
  const stackRef = useRef<string[]>([])
  const loadedRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!isSafeInternalPath(pathname)) return

    let stack = stackRef.current

    // Hydratation paresseuse depuis sessionStorage (premier passage seulement).
    if (!loadedRef.current) {
      loadedRef.current = true
      try {
        const raw = window.sessionStorage.getItem(STORAGE_KEY)
        const parsed = raw ? JSON.parse(raw) : []
        stack = Array.isArray(parsed) ? parsed.filter(isSafeInternalPath) : []
      } catch {
        stack = []
      }
    }

    let next = stack
    if (stack.length >= 2 && pathname === stack[stack.length - 2]) {
      // Retour en arrière → pop.
      next = stack.slice(0, -1)
    } else if (stack.length === 0 || pathname !== stack[stack.length - 1]) {
      // Navigation avant → push.
      next = [...stack, pathname]
    }
    // sinon (même page) : on ne touche à rien.

    if (next !== stack) {
      stackRef.current = next
      try {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* quota / mode privé : on ignore, la pile en mémoire reste valide */
      }
    }

    const target = next.length >= 2 ? next[next.length - 2] : null
    setBackTarget((prev) => (prev === target ? prev : target))
  }, [pathname])

  return (
    <NavHistoryContext.Provider value={{ backTarget }}>
      {children}
    </NavHistoryContext.Provider>
  )
}
