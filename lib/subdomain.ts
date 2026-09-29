// lib/subdomain.ts
//
// L'ÉCOSYSTÈME SE LIT DANS L'ADRESSE — une règle, une définition, pour la production ET pour staging.
// SOURCE UNIQUE partagée par proxy.ts (qui injecte x-subdomain sur les pages), par les routes /api
// PUBLIQUES qui résolvent l'écosystème elles-mêmes (le proxy n'injecte rien sur /api) et par la
// construction des adresses (liens d'e-mail, sélecteur).
//
// LA RÈGLE : une adresse est `<écosystème>.<racine>`, un seul label devant la racine.
//   · la RACINE est ce qui diffère entre les environnements, et RIEN D'AUTRE :
//       production → skilloria.io            (microsoft.skilloria.io)
//       staging    → staging.skilloria.io    (microsoft.staging.skilloria.io)
//     Elle vient de NEXT_PUBLIC_DOMAINE_RACINE, posée par environnement sur Vercel ; publique parce que
//     le sélecteur d'écosystème, dans le navigateur, construit les adresses avec la MÊME règle.
//   · un écosystème créé dans l'administration fonctionne donc sur staging SANS AUCUN RÉGLAGE, comme en
//     production : son adresse existe dès qu'il existe.
//   · une adresse qui ne porte pas d'écosystème ne résout RIEN (null) : la racine elle-même, un hôte hors
//     racine — les adresses aléatoires `…vercel.app` d'une Preview —, deux labels devant la racine.
//
// DÉVELOPPEMENT LOCAL (et lui seul) : localhost n'a pas de sous-domaine ; l'écosystème vient de
// DEV_DOMAIN_SLUG (.env.local). Absente → ÉCHEC EXPLICITE et actionnable.
//
// RÈGLE D'OR (multi-écosystème) : AUCUN nom d'écosystème n'est codé en dur ni posé dans une variable
// d'environnement déployée — ni comme défaut, ni comme repli.
//
// ⚠️ HISTOIRE (§E.83, 29/09/2026). La règle était « premier label d'un hôte d'au moins trois labels » :
//    sur une Preview `<déploiement>.vercel.app`, elle rendait le nom du déploiement, et l'inscription
//    expert était bloquée. Un premier correctif donnait l'écosystème à la Preview par DEV_DOMAIN_SLUG ;
//    décision de Youssef : REFUSÉ — un chemin que la production ne prend jamais, staging ne prouverait
//    plus rien. Staging se comporte EXACTEMENT comme la production : l'écosystème se lit dans l'adresse.

/** Étiquette DNS d'un écosystème : le même motif que lib/ecosystem-url.ts (SLUG_RE). */
const SLUG_ECOSYSTEME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
/** Une racine : au moins deux labels DNS. */
const RACINE_VALIDE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

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
 * La racine de l'environnement (`skilloria.io`, `staging.skilloria.io`), ou null si elle n'est pas posée
 * ou est malformée. Lue ICI et seulement ici — `process.env.NEXT_PUBLIC_…` écrit en toutes lettres, pour que
 * Next l'inscrive aussi dans le code du navigateur.
 */
export function domaineRacine(): string | null {
  const brut = (process.env.NEXT_PUBLIC_DOMAINE_RACINE ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '')
  return RACINE_VALIDE.test(brut) ? brut : null
}

/**
 * Extrait le slug d'écosystème depuis un en-tête Host.
 *   "microsoft.skilloria.io"          (racine skilloria.io)          → "microsoft"
 *   "microsoft.staging.skilloria.io"  (racine staging.skilloria.io)  → "microsoft"
 *   "skilloria-git-x-y.vercel.app"    (Preview, hors racine)          → null
 *   "staging.skilloria.io"            (la racine elle-même)           → null
 *   "localhost:3000"                  → process.env.DEV_DOMAIN_SLUG (ou throw si absente)
 *
 * @throws Error si DEV_DOMAIN_SLUG manque en local, ou NEXT_PUBLIC_DOMAINE_RACINE hors local (message
 *         actionnable) : une configuration absente n'est pas « aucun écosystème ».
 */
export function resolveSubdomainFromHost(host: string | null | undefined): string | null {
  const hostname = (host ?? '').toLowerCase().split(':')[0]

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

  const racine = domaineRacine()
  if (!racine) {
    throw new Error(
      'NEXT_PUBLIC_DOMAINE_RACINE manquant ou malformé. Hors du poste local, l\'écosystème se lit dans ' +
        'l\'adresse <écosystème>.<racine> : posez la racine de l\'environnement dans ses variables Vercel ' +
        '(docs/mise-en-production.md, « Les adresses »). Aucun nom d\'écosystème ne s\'y pose.',
    )
  }
  if (!hostname.endsWith(`.${racine}`)) return null
  const label = hostname.slice(0, -(racine.length + 1))
  return SLUG_ECOSYSTEME.test(label) ? label : null
}

/**
 * L'adresse d'un écosystème DANS L'ENVIRONNEMENT COURANT : `https://<slug>.<racine>`. La réciproque exacte
 * de `resolveSubdomainFromHost`. Null si la racine n'est pas posée (le poste local) ou si le slug n'est pas
 * une étiquette DNS. Sert aux liens d'e-mail : depuis staging, ils pointent vers staging — jamais vers la
 * production, jamais vers une adresse aléatoire.
 */
export function adresseEcosysteme(slug: string | null | undefined): string | null {
  const racine = domaineRacine()
  const s = (slug ?? '').trim().toLowerCase()
  if (!racine || !SLUG_ECOSYSTEME.test(s)) return null
  return `https://${s}.${racine}`
}
