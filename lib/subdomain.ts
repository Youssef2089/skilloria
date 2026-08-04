// lib/subdomain.ts
//
// Résolution du sous-domaine (= écosystème) à partir de l'en-tête Host de la
// requête. SOURCE UNIQUE partagée par proxy.ts (qui injecte x-subdomain sur les
// pages) et par les routes /api PUBLIQUES qui doivent résoudre l'écosystème
// elles-mêmes — car le proxy N'INJECTE PAS x-subdomain sur /api (matcher qui
// exclut `api`). Garder les deux alignés évite toute dérive multi-écosystème.
//
// Multi-écosystème : le slug vient TOUJOURS du host de la requête, jamais d'un
// défaut figé en production. Le seul cas « microsoft » est le développement
// local (localhost n'a pas de sous-domaine), pour que l'app reste testable.

/** Slug d'écosystème par défaut en local (localhost ne porte pas de sous-domaine). */
export const LOCAL_DEFAULT_SUBDOMAIN = 'microsoft'

/**
 * Extrait le sous-domaine depuis un en-tête Host.
 *   "sap.skilloria.io"       → "sap"
 *   "microsoft.skilloria.io" → "microsoft"
 *   "localhost:3000"         → "microsoft" (dev)
 *   host absent / apex        → "microsoft" (repli prudent, identique au proxy)
 */
export function resolveSubdomainFromHost(host: string | null | undefined): string {
  const hostname = host ?? ''
  if (hostname.includes('localhost')) return LOCAL_DEFAULT_SUBDOMAIN
  const parts = hostname.split('.')
  if (parts.length >= 3) return parts[0]
  return LOCAL_DEFAULT_SUBDOMAIN
}
