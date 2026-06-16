import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { requireReauth } from '@/lib/reauth-token'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const GRACE_DAYS = 90

/**
 * POST /api/me/account/delete — PROGRAMMER la suppression (mission S3,
 * section 7). Ré-auth EXIGÉE + confirmation forte côté UI.
 *
 * Effets (propres, awaités, idempotents) :
 *   1. users.deletion_scheduled_at = now() + 90 j (grâce RGPD).
 *   2. RETRAIT IMMÉDIAT du matching/visibilité via le DRAPEAU EXISTANT
 *      profiles.visible = false (lu par lib/matching/shared.ts — on ne
 *      touche PAS la logique de matching). Snapshot dans pre_deletion_visible
 *      pour restaurer fidèlement à la réactivation.
 *   La connexion reste possible pour réactiver tant que la grâce court.
 *   La purge effective (anonymisation) est faite plus tard par le cron.
 * Borné à auth.uid().
 */
export async function POST(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const reauthFail = requireReauth(request, auth.user.id)
  if (reauthFail) return reauthFail

  const { data: userRow, error: userErr } = await auth.supabaseAdmin
    .from('users')
    .select('deletion_scheduled_at, anonymized_at')
    .eq('id', auth.user.id)
    .maybeSingle()
  if (userErr || !userRow) {
    return json({ error: 'User not found', code: 'user_missing' }, 404)
  }
  if (userRow.anonymized_at) {
    return json({ error: 'Account already anonymized', code: 'already_anonymized' }, 409)
  }
  // Idempotent : déjà programmé → on renvoie la date existante.
  if (userRow.deletion_scheduled_at) {
    return json({ ok: true, deletion_scheduled_at: userRow.deletion_scheduled_at }, 200)
  }

  const scheduledAt = new Date(Date.now() + GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // 1. Profil → invisible immédiatement (priorité : retrait du matching).
  //    Snapshot protégé contre un double-run : si pre_deletion_visible existe
  //    déjà (run partiel précédent), on le conserve plutôt que d'écraser.
  const { data: profRow, error: profSelErr } = await auth.supabaseAdmin
    .from('profiles')
    .select('id, visible, pre_deletion_visible')
    .eq('user_id', auth.user.id)
    .maybeSingle()
  if (profSelErr) {
    console.error('[account/delete] profile select failed', profSelErr.message)
    return json({ error: 'Could not schedule deletion', code: 'db_error' }, 500)
  }
  if (profRow) {
    const snapshot =
      profRow.pre_deletion_visible !== null && profRow.pre_deletion_visible !== undefined
        ? profRow.pre_deletion_visible
        : profRow.visible
    const { error: profUpdErr } = await auth.supabaseAdmin
      .from('profiles')
      .update({
        visible: false,
        pre_deletion_visible: snapshot,
        deletion_scheduled_at: scheduledAt,
      })
      .eq('id', profRow.id)
    if (profUpdErr) {
      console.error('[account/delete] profile update failed', profUpdErr.message)
      return json({ error: 'Could not schedule deletion', code: 'db_error' }, 500)
    }
  }

  // 2. User → marqueur de grâce.
  const { error: userUpdErr } = await auth.supabaseAdmin
    .from('users')
    .update({ deletion_scheduled_at: scheduledAt })
    .eq('id', auth.user.id)
  if (userUpdErr) {
    console.error('[account/delete] user update failed', userUpdErr.message)
    return json({ error: 'Could not schedule deletion', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.user.domain_id,
    action: 'account_deletion_scheduled',
    entity_type: 'user',
    entity_id: auth.user.id,
    detail: { deletion_scheduled_at: scheduledAt, grace_days: GRACE_DAYS },
  })

  return json({ ok: true, deletion_scheduled_at: scheduledAt }, 200)
}
