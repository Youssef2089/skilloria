/**
 * lib/dashboard-routing-guard.ts — garde serveur du routing dashboard
 * par rôle (Lot routing).
 *
 * Appelée depuis app/[locale]/dashboard/layout.tsx (server component) qui
 * connaît le pathname via le header `x-pathname` posé par proxy.ts.
 *
 * Comportement :
 *  - User non identifié (pas de cookie ss_token, token invalide, etc.)
 *    → on NE BLOQUE PAS. Le rendu continue, et la page enfant fera son
 *    propre redirect vers /connexion (pattern client existant). Eviter
 *    un double-redirect.
 *  - User identifié sur un segment qui ne correspond PAS à son user_type
 *    → redirect(dashboardUrlForUserType(userType)). Pas de 403 UI.
 *  - User identifié sur le bon segment → pass-through.
 *  - Segment non-role-specific (ex. /dashboard/cabinet qui redirect lui-même)
 *    → pass-through.
 */

import { headers, cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  allowedUserTypesForDashboardSegment,
  dashboardUrlForUserType,
} from '@/lib/auth-routing'
import { hashSessionToken } from '@/lib/session-token'

function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error('[dashboard-routing-guard] Missing Supabase env vars')
    return null
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Lit le nom du cookie de session (suffixé sur staging — cf.
 * lib/session-token.ts). On reproduit la logique ici sans dépendre du
 * NextRequest (qu'on n'a pas en server component).
 */
function getSessionCookieName(host: string | null): string {
  const h = (host ?? '').toLowerCase().split(':')[0]
  return h === 'staging.skilloria.io' ? 'ss_token_staging' : 'ss_token'
}

/**
 * Parse le segment dashboard depuis un pathname.
 * Ex. "/fr/dashboard/freelance/missions" → "freelance".
 * Returns null si on n'est pas sous /dashboard/<seg>.
 */
function parseDashboardSegment(pathname: string | null | undefined): string | null {
  if (!pathname) return null
  const segs = pathname.split('/').filter(Boolean)
  // [locale, "dashboard", <seg>, ...] OU ["dashboard", <seg>, ...] (sans locale)
  const dashIdx = segs.findIndex((s) => s === 'dashboard')
  if (dashIdx < 0) return null
  return segs[dashIdx + 1] ?? null
}

/**
 * Garde routing serveur. À appeler depuis le layout serveur du dashboard.
 * Peut throw via redirect() — c'est le comportement attendu (Next.js gère).
 */
export async function assertDashboardRoleGuard(): Promise<void> {
  const hdrs = await headers()
  const pathname = hdrs.get('x-pathname')
  const host = hdrs.get('host')
  const segment = parseDashboardSegment(pathname)
  if (!segment) return

  const allowed = allowedUserTypesForDashboardSegment(segment)
  if (allowed === null) return   // segment "ouvert" (ex. cabinet redirect)

  const cookieStore = await cookies()
  const cookieName = getSessionCookieName(host)
  const sessionToken = cookieStore.get(cookieName)?.value
  if (!sessionToken) return   // pas connecté — laisser la page gérer

  const supabaseAdmin = getSupabaseAdmin()
  if (!supabaseAdmin) return

  // C2 : la BDD stocke le sha256 du token ; le cookie ss_token contient le
  // brut. On hashe la valeur du cookie avant le lookup, sinon le WHERE ne
  // matche jamais et ce garde casse (redirect dashboard rompu).
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, user_type')
    .eq('last_session_token', hashSessionToken(sessionToken))
    .maybeSingle()

  if (error) {
    console.error('[dashboard-routing-guard] user lookup error', error.message)
    return
  }
  if (!data) return   // token orphelin — laisser la page gérer

  const userType = (data as { user_type: string | null }).user_type
  if (!userType) return

  if ((allowed as readonly string[]).includes(userType)) return

  // Mismatch — redirect vers le bon dashboard.
  // dashboardUrlForUserType retourne /dashboard/<role> sans locale prefix.
  // Le router Next.js avec i18n routing détecte l'absence de locale et
  // applique la locale courante automatiquement.
  redirect(dashboardUrlForUserType(userType))
}
