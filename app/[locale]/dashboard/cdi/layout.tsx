'use client'

/**
 * Sub-layout CDI — TEMPORAIRE : pass-through pendant le commit A.
 *
 * La page cdi/page.tsx contient encore son propre shell inline (sidebar +
 * topbar). Le DashboardShell sera activé ici lors du commit B (pages expert)
 * après refacto de cdi/page.tsx pour ne plus dupliquer le shell.
 */
export default function CdiLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
