import type { NextRequest } from 'next/server'
import { deposerCv } from '@/lib/profil/depot-cv'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// La route ne fait plus que vérifier, stocker et déposer : l'analyse tourne sous
// l'exécutant des travaux d'IA (§D.30). Plus aucun travail long ici.
export const maxDuration = 30

/**
 * POST /api/profile/upload-cv — le dépôt d'un CV (ou de l'export PDF LinkedIn) par un
 * expert FREELANCE. La porte ; le geste vit dans `lib/profil/depot-cv.ts`, partagé avec
 * la voie CDI (§E.20).
 */
export async function POST(request: NextRequest): Promise<Response> {
  return deposerCv(request, 'expert_freelance')
}
