import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/me/account/status — état du cycle de vie suppression (mission S3).
 *
 * Allowlistée dans auth-guard (accessible en état « suppression programmée »).
 * Sert à l'écran de réactivation et au gate client (DeletionGate) pour savoir
 * s'il faut rediriger vers /reactivation. Borné à auth.uid().
 */
export async function GET(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { data: userRow, error } = await auth.supabaseAdmin
    .from('users')
    .select('deletion_scheduled_at, anonymized_at')
    .eq('id', auth.user.id)
    .maybeSingle()
  if (error || !userRow) {
    return new Response(JSON.stringify({ error: 'User not found', code: 'user_missing' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  }

  return new Response(
    JSON.stringify({
      deletion_scheduled_at: userRow.deletion_scheduled_at ?? null,
      anonymized_at: userRow.anonymized_at ?? null,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}
