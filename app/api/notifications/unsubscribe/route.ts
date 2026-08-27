import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyUnsubToken } from '@/lib/notification-unsub-token'
import { setPreference } from '@/lib/notifications/preferences'
import type { NotificationEventType } from '@/lib/notifications/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/notifications/unsubscribe?token=… — désabonnement EMAIL one-click (D6).
 *
 * PUBLIQUE (pas d'auth : un lien de désabonnement doit marcher sans re-login).
 * La légitimité vient de la signature HMAC du token (lib/notification-unsub-token).
 * Effet CÔTÉ SERVEUR : le canal EMAIL de l'événement visé par le token est
 * désactivé dans `notification_preferences`. Puis redirection vers
 * l'onglet Notifications des paramètres, où l'utilisateur voit l'email désormais
 * désactivé et peut ajuster.
 *
 * Idempotent : recliquer ne fait que re-poser false. Un token invalide/expiré
 * redirige vers l'accueil avec un indicateur d'erreur (pas de 500 brut).
 */

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('missing_env')
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const VALID_LOCALES = ['fr', 'en', 'es', 'de'] as const
function normalizeLocale(raw: string | null | undefined): string {
  return raw && (VALID_LOCALES as readonly string[]).includes(raw) ? raw : 'fr'
}

export async function GET(request: NextRequest): Promise<Response> {
  const token = request.nextUrl.searchParams.get('token') ?? ''
  const verified = verifyUnsubToken(token)
  if (!verified.ok) {
    // Token cassé/expiré : on ne divulgue rien, redirection accueil FR.
    return NextResponse.redirect(new URL('/fr?unsub=invalid', request.url))
  }

  let admin: SupabaseClient
  try {
    admin = getSupabaseAdmin()
  } catch {
    return NextResponse.redirect(new URL('/fr?unsub=error', request.url))
  }

  // Désactive le canal EMAIL de l'ÉVÉNEMENT visé par le lien (idempotent).
  //
  // Le token porte désormais l'événement. Un lien émis avant la généralisation
  // n'en porte pas : `verifyUnsubToken` le fait retomber sur
  // 'new_match_opportunity', le seul qui existait alors — aucun lien déjà parti
  // dans une boîte mail ne cesse de fonctionner.
  //
  // On ne coupe QUE l'événement demandé : se désabonner des e-mails de
  // messages ne doit pas faire taire les opportunités.
  const { data: user } = await admin
    .from('users')
    .select('user_type, locale')
    .eq('id', verified.uid)
    .maybeSingle()

  const res = await setPreference(
    admin,
    verified.uid,
    verified.event as NotificationEventType,
    'email',
    false,
  )
  if (!res.ok) {
    console.error('[unsubscribe] preference update failed', res.message)
    return NextResponse.redirect(new URL('/fr?unsub=error', request.url))
  }

  const locale = normalizeLocale((user?.locale as string | null | undefined) ?? null)
  // Routage de l'écran de réglages selon le type de compte : un membre
  // d'organisation n'a pas de tableau de bord expert.
  const ut = (user?.user_type as string | null | undefined) ?? null
  const segment = ut === 'expert_cdi' ? 'cdi' : ut === 'client' || ut === 'cabinet' ? 'entreprise' : 'freelance'
  return NextResponse.redirect(
    new URL(`/${locale}/dashboard/${segment}/parametres?tab=notifications&unsub=1`, request.url),
  )
}
