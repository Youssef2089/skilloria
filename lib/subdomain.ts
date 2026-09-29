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
//   • Hôte SANS écosystème (développement local, Preview Vercel, staging sur son
//     hôte unique) : le slug vient de la variable d'environnement DEV_DOMAIN_SLUG.
//                   Absente → ÉCHEC EXPLICITE et actionnable, jamais de défaut.
//
// ⚠️ LA PREVIEW VERCEL A ÉTÉ OUBLIÉE ICI, ET C'EST ELLE QUI A BLOQUÉ L'INSCRIPTION
//    (29/09/2026, §E.83). Un hôte `<déploiement>.vercel.app` a trois labels : la
//    règle « premier label » en tirait le NOM DU DÉPLOIEMENT (skilloria-git-…),
//    qui n'est aucun écosystème. /api/taxonomy rendait 400, le formulaire expert
//    n'avait ni branche ni spécialité, et l'inscription était impossible. Même
//    défaut pour `staging.skilloria.io`, l'hôte unique de staging (lib/session-token.ts,
//    lib/emails/domain-url.ts) : son premier label est « staging ». Ces hôtes ne
//    PORTENT pas d'écosystème ; ils le reçoivent de la configuration, comme localhost.
//    En PRODUCTION (VERCEL_ENV = 'production'), un hôte `.vercel.app` reste
//    non résolvable (null) : la production sert ses écosystèmes par leurs sous-domaines.

/** L'hôte unique de staging — le même que lib/session-token.ts et lib/emails/domain-url.ts. */
const HOTE_STAGING = 'staging.skilloria.io'

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
 * Vrai si l'hôte NE PORTE PAS d'écosystème et doit le recevoir de DEV_DOMAIN_SLUG :
 * localhost, une Preview Vercel (`*.vercel.app`) hors production, l'hôte unique de staging.
 */
export function hoteSansEcosysteme(host: string | null | undefined): boolean {
  const hostname = (host ?? '').toLowerCase().split(':')[0]
  if (isLocalHost(hostname)) return true
  if (process.env.VERCEL_ENV === 'production') return false
  return hostname.endsWith('.vercel.app') || hostname === HOTE_STAGING
}

/**
 * Extrait le slug d'écosystème depuis un en-tête Host.
 *   "sap.skilloria.io"                    → "sap"
 *   "microsoft.staging.skilloria.io"      → "microsoft"
 *   "localhost:3000"                      → process.env.DEV_DOMAIN_SLUG (ou throw si absente)
 *   "<déploiement>.vercel.app" (Preview)  → process.env.DEV_DOMAIN_SLUG (ou throw si absente)
 *   "staging.skilloria.io" (hors prod)    → process.env.DEV_DOMAIN_SLUG (ou throw si absente)
 *   apex / IP / host absent / `.vercel.app` en production → null (l'appelant décide de l'échec)
 *
 * @throws Error si l'hôte ne porte pas d'écosystème et que DEV_DOMAIN_SLUG est absente
 *         (message actionnable).
 */
export function resolveSubdomainFromHost(host: string | null | undefined): string | null {
  const hostname = host ?? ''

  if (hoteSansEcosysteme(hostname)) {
    const devSlug = process.env.DEV_DOMAIN_SLUG?.trim()
    if (!devSlug) {
      throw new Error(
        `DEV_DOMAIN_SLUG manquant. L'hôte « ${hostname} » (développement local, Preview Vercel ` +
          'ou staging) ne porte pas de sous-domaine d\'écosystème. Posez le slug d\'un domaine ACTIF ' +
          'de la base — dans .env.local en local, dans les variables d\'environnement Vercel ' +
          '(Preview) sinon :\n' +
          '  DEV_DOMAIN_SLUG=<votre-slug>\n' +
          'Aucun écosystème n\'est codé en dur (règle multi-écosystème).',
      )
    }
    return devSlug
  }

  // Un `.vercel.app` qui arrive ici est un hôte de PRODUCTION (l'alias du projet) : son premier
  // label est le nom du projet, jamais un écosystème — non résolvable, pas deviné.
  if (hostname.toLowerCase().split(':')[0].endsWith('.vercel.app')) return null

  // Production : premier label du host. Non résolvable → null (aucun repli figé).
  const parts = hostname.split('.')
  return parts.length >= 3 ? parts[0] : null
}
