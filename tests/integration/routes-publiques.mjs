// tests/integration/routes-publiques.mjs — LES ROUTES QU'UN VISITEUR PEUT APPELER SANS COMPTE (lot DevOps CI).
//
// Une par entrée, chacune avec sa raison (§G.8 : une exemption sans raison devient un tampon). TOUTE AUTRE route
// de `app/api` exige un compte : le banc des routes (acces-routes.mjs, R1) l'appelle sans jeton et attend 401 avec
// un code. La liste ne peut que se vider : une entrée sans route, ou une entrée dont la route appelle `requireAuth`,
// rougit (scripts/diag-integration-continue.mjs).

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** Le code sans ses commentaires — un contrôle ne se règle jamais sur un commentaire (§E.7). */
export const sansCommentaires = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')

/**
 * LES ROUTES DU DÉPÔT, DÉRIVÉES — chaque `app/api/**\/route.ts`, chaque méthode exportée, avec son code sans
 * commentaires. Une seule dérivation, lue par le banc des routes ET par son contrôle statique.
 */
export function routesDuDepot(racine) {
  const out = []
  const base = join(racine, 'app', 'api')
  const parcourir = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) parcourir(p)
      else if (e === 'route.ts') {
        const code = sansCommentaires(readFileSync(p, 'utf8'))
        const chemin = relative(base, d).split(sep).join('/')
        for (const m of code.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) {
          out.push({ chemin, methode: m[1], code })
        }
      }
    }
  }
  parcourir(base)
  return out.sort((a, b) => (a.chemin + a.methode).localeCompare(b.chemin + b.methode))
}

export const PUBLIQUES = new Map([
  ['auth/public/send-phone-otp', 'inscription : le code SMS se demande avant que le compte existe'],
  ['auth/public/verify-phone-otp', 'inscription : le code SMS se vérifie avant que le compte existe'],
  ['auth/public/cancel-phone-otp', 'inscription : l’annulation du code SMS, avant que le compte existe'],
  ['auth/public/register-expert', 'inscription expert : crée le compte (la preuve est signée ici, §D.27)'],
  ['auth/register-org', 'inscription organisation : crée le compte (la preuve est signée ici, §D.27)'],
  ['invitations/resolve', 'invitation : lue par la personne invitée, qui n’a pas encore de compte'],
  ['invitations/inscription', 'invitation : crée le compte de la personne invitée'],
  ['countries', 'référentiel des pays des formulaires d’inscription'],
  ['taxonomy', 'référentiel des branches et spécialités des formulaires d’inscription'],
  ['contact', 'formulaire de contact : un visiteur non inscrit doit pouvoir écrire'],
  ['notifications/unsubscribe', 'lien de désabonnement d’un e-mail : sa propre preuve signée, sans session'],
  ['billing/return', 'retour de paiement : une redirection du navigateur, pas un appel d’API'],
  ['stripe/webhook', 'événements Stripe : la signature du fournisseur tient lieu de garde'],
  ['auth/logout', 'déconnexion permissive : efface le cookie, avec ou sans jeton'],
])
