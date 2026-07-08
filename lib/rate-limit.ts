import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'

/**
 * Limiteur de debit partage (M1 OTP, reutilisable M2...).
 *
 * S'appuie sur la fonction SQL atomique `public.rate_limit_check`
 * (cf. supabase/migrations/20260708000005_rate_limiter.sql) : le comptage +
 * l'enregistrement du hit sont faits en une seule transaction cote Postgres,
 * donc non contournables par des requetes concurrentes.
 *
 * Regle : la cle brute (ex. numero de telephone) n'est JAMAIS envoyee en clair
 * a la DB. On stocke uniquement son SHA-256 (cf. hashRateLimitKey).
 */

/**
 * Extraction de l'IP client. Ordre : x-forwarded-for (1er segment) -> x-real-ip.
 *
 * ATTENTION : `x-forwarded-for` est un en-tete FALSIFIABLE par le client. L'IP
 * n'est donc qu'un signal SECONDAIRE du limiteur (defense faible) ; la cle
 * principale reste le telephone hache. Ne jamais s'appuyer sur l'IP seule.
 */
export function extractClientIp(request: NextRequest | Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp.trim()
  return null
}

/** SHA-256 hex d'une valeur — pour ne jamais manipuler la cle en clair cote DB. */
export function hashRateLimitKey(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Verifie ET enregistre atomiquement une tentative pour (bucket, rawKey).
 * Retourne true si AUTORISE (sous la limite), false si REFUSE.
 *
 * FAIL-OPEN VOLONTAIRE : si la RPC echoue (DB indisponible, migration pas encore
 * deployee, exception reseau...), on LOG un warning et on retourne `true`
 * (autorise). Rationale : un limiteur casse ne doit jamais provoquer un deni de
 * service sur nos propres inscriptions/verifications. Ne PAS "corriger" ce
 * comportement en fail-closed.
 */
export async function checkRateLimit(
  admin: SupabaseClient,
  bucket: string,
  rawKey: string,
  windowSeconds: number,
  max: number,
): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc('rate_limit_check', {
      p_bucket: bucket,
      p_key_hash: hashRateLimitKey(rawKey),
      p_window_seconds: windowSeconds,
      p_max: max,
    })
    if (error) {
      // Fail-open : on laisse passer plutot que de bloquer un user legitime.
      console.warn('[rate-limit] rate_limit_check RPC error (fail-open)', {
        bucket,
        message: error.message,
      })
      return true
    }
    return data === true
  } catch (err) {
    // Fail-open : idem sur exception inattendue.
    console.warn('[rate-limit] rate_limit_check threw (fail-open)', { bucket, err })
    return true
  }
}
