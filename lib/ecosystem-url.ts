/**
 * lib/ecosystem-url.ts — CONSTRUIRE L'ADRESSE D'UN AUTRE ÉCOSYSTÈME.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ L'URL EST LA SEULE SOURCE DE VÉRITÉ DE L'ÉCOSYSTÈME COURANT.             ║
 * ║                                                                          ║
 * ║ Changer d'écosystème, c'est changer de sous-domaine — rien d'autre. Pas  ║
 * ║ de cookie de préférence, pas d'état React, pas de paramètre de requête.  ║
 * ║ Un second état finirait par diverger de l'URL, et le jour où il diverge, ║
 * ║ l'écran affiche un écosystème pendant que le serveur en sert un autre.   ║
 * ║                                                                          ║
 * ║ Conséquence voulue : la bascule est une NAVIGATION COMPLÈTE. Elle coûte  ║
 * ║ un chargement de page, et c'est le prix de n'avoir qu'une vérité.        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ═══ CE FICHIER EST PUR ════════════════════════════════════════════════════
 *   Aucun import. Il tourne côté navigateur, côté serveur, et s'exécute tel
 *   quel dans le diagnostic — qui l'éprouve sur de vrais hôtes plutôt que de
 *   relire son texte.
 *
 * ═══ IL DOIT S'ACCORDER AVEC resolveSubdomainFromHost ══════════════════════
 *   L'hôte produit ici est celui que `lib/subdomain.ts` devra reparser pour
 *   retrouver le slug. Si les deux règles divergent, le sélecteur fabrique des
 *   adresses que la garde refuse — un aller simple vers un 403. Le diagnostic
 *   vérifie l'ALLER-RETOUR sur chaque forme d'hôte.
 */

/**
 * Slug d'écosystème recevable : étiquette DNS stricte.
 *
 * ⚠️ C'EST UNE GARDE ANTI-REDIRECTION, PAS UNE COQUETTERIE. Ce slug arrive
 *    parfois d'un paramètre d'URL (l'écran « écosystème indisponible » le
 *    reçoit ainsi). Sans ce filtre, une valeur comme `evil.com` ou `a.b/c`
 *    construirait un lien vers un hôte étranger, affiché dans nos couleurs.
 */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export function isValidEcosystemSlug(slug: string | null | undefined): slug is string {
  return typeof slug === 'string' && SLUG_RE.test(slug)
}

/**
 * Remplace le premier label de l'hôte par `slug`.
 *
 *   'microsoft.skilloria.io'          + 'sap' → 'sap.skilloria.io'
 *   'microsoft.staging.skilloria.io'  + 'sap' → 'sap.staging.skilloria.io'
 *   'microsoft.skilloria.io:3000'     + 'sap' → 'sap.skilloria.io:3000'
 *   'skilloria.io'                    + 'sap' → null  (apex : rien à remplacer)
 *   'localhost:3000'                  + 'sap' → null  (pas de sous-domaine)
 *
 * `null` signifie « cet hôte ne permet pas de changer d'écosystème ». C'est le
 * cas en développement, où l'écosystème vient de DEV_DOMAIN_SLUG et non du
 * host : le sélecteur le DIT au lieu de proposer un lien qui ne marcherait pas.
 *
 * Le seuil de trois labels est celui de `resolveSubdomainFromHost` — la même
 * règle, écrite une seule fois de chaque côté et vérifiée en aller-retour.
 */
export function swapEcosystemHost(
  host: string | null | undefined,
  slug: string | null | undefined,
): string | null {
  if (!isValidEcosystemSlug(slug)) return null
  const raw = (host ?? '').toLowerCase().trim()
  if (!raw) return null

  const colon = raw.indexOf(':')
  const hostname = colon === -1 ? raw : raw.slice(0, colon)
  const port = colon === -1 ? '' : raw.slice(colon)

  // Développement local : aucun sous-domaine à remplacer.
  if (
    hostname.includes('localhost') ||
    hostname.startsWith('127.0.0.1') ||
    hostname.startsWith('[::1]') ||
    hostname.startsWith('0.0.0.0')
  ) {
    return null
  }

  const parts = hostname.split('.')
  if (parts.length < 3) return null

  return [slug, ...parts.slice(1)].join('.') + port
}

/**
 * Adresse absolue du même chemin, sur un autre écosystème.
 *
 * Le CHEMIN EST CONSERVÉ : basculer depuis la liste des annonces amène sur la
 * liste des annonces de l'autre écosystème, pas sur un tableau de bord
 * générique. La navigation garde son fil.
 *
 * `null` si l'hôte ne permet pas la bascule (cf. `swapEcosystemHost`).
 */
export function ecosystemHref(args: {
  host: string | null | undefined
  slug: string | null | undefined
  protocol?: string
  pathname?: string
  search?: string
}): string | null {
  const target = swapEcosystemHost(args.host, args.slug)
  if (!target) return null
  const proto = (args.protocol ?? 'https:').replace(/:?$/, ':')
  const path = args.pathname && args.pathname.startsWith('/') ? args.pathname : '/'
  const search = args.search && args.search !== '?' ? args.search : ''
  return `${proto}//${target}${path}${search}`
}

/* ══════════════════════════════════════════════════════════════════════════
 * L'ECRAN DES REFUS — son chemin et le lavage de ses parametres.
 *
 * Ces declarations vivaient dans un fichier a part. Elles ont ete ramenees ICI
 * pour une raison precise : ce fichier n'a AUCUN import, et c'est ce qui permet
 * au diagnostic de l'IMPORTER et d'executer ces fonctions sur de vraies entrees
 * hostiles. Un fichier separe aurait du importer `isValidEcosystemSlug` — donc
 * porter un import — et le diagnostic n'aurait plus pu que paraphraser son
 * texte. Un controle qui execute vaut mieux qu'un controle qui relit.
 *
 * Le rapprochement se tient d'ailleurs sur le fond : validation du slug,
 * construction d'adresse et lavage des parametres d'ecran traitent tous la
 * meme chose — une entree non fiable qui va devenir une URL.
 * ═══════════════════════════════════════════════════════════════════════════ */

export const ECOSYSTEM_UNAVAILABLE_PATH = '/ecosysteme-indisponible'

/**
 * Les motifs qui ont un écran.
 *
 * `unknown_user_type` et `domain_lookup_failed` n'y figurent PAS, et c'est
 * délibéré : ce sont des anomalies de la plateforme, pas des situations que
 * l'utilisateur peut comprendre ou corriger. Elles retombent sur l'écran
 * générique. Leur inventer un texte rassurant reviendrait à raconter à
 * quelqu'un une histoire au lieu de lui dire qu'on a un problème.
 */
export const ECOSYSTEM_SCREEN_CODES = [
  'domain_mismatch',
  'unknown_domain',
  'domain_inactive',
] as const

export type EcosystemScreenCode = (typeof ECOSYSTEM_SCREEN_CODES)[number]

export function isEcosystemScreenCode(v: unknown): v is EcosystemScreenCode {
  return typeof v === 'string' && (ECOSYSTEM_SCREEN_CODES as readonly string[]).includes(v)
}

/**
 * Paramètres d'écran, LAVÉS.
 *
 * ⚠️ Ces deux valeurs arrivent d'une URL, donc de n'importe qui. Le slug sert à
 *    construire un lien : non filtré, une valeur comme `evil.com` produirait un
 *    lien vers un hôte étranger, affiché dans nos couleurs et présenté comme
 *    « votre écosystème ». D'où `isValidEcosystemSlug`, et d'où le fait que le
 *    lien est reconstruit à partir de l'hôte COURANT — jamais de l'entrée.
 *
 *    Un code non reconnu retombe sur `null` (écran générique) plutôt que d'être
 *    affiché tel quel : afficher une chaîne arbitraire, c'est offrir un écran
 *    de la plateforme à qui veut y écrire.
 */
export function parseEcosystemScreenParams(params: {
  code?: string | string[] | null
  slug?: string | string[] | null
}): { code: EcosystemScreenCode | null; slug: string | null } {
  const one = (v: string | string[] | null | undefined) =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
  const code = one(params.code)
  const slug = one(params.slug)
  return {
    code: isEcosystemScreenCode(code) ? code : null,
    slug: isValidEcosystemSlug(slug) ? slug : null,
  }
}
