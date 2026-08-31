import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/get-user/[id]/sessions — FRISE UNIFIÉE d'un compte.
 *
 * POURQUOI UNE SEULE FRISE, ET PAS DEUX LISTES
 *   Le cahier des charges (4.10) demande de « visualiser les dernières
 *   connexions » ET « d'historiser les invalidations de session ». Les deux
 *   faits vivent dans deux tables — `session_logs` pour les connexions,
 *   `audit_logs` pour les révocations — mais ils racontent UNE histoire :
 *   celle des accès de ce compte. Servir deux listes obligerait l'administrateur
 *   à les recouper mentalement, avec le risque de lire une déconnexion forcée
 *   comme antérieure à une connexion qu'elle a en fait interrompue.
 *   On fusionne donc côté SERVEUR et on trie par date décroissante.
 *
 * AUCUNE TABLE CRÉÉE. `session_logs` existe depuis l'origine, indexée sur
 * (user_id, login_at DESC), et `logSession` l'alimente à chaque connexion.
 * Les invalidations sont des lignes d'`audit_logs` — le mécanisme de traçage
 * déjà en place, pas un second journal.
 *
 * PAS DE SECRET. `session_logs.session_token` n'est plus écrite depuis le lot
 * C2 (elle vaut NULL) et n'est de toute façon pas sélectionnée ici.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/** Actions d'`audit_logs` qui décrivent une invalidation de session. */
const SESSION_AUDIT_ACTIONS = [
  'user_session_revoked',
  'user_suspended',
  'sessions_revoked_others',
] as const

const LIMIT_DEFAULT = 25
const LIMIT_MAX = 100

type Ctx = { params: Promise<{ id: string }> }

export type SessionTimelineEntry = {
  kind: 'login' | 'revocation'
  at: string
  ip_address: string | null
  user_agent: string | null
  /** Pour `revocation` : l'action d'audit exacte. */
  action?: string
  /** Pour `revocation` : l'auteur est-il le compte lui-même ou un admin ? */
  by_self?: boolean
}

export async function GET(request: NextRequest, ctx: Ctx): Promise<Response> {
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

  const url = new URL(request.url)
  const parsed = Number.parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, LIMIT_MAX) : LIMIT_DEFAULT

  // On lit `limit` de chaque source puis on fusionne et on retaille : le
  // mélange des deux flux ne peut pas produire moins que le plus récent des
  // deux, et on ne charge jamais plus que nécessaire.
  const [loginsRes, revocationsRes, loginCountRes] = await Promise.all([
    auth.supabaseAdmin
      .from('session_logs')
      .select('id, login_at, ip_address, user_agent')
      .eq('user_id', id)
      .order('login_at', { ascending: false })
      .limit(limit),
    auth.supabaseAdmin
      .from('audit_logs')
      .select('id, action, created_at, ip_address, user_agent, user_id')
      .eq('entity_type', 'user')
      .eq('entity_id', id)
      .in('action', SESSION_AUDIT_ACTIONS as unknown as string[])
      .order('created_at', { ascending: false })
      .limit(limit),
    auth.supabaseAdmin
      .from('session_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', id),
  ])

  if (loginsRes.error) {
    console.error('[admin:get-user/sessions] session_logs failed', loginsRes.error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (revocationsRes.error) {
    console.error('[admin:get-user/sessions] audit_logs failed', revocationsRes.error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  const entries: SessionTimelineEntry[] = [
    ...((loginsRes.data ?? []) as Array<{
      login_at: string
      ip_address: string | null
      user_agent: string | null
    }>).map((l) => ({
      kind: 'login' as const,
      at: l.login_at,
      ip_address: l.ip_address,
      user_agent: l.user_agent,
    })),
    ...((revocationsRes.data ?? []) as Array<{
      action: string
      created_at: string
      ip_address: string | null
      user_agent: string | null
      user_id: string
    }>).map((a) => ({
      kind: 'revocation' as const,
      at: a.created_at,
      ip_address: a.ip_address,
      user_agent: a.user_agent,
      action: a.action,
      // `audit_logs.user_id` est l'AUTEUR de l'action. Égal à la cible ⇒ le
      // compte s'est déconnecté lui-même de ses autres appareils ; différent ⇒
      // un administrateur est intervenu. La nuance compte pour le support.
      by_self: a.user_id === id,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

  const visible = entries.slice(0, limit)

  return json({
    entries: visible,
    /** Nombre TOTAL de connexions — `0` prouve « jamais connecté ». */
    login_count: loginCountRes.count ?? 0,
    has_more: entries.length > visible.length,
    limit,
  })
}
