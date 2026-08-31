import type { NextRequest } from 'next/server'

/**
 * lib/request-meta.ts — extraction de l'IP et du user-agent d'une requête.
 *
 * POURQUOI CE MODULE
 *   `lib/session-log.ts` savait déjà le faire, en privé, pour `session_logs`.
 *   `audit_logs` porte les MÊMES colonnes `ip_address` / `user_agent` depuis
 *   l'origine, et `logAudit` ne les remplissait jamais : sur une suspension de
 *   compte ou une révocation de session, c'est précisément l'information qu'on
 *   voudra six mois plus tard. Plutôt que de recopier les deux fonctions dans
 *   le helper d'audit, elles montent ici et les deux journaux les partagent.
 *
 * `x-forwarded-for` peut contenir « client, proxy1, proxy2 » : on garde le
 * premier maillon, le seul qui désigne l'appelant.
 *
 * LECTURE PURE : aucune écriture, aucun effet de bord.
 */

/** Longueur max stockée pour un user-agent (colonne `text`, mais on borne). */
const USER_AGENT_MAX = 1000

export function extractIp(request: NextRequest | Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp.trim()
  return null
}

export function extractUserAgent(request: NextRequest | Request): string | null {
  const ua = request.headers.get('user-agent')
  return ua ? ua.slice(0, USER_AGENT_MAX) : null
}
