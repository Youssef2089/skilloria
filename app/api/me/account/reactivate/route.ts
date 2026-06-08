import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * POST /api/me/account/reactivate — RÉACTIVER pendant la grâce (mission S3,
 * section 7). Restaure le compte : re-actif, re-visible, re-matché.
 *
 * Allowlistée dans auth-guard (accessible MÊME en état « suppression
 * programmée »). Pas de ré-auth (opération restauratrice, l'user est déjà
 * authentifié). Idempotente. Borné à auth.uid().
 */
export async function POST(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { data: userRow, error: userErr } = await auth.supabaseAdmin
    .from('users')
    .select('deletion_scheduled_at, anonymized_at')
    .eq('id', auth.user.id)
    .maybeSingle()
  if (userErr || !userRow) {
    return json({ error: 'User not found', code: 'user_missing' }, 404)
  }
  // Trop tard : déjà purgé/anonymisé → irréversible.
  if (userRow.anonymized_at) {
    return json({ error: 'Account already anonymized', code: 'already_anonymized' }, 410)
  }
  // Idempotent : pas en cours de suppression → déjà actif.
  if (!userRow.deletion_scheduled_at) {
    return json({ ok: true, reactivated: false }, 200)
  }

  // Restaure la visibilité au niveau d'AVANT la programmation (snapshot).
  const { data: profRow, error: profSelErr } = await auth.supabaseAdmin
    .from('profiles')
    .select('id, pre_deletion_visible')
    .eq('user_id', auth.user.id)
    .maybeSingle()
  if (profSelErr) {
    console.error('[account/reactivate] profile select failed', profSelErr.message)
    return json({ error: 'Could not reactivate', code: 'db_error' }, 500)
  }
  if (profRow) {
    const restoreVisible =
      profRow.pre_deletion_visible === null || profRow.pre_deletion_visible === undefined
        ? true
        : profRow.pre_deletion_visible
    const { error: profUpdErr } = await auth.supabaseAdmin
      .from('profiles')
      .update({
        visible: restoreVisible,
        pre_deletion_visible: null,
        deletion_scheduled_at: null,
      })
      .eq('id', profRow.id)
    if (profUpdErr) {
      console.error('[account/reactivate] profile update failed', profUpdErr.message)
      return json({ error: 'Could not reactivate', code: 'db_error' }, 500)
    }
  }

  const { error: userUpdErr } = await auth.supabaseAdmin
    .from('users')
    .update({ deletion_scheduled_at: null })
    .eq('id', auth.user.id)
  if (userUpdErr) {
    console.error('[account/reactivate] user update failed', userUpdErr.message)
    return json({ error: 'Could not reactivate', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.user.domain_id,
    action: 'account_reactivated',
    entity_type: 'user',
    entity_id: auth.user.id,
  })

  return json({ ok: true, reactivated: true }, 200)
}
