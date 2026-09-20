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
  // L'écran de grâce lit ce statut pour décider quoi afficher. Une panne rendue
  // 404 se lisait « compte actif » (§E.42) — l'écran doit pouvoir dire « je ne
  // sais pas », donc le code doit le lui dire.
  if (error) {
    console.error('[me/account/status] compte ILLISIBLE', { userId: auth.user.id, message: error.message })
    return new Response(
      JSON.stringify({ error: 'Could not read the account', code: 'compte_verification_indisponible' }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    )
  }
  if (!userRow) {
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
