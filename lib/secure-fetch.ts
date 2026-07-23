'use client'

import { useCallback } from 'react'
import { useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { supabase } from '@/lib/supabase'

/**
 * Helper unifié pour tous les fetchs client AUTHENTIFIÉS (11F F2).
 *
 * Garanties pour tout call-site :
 *   1. Authorization: Bearer <access_token> Supabase (injecté à chaque appel)
 *   2. x-subdomain: <domain.subdomain> depuis useDomain() (multi-tenant)
 *   3. credentials: 'include' → le cookie httpOnly `ss_token` (posé par
 *      /api/auth/init-session) est envoyé automatiquement
 *   4. Interception du 403 `session_superseded` (D2) :
 *      - purge la session Supabase locale
 *      - redirige vers /connexion?reason=session_superseded
 *      - laisse remonter la Response 403 au caller (qui peut afficher
 *        son propre fallback, mais en pratique le redirect prend le pas)
 *
 * À utiliser via le hook React `useSecureFetch()` (qui câble useDomain
 * et useRouter automatiquement) ou directement via `secureFetch()` si
 * on n'est pas dans un composant.
 *
 * Les fetchs PUBLICS (countries, taxonomy, send/verify OTP, register-org)
 * NE PASSENT PAS PAR ICI — ils restent en fetch direct.
 */

export type SecureFetchContext = {
  /** Subdomain du tenant courant (cf. useDomain) — exigé par auth-guard. */
  subdomain: string
  /** Callback appelé après 403 session_superseded — pour redirect UI. */
  onSuperseded: () => void
  /**
   * Callback appelé après 403 account_deletion_scheduled (C2) — redirige vers
   * /reactivation. Permet au SessionHeartbeat (ping 60s) de capter réellement
   * l'état « suppression programmée » sur les écrans sans appel /api/* protégé.
   */
  onDeletionScheduled: () => void
}

/**
 * Implémentation bas-niveau. Préférer `useSecureFetch()` dans un composant.
 */
export async function secureFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  ctx: SecureFetchContext,
): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const headers = new Headers(init?.headers)
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`)
  }
  headers.set('x-subdomain', ctx.subdomain)

  const res = await fetch(input, {
    ...init,
    headers,
    credentials: 'include',
  })

  if (res.status === 403) {
    // Lit le body sans consommer la Response originale (clone).
    try {
      const payload = (await res.clone().json().catch(() => null)) as
        | { code?: string }
        | null
      if (payload?.code === 'session_superseded') {
        ctx.onSuperseded()
      } else if (payload?.code === 'account_deletion_scheduled') {
        ctx.onDeletionScheduled()
      }
    } catch {
      /* swallow — le caller verra le 403 brut */
    }
  }

  return res
}

/**
 * Hook React qui retourne une fonction `(input, init?) => Promise<Response>`
 * câblée à useDomain + useRouter. La onSuperseded :
 *   - signOut Supabase (purge la session locale)
 *   - redirect /connexion?reason=session_superseded (locale préservée)
 */
export function useSecureFetch(): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const domain = useDomain()
  const router = useRouter()
  return useCallback(
    (input, init) =>
      secureFetch(input, init, {
        subdomain: domain.subdomain,
        onSuperseded: () => {
          void supabase.auth.signOut()
          router.replace('/connexion?reason=session_superseded')
        },
        // C2 : suppression programmée détectée sur une route protégée (dont le
        // heartbeat check-session) → on redirige vers l'écran de réactivation.
        onDeletionScheduled: () => {
          router.replace('/reactivation')
        },
      }),
    [domain.subdomain, router],
  )
}

/**
 * Appelle POST /api/auth/init-session pour poser le `last_session_token`
 * en BDD + cookie httpOnly. À invoquer juste APRÈS un login Supabase
 * réussi (signInWithPassword OU getSession post-confirm email).
 *
 * Retourne { ok } — on log un warning si KO mais on ne bloque pas le flow
 * de login (l'user a déjà sa session Supabase, juste le mécanisme session
 * unique reste dormant tant que le token n'est pas posé).
 */
export async function initSession(args: {
  accessToken: string
  subdomain: string
}): Promise<{ ok: boolean }> {
  try {
    const res = await fetch('/api/auth/init-session', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        'x-subdomain': args.subdomain,
      },
      credentials: 'include',
    })
    if (!res.ok) {
      console.warn('[secure-fetch] initSession failed', res.status)
      return { ok: false }
    }
    return { ok: true }
  } catch (err) {
    console.warn('[secure-fetch] initSession threw', err)
    return { ok: false }
  }
}

/**
 * Logout unifié (11F F2) :
 *   1. POST /api/auth/logout (vide users.last_session_token + purge cookie)
 *   2. supabase.auth.signOut() (purge la session locale)
 *   3. router.push('/') OU callback custom
 *
 * Permissif : si l'étape 1 échoue, on continue quand même les étapes 2-3.
 * Le but est que l'user ne reste JAMAIS bloqué dans son état connecté.
 */
export function useSecureLogout(): (
  options?: { redirectTo?: string },
) => Promise<void> {
  const domain = useDomain()
  const router = useRouter()
  return useCallback(
    async (options) => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (session) {
          await fetch('/api/auth/logout', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'x-subdomain': domain.subdomain,
            },
            credentials: 'include',
          }).catch(() => {
            /* swallow — logout reste idempotent */
          })
        }
      } catch {
        /* swallow */
      }
      await supabase.auth.signOut()
      router.push(options?.redirectTo ?? '/')
    },
    [domain.subdomain, router],
  )
}
