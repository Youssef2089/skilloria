import type { NextRequest } from 'next/server'
import { deposerCv } from '@/lib/profil/depot-cv'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// La route ne fait plus que vérifier, stocker et déposer : l'analyse (analyseur CDI,
// champs `cdi_*`) tourne sous l'exécutant des travaux d'IA (§D.30).
export const maxDuration = 30

/**
 * POST /api/profile/cdi-upload-cv — le dépôt d'un CV (ou de l'export PDF LinkedIn) par un
 * expert CDI. La porte ; le geste vit dans `lib/profil/depot-cv.ts`, partagé avec la voie
 * freelance : les deux routes portaient la même écriture non atomique, et l'ARRÊT 18 n'en
 * avait corrigé qu'une (§E.20). L'exécutant choisit l'analyseur par le type du compte.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return deposerCv(request, 'expert_cdi')
}
