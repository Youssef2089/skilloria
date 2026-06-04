'use client'

import { useEffect, useState } from 'react'
import MissionDetailView from '@/components/dashboard/MissionDetailView'

/**
 * /dashboard/cdi/missions/[id] — wrapper thin (SC7b Lot UX Finitions 2,
 * miroir freelance). MissionDetailView avec side='cdi' rebase les liens vers
 * /dashboard/cdi/missions. CandidatureModal et POST /api/candidatures restent
 * intacts (un seul endpoint pour mission et offre).
 */

type Props = { params: Promise<{ id: string }> }

export default function CdiMissionDetailPage({ params }: Props) {
  const [pubId, setPubId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const p = await params
      if (cancelled) return
      setPubId(p.id)
    })()
    return () => { cancelled = true }
  }, [params])

  return <MissionDetailView pubId={pubId} side="cdi" />
}
