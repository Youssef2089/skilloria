/**
 * lib/otp/lien-aide.ts — LA SORTIE QUAND LE CODE N'ARRIVE PAS.
 *
 * ═══ POURQUOI ════════════════════════════════════════════════════════════
 *   Verify v2 est asynchrone : il accepte la demande, rend un `request_id`,
 *   puis peut bloquer l'envoi. Sans webhook (choix différé, cf. §H de
 *   CLAUDE.md), le serveur ne peut pas savoir si le SMS a été remis.
 *
 *   Quelqu'un qui ne reçoit rien ne doit donc pas regarder un compteur tourner :
 *   c'est un écran mort. Il lui faut une action.
 *
 * ═══ AUCUN CANAL NOUVEAU ═════════════════════════════════════════════════
 *   On réutilise le formulaire de contact PUBLIC existant — déjà limité en
 *   débit, déjà gardé par un consentement RGPD, déjà routé vers l'équipe. Créer
 *   une adresse ou un endpoint pour ce seul cas aurait ajouté une surface à
 *   maintenir pour un besoin que l'existant couvre.
 *
 * ═══ LE SUJET EST UN JETON, PAS DU TEXTE LIBRE ═══════════════════════════
 *   L'URL ne transporte QUE `probleme=otp`, le numéro et le code pays. Le texte
 *   du message est rédigé par l'écran de contact, depuis ses propres
 *   traductions. Laisser passer du texte par l'URL ferait écrire n'importe qui
 *   dans un e-mail interne — et cet e-mail part vers l'équipe, pas vers
 *   l'expéditeur.
 *
 * ═══ POURQUOI LE PAYS, ET PAS SEULEMENT LE NUMÉRO ════════════════════════
 *   Le support a besoin de savoir DEPUIS QUEL PAYS la personne essaie, parce
 *   que c'est la question à poser au fournisseur. L'indicatif ne suffit pas :
 *   `+1` ne tranche pas entre les États-Unis et le Canada.
 */

/** Jeton de sujet. Une valeur, connue de l'écran de contact — jamais du texte libre. */
export const PROBLEME_OTP = 'otp'

/**
 * Construit le lien vers le formulaire de contact, prérempli.
 *
 * @param locale locale active (les routes sont toujours préfixées, cf. i18n/routing)
 * @param phone  numéro au format E.164 — chaîne vide tolérée
 * @param paysIso code ISO 3166-1 alpha-2 du pays choisi — chaîne vide tolérée
 */
export function lienAideOtp(locale: string, phone: string, paysIso: string): string {
  const params = new URLSearchParams({ probleme: PROBLEME_OTP })
  if (phone) params.set('phone', phone)
  if (paysIso) params.set('pays', paysIso)
  return `/${locale}/contact?${params.toString()}`
}
