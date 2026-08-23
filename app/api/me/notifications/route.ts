import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/me/notifications — liste les notifications du user courant.
 *
 *  Garde : requireAuth → service_role.
 *  Tri : created_at DESC, limite 50.
 *  Retour : { notifications: [...], unread_count: N }
 *
 *  `unread_count` est un COUNT EXACT sur la table, PAS un filtre sur la page de
 *  50 : le compteur de la cloche plafonnait à 50 et mentait dès qu'un
 *  utilisateur actif dépassait ce seuil. La liste reste bornée à 50 (c'est un
 *  dropdown), le compteur non — ils répondent à deux questions différentes.
 *
 * POST /api/me/notifications/read-all — flip read_at sur toutes les non-lues.
 *  Idempotent. (Endpoint séparé en sous-route mais on regroupe ici pour
 *  simplicité — voir /[id]/read pour la lecture unitaire.)
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

  const [listResult, unreadResult] = await Promise.all([
    auth.supabaseAdmin
      .from('notifications')
      .select('id, type, title, body, link_url, entity_id, status, channel, read_at, created_at')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(50),
    auth.supabaseAdmin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', auth.user.id)
      .is('read_at', null),
  ])
  if (listResult.error) {
    console.error('[me/notifications:GET] query failed', listResult.error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const notifications = (listResult.data ?? []) as Array<{ id: string; type: string; title: string | null; body: string | null; link_url: string | null; entity_id: string | null; status: string; channel: string; read_at: string | null; created_at: string }>
  // Repli best-effort si le COUNT échoue : mieux vaut le compteur borné de la
  // page servie qu'une cloche muette. L'erreur est tracée.
  if (unreadResult.error) {
    console.error('[me/notifications:GET] unread count failed', unreadResult.error.message)
  }
  const unread_count = unreadResult.error
    ? notifications.filter((n) => n.read_at === null).length
    : (unreadResult.count ?? 0)

  return json({ notifications, unread_count }, 200)
}

/**
 * POST /api/me/notifications — marque des notifications comme lues.
 *
 * Body optionnel `{ ids?: string[] }` (C8 — correctif « notifs effacées sans
 * avoir été vues ») :
 *   - ids fourni  → ne marque QUE ces notifications (celles réellement
 *     AFFICHÉES par le client au moment du clic). Une notif arrivée après le
 *     dernier fetch n'est donc jamais marquée lue par un clic qui ne l'a pas
 *     montrée.
 *   - ids absent  → marque tout le non-lu (action EXPLICITE « Tout marquer
 *     lu »). C'est une décision volontaire de l'utilisateur, pas un effet de
 *     bord de l'ouverture du dropdown.
 * Toujours scopé à `user_id = auth.user.id`.
 */
export async function POST(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  let ids: string[] | null = null
  try {
    const body = (await request.json().catch(() => null)) as { ids?: unknown } | null
    if (body && Array.isArray(body.ids)) {
      ids = body.ids.filter((v): v is string => typeof v === 'string')
    }
  } catch {
    /* body vide/non-JSON → traité comme « tout marquer lu » */
  }

  // ids=[] explicite → rien à marquer (évite un UPDATE global accidentel).
  if (ids !== null && ids.length === 0) {
    return json({ ok: true, marked: 0 }, 200)
  }

  const nowIso = new Date().toISOString()
  let query = auth.supabaseAdmin
    .from('notifications')
    .update({ read_at: nowIso, status: 'read' })
    .eq('user_id', auth.user.id)
    .is('read_at', null)
  if (ids !== null) {
    query = query.in('id', ids)
  }
  const { error } = await query
  if (error) {
    console.error('[me/notifications:POST] read update failed', error.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }
  return json({ ok: true }, 200)
}
