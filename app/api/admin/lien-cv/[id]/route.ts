import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { signerLienCv, DUREE_LIEN_CV_SECONDES } from '@/lib/profil/lien-cv'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/lien-cv/[id] — un lien de LECTURE vers le CV déposé par un expert,
 * signé au clic, valable une minute (recette staging du 01/10/2026, point 14).
 *
 * `[id]` est l'identifiant du PROFIL, comme pour /api/admin/get-expert/[id].
 *
 * Le bucket `cv` reste privé et fermé au navigateur : la seule URL qui existe est
 * celle-ci, signée par le serveur pour un administrateur (lib/profil/lien-cv.ts). Elle
 * est demandée AU CLIC plutôt que servie avec la fiche — une URL glissée dans la fiche
 * aurait expiré pendant que l'administrateur lisait le reste du dossier.
 *
 * Réponses :
 *   200 { url, expire_dans }    le lien
 *   404 { code: 'cv_absent' }   aucun CV déposé (ou l'objet n'existe plus)
 *   404 { code: 'not_found' }   aucun profil sous cet identifiant
 *   503 { code: 'lien_cv_indisponible' }  le stockage ou la base n'a pas répondu — à réessayer
 *
 * ⚠️ AUCUNE ÉCRITURE ICI. Une consultation de CV par un administrateur n'est pas
 *    journalisée : le grand livre appartient à un autre lot, et l'écriture qu'elle
 *    mériterait est signalée dans le livrable de la recette (docs/reprise-s1.md).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: RouteContext): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { id } = await ctx.params
  if (!id || !UUID_REGEX.test(id)) {
    return json({ error: 'Invalid id', code: 'invalid_id' }, 400)
  }

  const { data, error } = await auth.supabaseAdmin
    .from('profiles')
    .select('cv_file_path')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    // Une lecture en échec n'est pas « aucun CV » (§E.22) : on le dit, et on se réessaie.
    console.error('[admin:lien-cv] lecture du profil en échec', { id, message: error.message })
    return json({ error: 'Profile unavailable', code: 'lien_cv_indisponible' }, 503)
  }
  if (!data) return json({ error: 'Not found', code: 'not_found' }, 404)

  const lien = await signerLienCv(auth.supabaseAdmin, (data as { cv_file_path: string | null }).cv_file_path)
  if (lien.etat === 'absent') return json({ error: 'No CV', code: 'cv_absent' }, 404)
  if (lien.etat === 'indisponible') return json({ error: 'Storage unavailable', code: 'lien_cv_indisponible' }, 503)
  return json({ url: lien.url, expire_dans: DUREE_LIEN_CV_SECONDES }, 200)
}
