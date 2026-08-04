// lib/subdomain.ts
//
// Résolution du sous-domaine (= écosystème) à partir de l'en-tête Host de la
// requête. SOURCE UNIQUE partagée par proxy.ts (qui injecte x-subdomain sur les
// pages) et par les routes /api PUBLIQUES qui doivent résoudre l'écosystème
// elles-mêmes — car le proxy N'INJECTE PAS x-subdomain sur /api (matcher qui
// exclut `api`). Une seule fonction, aucune duplication de logique.
//
// RÈGLE D'OR (multi-écosystème) : AUCUN nom/slug d'écosystème n'est codé en dur,
// ni comme défaut, ni comme repli, ni comme exemple exécuté.
//   • Production  : le slug est dérivé du host de la requête. Hôte non résolvable
//                   (apex, IP…) → null : l'appelant échoue, jamais de repli.
//   • Développement (localhost, pas de sous-domaine) : le slug vient de la
//                   variable d'environnement DEV_DOMAIN_SLUG (.env.local).
//                   Absente → ÉCHEC EXPLICITE et actionnable, jamais de défaut.

/** Vrai si l'hôte est une adresse de développement local (pas de sous-domaine). */
function isLocalHost(hostname: string): boolean {
  return (
    hostname.includes('localhost') ||
    hostname.startsWith('127.0.0.1') ||
    hostname.startsWith('[::1]') ||
    hostname.startsWith('0.0.0.0')
  )
}

/**
 * Extrait le slug d'écosystème depuis un en-tête Host.
 *   "sap.skilloria.io"       → "sap"
 *   "microsoft.skilloria.io" → "microsoft"
 *   "localhost:3000"         → process.env.DEV_DOMAIN_SLUG (ou throw si absente)
 *   apex / IP / host absent   → null  (l'appelant décide de l'échec)
 *
 * @throws Error en développement si DEV_DOMAIN_SLUG est absente (message actionnable).
 */
export function resolveSubdomainFromHost(host: string | null | undefined): string | null {
  const hostname = host ?? ''

  if (isLocalHost(hostname)) {
    const devSlug = process.env.DEV_DOMAIN_SLUG?.trim()
    if (!devSlug) {
      throw new Error(
        'DEV_DOMAIN_SLUG manquant. En développement (localhost) il n\'y a pas de ' +
          'sous-domaine pour déduire l\'écosystème. Ajoutez à votre .env.local le slug ' +
          'd\'un domaine ACTIF de votre base, par exemple :\n' +
          '  DEV_DOMAIN_SLUG=<votre-slug>\n' +
          'Aucun écosystème n\'est codé en dur (règle multi-écosystème).',
      )
    }
    return devSlug
  }

  // Production : premier label du host. Non résolvable → null (aucun repli figé).
  const parts = hostname.split('.')
  return parts.length >= 3 ? parts[0] : null
}
