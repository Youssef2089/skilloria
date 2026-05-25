'use client'

import SessionHeartbeat from '@/components/SessionHeartbeat'

/**
 * Layout commun à TOUTES les routes /dashboard/* (entreprise, freelance,
 * cdi + leurs sous-pages profil / mon-profil / valider).
 *
 * Rôle UNIQUE en V1 : monter `<SessionHeartbeat />` qui déclenche la
 * vérification 11F (session unique) toutes les 60s via
 * `GET /api/auth/check-session`. Sans ce heartbeat, les dashboards
 * (qui consomment leurs données via Supabase RLS direct, pas d'appel
 * /api/* protégé) restent un angle mort de la session unique.
 *
 * Toute nouvelle page ajoutée sous `dashboard/*` héritera automatiquement
 * de ce layout → couverture session unique automatique, zéro risque
 * d'oubli pour les futures pages.
 *
 * Pas de wrapper visuel : on rend `{children}` directement pour ne pas
 * impacter le layout actuel des dashboards (chacun gère son propre
 * sidebar / header).
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <SessionHeartbeat />
      {children}
    </>
  )
}
