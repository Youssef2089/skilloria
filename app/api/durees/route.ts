import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { chargerDurees, DUREES_ILLISIBLES_CODE } from '@/lib/durees'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/durees — LES DEUX DURÉES, POUR LES ÉCRANS QUI LES ANNONCENT.
 *
 * ═══ POURQUOI CETTE ROUTE EXISTE ════════════════════════════════════════════
 *   Le formulaire de publication annonce, au moment de valider : « votre
 *   annonce sera visible jusqu'au … ». C'est un composant CLIENT, rendu par des
 *   pages CLIENT : il n'y a aucun composant serveur dans la chaîne pour lui
 *   passer la valeur en propriété.
 *
 *   Il calculait donc la date avec la constante `PUBLICATION_TTL_DAYS = 30`,
 *   compilée dans le bundle. Une fois la durée réglable, cette constante aurait
 *   annoncé 30 jours pendant que le serveur en appliquait 20 — un mensonge dit
 *   à l'utilisateur à la seconde exacte où il s'engage.
 *
 *   La règle du lot tient donc quand même : LA LECTURE EST FAITE PAR UNE ROUTE.
 *   Le client ne décide de rien, il affiche ce que celle-ci lui dit — et s'il
 *   ne l'a pas, il n'écrit pas la phrase (cf. PublicationForm). Aucun repli.
 *
 * ═══ CE QUE CETTE ROUTE NE FAIT PAS ═════════════════════════════════════════
 *   Elle ne règle rien. Le réglage vit sur /api/admin/durees, derrière la garde
 *   admin, avec le comptage de rétroactivité et la trace d'audit.
 *
 * Garde : requireAuth. Ces durées sont une règle produit, pas un secret — mais
 * le projet ne rend publiques que les routes qui doivent l'être (pays,
 * taxonomie, OTP, inscription), et celle-ci n'en fait pas partie.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const lecture = await chargerDurees(auth.supabaseAdmin)
  if (!lecture.ok) {
    console.error('[durees:GET] lecture en échec', lecture.raison)
    return json({ error: 'Durations unavailable', code: DUREES_ILLISIBLES_CODE }, 503)
  }

  return json({
    vie_annonce_jours: lecture.durees.vieAnnonceJours,
    fenetre_echange_jours: lecture.durees.fenetreEchangeJours,
  })
}
