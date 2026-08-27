import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { ensurePersonalOrg } from '@/lib/collaboration/ensure-personal-org'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/me/collaboration/ensure-org — CRÉATION LAZY de l'organisation
 * PERSONNELLE d'un expert (Collaboration / Sous-traitance, Option A).
 *
 * ⚠️ CETTE ROUTE N'EST PLUS APPELÉE AU CHARGEMENT DES ÉCRANS.
 *   Elle l'était, et tout expert vérifié qui ouvrait « Sous-traitance » par
 *   curiosité repartait avec une organisation en base. La création se fait
 *   désormais au moment de PUBLIER, dans POST /api/publications, via le même
 *   helper. La route reste exposée comme point d'entrée explicite (outillage,
 *   rattrapage manuel) — mais aucun écran ne la déclenche plus tout seul.
 *
 * Toute la logique — gardes, idempotence, transaction avec cleanup atomique,
 * rattachement à l'offre par défaut — vit dans
 * lib/collaboration/ensure-personal-org.ts, partagée avec la publication. Rien
 * n'est dupliqué : cette route ne fait que traduire le résultat en HTTP.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const res = await ensurePersonalOrg(auth.supabaseAdmin, auth.user.id, {
    userDomainId: auth.user.domain_id,
    auditDomainId: auth.domain.id,
  })
  if (!res.ok) {
    return json({ error: res.message, code: res.code }, res.status)
  }
  return json({ ok: true, organization_id: res.organizationId, created: res.created }, 200)
}
