/**
 * lib/session-cookie.ts — module PUR, sans import : le contrôle l'exécute tel quel (recette staging, 30/09/2026).
 */

/** Le nom de base du cookie de session unique (11F). */
export const NOM_COOKIE_SESSION = 'ss_token'

/**
 * LA RÈGLE DU COOKIE DE SESSION — DÉRIVÉE DE LA CONFIGURATION, PLUS AUCUN HÔTE EN TOUTES LETTRES
 * (recette staging, 30/09/2026).
 *
 * Elle testait `staging.skilloria.io` et `skilloria.io` écrits dans le code. Désormais elle lit
 * l'ENVIRONNEMENT (`VERCEL_ENV`) et la RACINE (`NEXT_PUBLIC_DOMAINE_RACINE`, la seule lecture étant
 * `domaineRacine()`, lib/subdomain.ts) — un nouvel environnement n'a rien à ajouter ici.
 *
 * ⚠️ LA BASCULE NE DÉCONNECTE PERSONNE : chaque environnement pose EXACTEMENT le cookie qu'il posait.
 *   · PRODUCTION : `ss_token`, `Domain=.<racine>` — soit `.skilloria.io`, partagé par tous les
 *     écosystèmes (changer d'écosystème ne réauthentifie pas). Le jour où `main` reçoit ce code, la
 *     production pose ce cookie-là.
 *   · TOUT AUTRE ENVIRONNEMENT DÉPLOYÉ (staging, Preview) : `ss_token_staging` — un NOM distinct, pour
 *     ne jamais écraser ni lire le cookie de production, qui est envoyé aussi aux hôtes de staging (ils
 *     sont sous `.skilloria.io`). Sa portée reste celle qu'il avait, le PARENT de la racine
 *     (`staging.skilloria.io` → `.skilloria.io`) : la resserrer à `.staging.skilloria.io` laisserait
 *     dans chaque navigateur l'ancien cookie, de même nom, envoyé en premier — une session lue fausse,
 *     déconnectée, reconnectée, en boucle. Une racine à deux labels n'a pas de parent utilisable (ce
 *     serait un suffixe public) : la portée est alors la racine elle-même.
 *   · LE POSTE LOCAL (aucun `VERCEL_ENV`) : `ss_token`, sans `Domain`, sans `Secure`.
 *   · UN HÔTE HORS DE LA RACINE (`…vercel.app`) : cookie limité à l'hôte.
 *
 * Fonction PURE et exportée, paramètres injectés : le contrôle l'exécute sur chaque environnement, et la
 * garde du dashboard (sans NextRequest) applique la MÊME règle.
 */
export type RegleCookieSession = { nom: string; domaine?: string; secure: boolean }

export function regleCookieSession(args: {
  host: string | null | undefined
  racine: string | null
  environnement: string | null | undefined
}): RegleCookieSession {
  const h = (args.host ?? '').toLowerCase().split(':')[0]
  const local = h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local')
  const production = args.environnement === 'production'
  const deploye = Boolean(args.environnement)
  const nom = production || !deploye ? NOM_COOKIE_SESSION : `${NOM_COOKIE_SESSION}_staging`
  const racine = (args.racine ?? '').toLowerCase()
  const sousLaRacine = racine !== '' && (h === racine || h.endsWith(`.${racine}`))
  let domaine: string | undefined
  if (sousLaRacine) {
    const labels = racine.split('.')
    domaine = !production && labels.length >= 3 ? `.${labels.slice(1).join('.')}` : `.${racine}`
  }
  return { nom, ...(domaine ? { domaine } : {}), secure: !local }
}
