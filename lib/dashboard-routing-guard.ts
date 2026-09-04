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
 *
 * ══ ELLE GARDE AUSSI L'ÉCOSYSTÈME ═══════════════════════════════════════════
 *  Cette garde ne connaissait que les RÔLES. Le sous-domaine, elle l'ignorait :
 *  une adresse d'écosystème inconnue ou désactivée rendait la coquille du
 *  dashboard, dont chaque appel /api répondait ensuite 403. La sécurité était
 *  fermée — l'API refusait — mais l'expérience ne l'était pas : un écran vide
 *  sans explication vaut, pour l'utilisateur, un bug.
 *
 *  Le verdict vient de resolveEcosystemAccess, LA MÊME fonction que
 *  requireAuth. Ce qu'on en fait diffère (ici on redirige, là on lève un 403) ;
 *  le verdict, lui, ne peut pas différer.
 *
 *  ORDRE SIGNIFIANT : l'écosystème AVANT le rôle. Rediriger vers le bon
 *  dashboard d'abord laisserait l'utilisateur sur le mauvais sous-domaine —
 *  on l'aurait déplacé sans le sortir de l'impasse.
 */

import { headers, cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  allowedUserTypesForDashboardSegment,
  dashboardUrlForUserType,
} from '@/lib/auth-routing'
import { hashSessionToken, sessionCookieNameForHost } from '@/lib/session-token'
import { resolveEcosystemAccess } from '@/lib/ecosystem-guard'
import { ECOSYSTEM_UNAVAILABLE_PATH } from '@/lib/ecosystem-url'

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

  const cookieStore = await cookies()
  // La règle de nommage vient de lib/session-token.ts, elle n'est plus
  // RECOPIÉE ici : une copie qui prend du retard fait lire un cookie qui
  // n'existe pas, et cette garde s'arrête alors sans rien dire.
  const cookieName = sessionCookieNameForHost(host)
  const sessionToken = cookieStore.get(cookieName)?.value
  if (!sessionToken) return   // pas connecté — laisser la page gérer

  const supabaseAdmin = getSupabaseAdmin()
  if (!supabaseAdmin) return

  // C2 : la BDD stocke le sha256 du token ; le cookie ss_token contient le
  // brut. On hashe la valeur du cookie avant le lookup, sinon le WHERE ne
  // matche jamais et ce garde casse (redirect dashboard rompu).
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, user_type, domain_id, domains(id, slug, active)')
    .eq('last_session_token', hashSessionToken(sessionToken))
    .maybeSingle()

  if (error) {
    console.error('[dashboard-routing-guard] user lookup error', error.message)
    return
  }
  if (!data) return   // token orphelin — laisser la page gérer

  const row = data as {
    id: string
    user_type: string | null
    domain_id: string
    domains: { id: string; slug: string; active: boolean } | { id: string; slug: string; active: boolean }[] | null
  }
  const userType = row.user_type
  if (!userType) return

  // ── ÉCOSYSTÈME D'ABORD ────────────────────────────────────────────────────
  // `x-subdomain` est posé par proxy.ts sur les PAGES (il n'exclut que /api).
  const access = await resolveEcosystemAccess({
    admin: supabaseAdmin,
    headerSubdomain: hdrs.get('x-subdomain'),
    userType,
    userDomainId: row.domain_id,
    ownDomain: (Array.isArray(row.domains) ? row.domains[0] : row.domains) ?? null,
    logTag: 'dashboard-routing-guard',
  })
  if (!access.ok) {
    // La page vit HORS de /dashboard : cette garde ne s'y exécute pas, donc
    // aucune boucle de redirection possible.
    const params = new URLSearchParams({ code: access.denial.code })
    if (access.denial.ownSlug) params.set('slug', access.denial.ownSlug)
    redirect(`${ECOSYSTEM_UNAVAILABLE_PATH}?${params.toString()}`)
  }

  // ── PUIS LE RÔLE ──────────────────────────────────────────────────────────
  const allowed = allowedUserTypesForDashboardSegment(segment)
  if (allowed === null) return   // segment "ouvert" (ex. cabinet redirect)
  if ((allowed as readonly string[]).includes(userType)) return

  // Mismatch — redirect vers le bon dashboard.
  // dashboardUrlForUserType retourne /dashboard/<role> sans locale prefix.
  // Le router Next.js avec i18n routing détecte l'absence de locale et
  // applique la locale courante automatiquement.
  redirect(dashboardUrlForUserType(userType))
}
