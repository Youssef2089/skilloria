import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { requireReauth } from '@/lib/reauth-token'
import { logAudit } from '@/lib/audit'
import { generateSessionToken, setSessionToken } from '@/lib/session-token'
import {
  loadAdminActionTarget,
  refuseAdminActionOnTarget,
  refusalHttpStatus,
} from '@/lib/admin/user-actions-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/user-revoke-session — FORCER LA DÉCONNEXION d'un compte.
 *
 * Body : { user_id }
 * Header : `x-reauth-token` obligatoire.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ LA ROTATION, JAMAIS L'EFFACEMENT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `clearSessionToken()` porte le nom de ce qu'on veut faire, et fait
 * l'inverse. Il met `users.last_session_token` à NULL ; or le garde de session
 * est écrit `if (userRow.last_session_token) { … }` (lib/auth-guard.ts,
 * compatibilité ascendante D4). Une valeur NULL **DÉSACTIVE la vérification**
 * au lieu de la faire échouer : la session en cours survivrait et cesserait
 * même d'être contrôlée. Ce serait une régression de sécurité présentée à
 * l'administrateur comme une déconnexion.
 *
 * On ROTE : `setSessionToken()` avec un jeton neuf que l'on ne transmet à
 * personne. Le cookie détenu par le navigateur ne peut plus correspondre →
 * tous les appareils tombent en `session_superseded` au prochain appel, et
 * lib/secure-fetch les redirige proprement. C'est le mécanisme éprouvé de
 * /api/me/sessions/revoke-others, sans la ré-émission de cookie (ici, aucun
 * appareil ne doit survivre).
 *
 * NE CHANGE PAS LE STATUT. Révoquer n'est pas suspendre : le compte peut se
 * reconnecter immédiatement. C'est l'outil du support (« déconnectez-moi de
 * partout, j'ai perdu mon téléphone »), pas une sanction. La suspension, elle,
 * rote AUSSI le jeton — cf. /api/admin/user-status.
 *
 * GARDES : jamais sur soi-même (un administrateur se déconnecte par le bouton
 * de déconnexion), jamais sur un autre administrateur, jamais zéro admin actif.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const reauthFail = requireReauth(request, auth.user.id)
  if (reauthFail) return reauthFail

  let body: { user_id?: unknown }
  try {
    body = (await request.json()) as { user_id?: unknown }
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }
  const targetId = typeof body.user_id === 'string' ? body.user_id : ''
  if (!UUID_REGEX.test(targetId)) {
    return json({ error: 'user_id is required', code: 'invalid_body' }, 400)
  }

  const target = await loadAdminActionTarget(auth.supabaseAdmin, targetId)
  const refusal = await refuseAdminActionOnTarget({
    supabaseAdmin: auth.supabaseAdmin,
    adminUserId: auth.user.id,
    target,
  })
  if (refusal) {
    return json({ error: refusal.message, code: refusal.code }, refusalHttpStatus(refusal))
  }
  const t = target!

  const rot = await setSessionToken({
    supabaseAdmin: auth.supabaseAdmin,
    userId: t.id,
    token: generateSessionToken(),
  })
  if (!rot.ok) {
    console.error('[admin:user-revoke-session] rotation failed', { targetId: t.id })
    return json({ error: 'Could not rotate session', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.user.domain_id,
    action: 'user_session_revoked',
    entity_type: 'user',
    entity_id: t.id,
    detail: { target_domain_id: t.domain_id, target_user_type: t.user_type },
    request,
  })

  return json({ ok: true, user_id: t.id }, 200)
}
