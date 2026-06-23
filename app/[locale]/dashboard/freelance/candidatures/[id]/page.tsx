'use client'

import { useEffect, useState } from 'react'
import CandidatureDetailView from '@/components/dashboard/CandidatureDetailView'

/**
 * /dashboard/freelance/candidatures/[id] — page de détail d'une candidature
 * (wrapper thin, miroir de missions/[id]). Toute la logique vit dans
 * CandidatureDetailView ; ce wrapper passe side='freelance' + l'id résolu.
 * Passe par DashboardShell → le bouton Retour global s'affiche automatiquement.
 */

type Props = { params: Promise<{ id: string }> }

export default function FreelanceCandidatureDetailPage({ params }: Props) {
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

  return <CandidatureDetailView candidatureId={id} side="freelance" />
}
