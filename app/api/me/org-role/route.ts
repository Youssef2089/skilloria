import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/me/org-role — rôle de l'utilisateur courant dans son organisation
 * active (viewer | editor | admin), ou null s'il n'a pas d'organisation.
 *
 * Sert au masquage PRÉVENTIF des actions côté UI (C7) : un viewer ne doit pas
 * voir « Publier / Débloquer / Sélectionner / Refuser ». ⚠️ Ce n'est QU'UN
 * CONFORT — la garantie reste la garde serveur `requireOrgRole` sur chaque
 * route d'écriture (checklist #20). Ne jamais s'appuyer sur ce endpoint pour
 * la sécurité.
 */
export async function GET(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  return new Response(
    JSON.stringify({ role_in_org: auth.organization?.role_in_org ?? null }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}
