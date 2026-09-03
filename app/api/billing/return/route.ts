import { NextRequest } from 'next/server'
import { normalizeLocale } from '@/lib/billing/locale'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/billing/return — LE RETOUR DE CHECKOUT. IL N'ACCORDE AUCUN DROIT.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ CETTE ROUTE N'ÉCRIT RIEN. C'EST TOUT SON INTÉRÊT.                        ║
 * ║                                                                          ║
 * ║ Le test qui valide l'architecture entière : payer, puis FERMER LE        ║
 * ║ NAVIGATEUR AVANT LA REDIRECTION. Les droits doivent être posés quand     ║
 * ║ même.                                                                    ║
 * ║                                                                          ║
 * ║ Ils le sont, parce que c'est le WEBHOOK qui les pose — un appel entrant  ║
 * ║ de Stripe vers nous, qui ne dépend d'aucun navigateur, d'aucune          ║
 * ║ redirection, d'aucun onglet resté ouvert. Le retour de navigation n'est  ║
 * ║ qu'un CONFORT D'AFFICHAGE.                                               ║
 * ║                                                                          ║
 * ║ Si un jour quelqu'un ajoute ici la moindre écriture — poser l'offre,     ║
 * ║ créer la transaction, rattacher le client — le retour de navigation      ║
 * ║ redeviendrait autoritaire, et un client qui ferme son onglet perdrait ce ║
 * ║ qu'il vient de payer. Le défaut serait INVISIBLE en développement : le   ║
 * ║ développeur, lui, laisse son navigateur ouvert.                          ║
 * ║                                                                          ║
 * ║ Le diagnostic du parcours interdit donc toute écriture depuis ce         ║
 * ║ fichier, et jusqu'à l'ouverture d'un client base : pas de client, pas    ║
 * ║ d'écriture possible. La garantie est structurelle, pas déclarative.      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Elle ne fait donc qu'une chose : ramener l'utilisateur sur « Mon offre »,
 * avec un drapeau que l'écran lira pour afficher un message. L'écran, lui,
 * montre l'offre RÉELLE lue en base — donc la vérité, quel que soit ce que
 * raconte le drapeau.
 *
 * ⚠️ PAS DE `requireAuth` : on est sur une REDIRECTION DE NAVIGATEUR, pas sur
 *    un appel `fetch`. Le navigateur n'y présente pas d'en-tête Authorization,
 *    et refuser afficherait une erreur JSON brute à quelqu'un qui vient de
 *    payer. Ce n'est pas un affaiblissement : la route ne lit ni n'écrit
 *    AUCUNE donnée — elle redirige vers une page qui, elle, est gardée. Aucun
 *    secret ne transite, et le drapeau n'accorde rien.
 */

/** Les seules valeurs de drapeau admises — jamais ce que l'URL raconte. */
const STATUTS = new Set(['succes', 'annule'])

export function GET(request: NextRequest): Response {
  const params = request.nextUrl.searchParams
  const locale = normalizeLocale(params.get('locale'))
  const brut = (params.get('statut') ?? '').trim().toLowerCase()
  const statut = STATUTS.has(brut) ? brut : 'annule'

  // Destination construite à partir de l'ORIGINE DE LA REQUÊTE : l'organisation
  // revient sur l'écosystème d'où elle est partie. Une URL figée la déposerait
  // sur un autre sous-domaine.
  const destination = new URL(`/${locale}/dashboard/entreprise/offre`, request.nextUrl.origin)
  destination.searchParams.set('paiement', statut)

  // 303 : la redirection après une opération doit être suivie en GET, et ne
  // rejouer quoi que ce soit si l'utilisateur recharge.
  return Response.redirect(destination.toString(), 303)
}
