import { NextRequest } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth-guard'
import { signAvatarUrl } from '@/lib/avatar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/me/avatar-url — retourne une URL signée (300s) de la PROPRE photo
 * de l'utilisateur authentifié, ou { url: null } s'il n'en a pas.
 *
 * Gate triviale et non contournable : on ne signe QUE `auth.user.id`. Aucun
 * user_id n'est lu depuis le body — impossible de demander la photo d'autrui
 * par ce endpoint (le contexte org/admin passe par les DTO serveur dédiés).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { supabaseAdmin, user } = auth

  // Présence de photo : photo_url est désormais un chemin ('<uid>/avatar.jpg')
  // servant de flag. Absent => pas de photo => url null (front : fallback).
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('photo_url')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error || !profile?.photo_url) {
    return json({ url: null }, 200)
  }

  return json({ url: await signAvatarUrl(supabaseAdmin, user.id) }, 200)
}
