/* ─────────────────────────────────────────────────────────────────────────
 * Construction de l'URL de base d'un email EXPERT à partir de SON domaine.
 *
 * Problème résolu : un email part vers un expert qui appartient à un domaine
 * précis (ex. `microsoft.skilloria.io`). L'origin de la requête admin n'est PAS
 * le domaine de l'expert — le bon signal est `users.domain_id → domains.slug`,
 * connu côté serveur. Ce helper greffe ce slug sur l'apex prod canonique.
 *
 * Subtilité environnement (cf. proxy.ts / session-token.ts) :
 *   - Prod    : `{slug}.skilloria.io` (sous-domaine = slug) → routing par slug OK
 *   - Staging : host UNIQUE `staging.skilloria.io` (pas de `{slug}.staging…`)
 *   - Local   : `localhost:3000`  /  Preview Vercel : `*.vercel.app`
 *
 * → On ne construit `https://{slug}.skilloria.io` QUE si l'origin prouve qu'on
 *   est en prod skilloria.io (et pas staging). Sinon : origin tel quel (fallback).
 * ───────────────────────────────────────────────────────────────────────── */

const APEX = 'skilloria.io'
const STAGING_HOST = 'staging.skilloria.io'

/** Extrait le host (sans port) d'une origin absolue, ou null si invalide. */
function hostOf(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Détermine si l'`origin` (issu de la requête admin) prouve qu'on tourne sur
 * la prod skilloria.io — seul cas où greffer un sous-domaine par slug est valide.
 * Exclut explicitement staging, localhost et les previews Vercel.
 */
function isProdSkilloria(origin: string): boolean {
  const host = hostOf(origin)
  if (!host) return false
  if (host === STAGING_HOST) return false
  if (host === 'localhost' || host.startsWith('localhost')) return false
  if (host.endsWith('.vercel.app')) return false
  // Apex `skilloria.io` ou n'importe quel sous-domaine `*.skilloria.io`.
  return host === APEX || host.endsWith(`.${APEX}`)
}

export type ExpertSiteOriginParams = {
  /** Origin déjà résolu côté route (body.site_url → origin → NEXT_PUBLIC_SITE_URL). */
  origin: string
  /** Slug du domaine de l'expert (domains.slug via users.domain_id). */
  slug: string | null | undefined
}

/**
 * Renvoie l'origin de base (sans slash final) à utiliser pour le CTA d'un email
 * expert. En prod skilloria.io avec un slug valide → `https://{slug}.skilloria.io`,
 * construit depuis l'APEX connu (pas en remplaçant un label) : robuste que l'admin
 * soit sur l'apex ou sur un sous-domaine. Sinon → `origin` tel quel.
 */
export function expertSiteOrigin(params: ExpertSiteOriginParams): string {
  const origin = (params.origin ?? '').replace(/\/+$/, '')
  const slug = (params.slug ?? '').trim().toLowerCase()
  if (!slug) return origin
  if (!isProdSkilloria(origin)) return origin
  return `https://${slug}.${APEX}`
}
