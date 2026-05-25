'use client'

import { useEffect, useRef } from 'react'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * SessionHeartbeat — déclenche périodiquement la vérification 11F (session
 * unique) sur les pages connectées qui n'appellent autrement aucune route
 * /api/* protégée par requireAuth.
 *
 * Contexte : le mécanisme 11F (cookie ss_token vs users.last_session_token)
 * ne s'active que dans `requireAuth`. Or les dashboards consomment leurs
 * données via Supabase REST + RLS direct → aucune route protégée n'est
 * sollicitée → la session unique reste dormante sur ces écrans.
 *
 * Fix : ce composant pingue `GET /api/auth/check-session` toutes les 60s
 * via `secureFetch`. Comme `secureFetch` intercepte déjà le 403
 * `session_superseded` (purge supabase + redirect /connexion?reason=...),
 * il n'y a rien à gérer ici : si le user est éjecté, il est redirigé
 * automatiquement.
 *
 * Couverture :
 *   - Appel immédiat au mount (couvre le load initial — détecte un conflit
 *     posé pendant que la page n'était pas chargée)
 *   - Interval 60s ensuite (couvre les onglets restés ouverts)
 *   - Cleanup au unmount (clearInterval — pas de fuite)
 *
 * Période : 60s. Compromis réactivité (max 60s avant éjection)
 * vs charge serveur (60 req/h/user actif, très léger : 1 SELECT users).
 *
 * Aucun rendu — composant headless. À monter une fois par layout authentifié.
 */

const HEARTBEAT_INTERVAL_MS = 60_000

export default function SessionHeartbeat() {
  const secureFetch = useSecureFetch()
  // Stabilité de la ref : on évite que le useEffect ne re-run à chaque
  // re-render dû à useSecureFetch (qui retourne une nouvelle fonction si
  // domain.subdomain ou router change — rare mais possible).
  const secureFetchRef = useRef(secureFetch)
  secureFetchRef.current = secureFetch

  useEffect(() => {
    let cancelled = false

    const ping = async () => {
      if (cancelled) return
      try {
        await secureFetchRef.current('/api/auth/check-session', { method: 'GET' })
        // Pas besoin d'inspecter la réponse : secureFetch intercepte
        // automatiquement le 403 session_superseded (purge + redirect).
      } catch {
        /* swallow — un réseau coupé ponctuellement ne doit pas crasher l'app */
      }
    }

    // 1. Appel immédiat (couvre le load initial)
    void ping()

    // 2. Interval périodique (couvre les onglets restés ouverts)
    const intervalId = window.setInterval(() => void ping(), HEARTBEAT_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [])

  return null
}
