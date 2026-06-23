'use client'

import { useEffect, useState } from 'react'
import CandidatureDetailView from '@/components/dashboard/CandidatureDetailView'

/**
 * /dashboard/cdi/candidatures/[id] — page de détail d'une candidature (wrapper
 * thin, miroir exact de freelance/candidatures/[id]). side='cdi'. Passe par
 * DashboardShell → bouton Retour global automatique.
 */

type Props = { params: Promise<{ id: string }> }

export default function CdiCandidatureDetailPage({ params }: Props) {
  const [id, setId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const p = await params
      if (cancelled) return
      setId(p.id)
    })()
    return () => { cancelled = true }
  }, [params])

  return <CandidatureDetailView candidatureId={id} side="cdi" />
}
