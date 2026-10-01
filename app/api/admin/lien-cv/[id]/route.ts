import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { signerLienCv, DUREE_LIEN_CV_SECONDES } from '@/lib/profil/lien-cv'
import { contexteDepuisAuth } from '@/lib/journal/contexte'
import { JournalError } from '@/lib/journal/journaliser'
import { cvConsulte } from '@/lib/profil/journal-profil'

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
 *   500 { code: 'journal_error' }         la ligne du grand livre a été refusée — AUCUN lien rendu
 *
 * LE GRAND LIVRE (fusion de la recette S1, décision de Youssef, 01/10/2026) : ouvrir le CV d'un expert est LA SEULE
 * consultation qui s'écrit — un accès du personnel à une donnée personnelle (`cv_consulte`, détail vide). La ligne
 * s'écrit quand le lien est signé ; si elle est refusée, le lien n'est pas rendu (il expire seul en une minute) :
 * pas de lecture sans trace. Un CV absent ou un stockage en panne n'est pas une consultation : rien ne s'écrit.
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

  // La pièce du geste naît à son entrée, avant toute écriture (§D.26).
  const journal = contexteDepuisAuth(auth)
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
  try {
    await cvConsulte(auth.supabaseAdmin, journal, { profileId: id })
  } catch (err) {
    if (!(err instanceof JournalError)) throw err
    console.error('[admin:lien-cv] grand livre en échec — aucun lien rendu', { id, message: err.message })
    return json({ error: 'Journal failed', code: 'journal_error' }, 500)
  }
  return json({ url: lien.url, expire_dans: DUREE_LIEN_CV_SECONDES }, 200)
}
