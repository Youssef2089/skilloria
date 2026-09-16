import { isProduction } from '@/lib/env'

/**
 * lib/site-url.ts — L'ORIGINE DU SITE, ET LE REPLI QUI N'EN EST PLUS UN.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ LE DÉFAUT QU'ON FERME                                                    ║
 * ║                                                                          ║
 * ║ Huit endroits construisaient leurs liens d'e-mail ainsi :                ║
 * ║                                                                          ║
 * ║     process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'          ║
 * ║                                                                          ║
 * ║ En production, une variable oubliée envoyait donc à de vrais             ║
 * ║ destinataires des liens vers `localhost` — sur l'approbation d'un        ║
 * ║ expert, le refus d'une organisation, une invitation à rejoindre une      ║
 * ║ équipe, TOUTES les notifications par e-mail, et l'avertissement          ║
 * ║ d'inactivité à 23 mois, qui est une OBLIGATION LÉGALE.                   ║
 * ║                                                                          ║
 * ║ Rien n'alertait. L'envoi réussissait, l'e-mail partait, le lien était    ║
 * ║ mort. C'est la même famille que le seuil de vérification deviné : un     ║
 * ║ repli invisible est un SECOND RÉGLAGE qui prend la main le jour où l'on  ║
 * ║ comprend le moins ce qui se passe.                                       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * LA RÈGLE, ET ELLE N'EST PAS SYMÉTRIQUE ENTRE LES ENVIRONNEMENTS
 *   · HORS PRODUCTION, `http://localhost:3000` reste le repli. C'est une
 *     commodité de développement, elle est explicite, et elle ne trompe
 *     personne : il n'y a pas de destinataire réel.
 *   · EN PRODUCTION, il n'y a PAS de repli. Variable absente ou malformée ⇒
 *     `null`, et un journal bruyant. L'appelant NE DOIT PAS envoyer.
 *
 *   Mieux vaut un e-mail qui ne part pas — visible dans les journaux, et dont
 *   le destinataire ne sait rien — qu'un e-mail qui part avec un lien mort.
 *   Le premier se corrige en posant une variable ; le second se découvre par
 *   un client qui écrit pour dire que « le lien ne marche pas ».
 *
 * CE MODULE NE FAIT AUCUN APPEL RÉSEAU et ne lit qu'une variable : il est
 * appelable sur un chemin critique sans coût.
 */

/** Forme acceptée : un schéma http(s) et un hôte. Jamais de slash final. */
const ORIGINE_VALIDE = /^https?:\/\/[^\s/]{1,200}$/

/**
 * L'origine du site, ou `null` quand elle est inconnaissable.
 *
 * `null` — et jamais une chaîne de repli — pour que l'appelant soit OBLIGÉ de
 * choisir quoi faire. Une valeur par défaut le dispenserait de choisir, et
 * c'est exactement ainsi que `localhost` est arrivé dans des e-mails de
 * production.
 */
export function siteOrigin(): string | null {
  const brut = (process.env.NEXT_PUBLIC_SITE_URL ?? '').trim().replace(/\/+$/, '')

  if (brut && ORIGINE_VALIDE.test(brut)) return brut

  if (!isProduction()) {
    // Hors production : repli explicite, assumé, et sans destinataire réel.
    return 'http://localhost:3000'
  }

  console.error(
    '[site-url] NEXT_PUBLIC_SITE_URL absente ou malformée EN PRODUCTION — ' +
      'aucun lien d’e-mail ne peut être construit. Les envois concernés sont ' +
      'ANNULÉS plutôt qu’expédiés avec un lien mort. Poser la variable sur ' +
      'l’environnement Production (cf. docs/mise-en-production.md).',
    { valeur_brute: brut === '' ? '(vide)' : brut },
  )
  return null
}

/**
 * L'origine à utiliser pour une requête entrante.
 *
 * ORDRE SIGNIFIANT, et il est déjà celui du code d'origine :
 *   ① une origine explicitement transmise par l'appelant (corps de requête) ;
 *   ② l'en-tête `Origin` du navigateur ;
 *   ③ la variable d'environnement.
 *
 * Les deux premières ne valent que pour une action déclenchée DEPUIS un
 * navigateur. Un cron n'en a aucune : il tombe directement sur ③, et c'est
 * précisément là que le repli `localhost` faisait le plus de dégâts.
 */
export function siteOriginPourRequete(args: {
  fourni?: unknown
  origin?: string | null
}): string | null {
  if (typeof args.fourni === 'string' && ORIGINE_VALIDE.test(args.fourni)) {
    return args.fourni.replace(/\/+$/, '')
  }
  if (args.origin && ORIGINE_VALIDE.test(args.origin)) {
    return args.origin.replace(/\/+$/, '')
  }
  return siteOrigin()
}
