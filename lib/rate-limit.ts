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
 * Trois etats, pas deux.
 *
 * « Autorise » et « le limiteur n'a pas pu repondre » sont deux choses
 * differentes, et elles n'appellent pas la meme decision selon l'appelant :
 *
 *   • A L'ENVOI d'un SMS, laisser passer quand le limiteur est casse est le bon
 *     choix : le pire cas est un SMS de trop, et refuser ferait un deni de
 *     service sur nos propres inscriptions.
 *   • A LA VERIFICATION d'un code, c'est l'inverse : la limite EST la defense
 *     anti-force-brute. Laisser passer quand elle est indisponible, c'est
 *     offrir un nombre illimite d'essais sur un code a 4-6 chiffres — le seul
 *     moment ou le limiteur compte vraiment est celui ou on l'ignore.
 *
 * Le verdict est donc rendu tel quel, et chaque appelant tranche. Un seul
 * mecanisme, une seule RPC : rien de parallele.
 */
export type VerdictLimite = 'autorise' | 'refuse' | 'indisponible'

/** Fenetres et plafonds de la VERIFICATION d'un code OTP. Definis une fois, */
/** partages par la route publique et la route authentifiee. */
export const OTP_VERIFY_FENETRE_S = 900
export const OTP_VERIFY_MAX = 5
/** Cle IP : plus large que la cle telephone — plusieurs personnes peuvent */
/** partager une sortie NAT, et chacune a droit a ses tentatives. */
export const OTP_VERIFY_IP_FENETRE_S = 3600
export const OTP_VERIFY_IP_MAX = 30

/**
 * Verifie ET enregistre atomiquement une tentative pour (bucket, rawKey),
 * en distinguant le refus de l'indisponibilite.
 *
 * UNE SEULE SORTIE « indisponible », et c'est deliberé. Les deux facons dont ce
 * limiteur peut tomber — la RPC qui repond en erreur, et l'exception qui ne
 * repond pas du tout — convergent vers le meme point. Ecrites en deux `return`
 * separes, elles se ressemblent assez pour qu'on en supprime une sans le voir,
 * et la moitie du fail-closed partirait en silence.
 */
export async function evaluerLimite(
  admin: SupabaseClient,
  bucket: string,
  rawKey: string,
  windowSeconds: number,
  max: number,
): Promise<VerdictLimite> {
  const issue = await admin
    .rpc('rate_limit_check', {
      p_bucket: bucket,
      p_key_hash: hashRateLimitKey(rawKey),
      p_window_seconds: windowSeconds,
      p_max: max,
    })
    .then(
      (r) => (r.error ? { panne: r.error.message } : { autorise: r.data === true }),
      (err: unknown) => ({ panne: err instanceof Error ? err.message : String(err) }),
    )

  if ('panne' in issue) {
    console.warn('[rate-limit] limiteur indisponible', { bucket, message: issue.panne })
    return 'indisponible'
  }
  return issue.autorise ? 'autorise' : 'refuse'
}

/**
 * Verifie ET enregistre atomiquement une tentative pour (bucket, rawKey).
 * Retourne true si AUTORISE (sous la limite), false si REFUSE.
 *
 * FAIL-OPEN VOLONTAIRE : si la RPC echoue (DB indisponible, migration pas encore
 * deployee, exception reseau...), on LOG un warning et on retourne `true`
 * (autorise). Rationale : un limiteur casse ne doit jamais provoquer un deni de
 * service sur nos propres inscriptions. Ne PAS "corriger" ce comportement en
 * fail-closed.
 *
 * NB : ce contrat est celui de l'ENVOI. Les routes de VERIFICATION n'utilisent
 * pas cette fonction — elles lisent le verdict brut via `evaluerLimite` et
 * traitent « indisponible » comme un refus (cf. ci-dessus).
 */
export async function checkRateLimit(
  admin: SupabaseClient,
  bucket: string,
  rawKey: string,
  windowSeconds: number,
  max: number,
): Promise<boolean> {
  return (await evaluerLimite(admin, bucket, rawKey, windowSeconds, max)) !== 'refuse'
}
